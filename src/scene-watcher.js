// -----------------------------------------------------------------------------
// Scene watcher: polls Météo France for every located house and publishes the
// scene triggers (see scene-triggers.js and hazard-triggers.js for what fires
// and why).
//
// Two cadences, matched to how fast each source changes:
//   - the radar nowcast every 5 minutes: its slots are 5 minutes wide, and
//     "rain in 15 min" is worthless 15 minutes late;
//   - the forecast every 30 minutes: MF only refreshes it a few times an hour.
//
// The watcher learns nothing from the scenes (the integration never knows
// which exist), so it polls every located house. Upstream load stays small:
// 12 nowcasts and 2 forecasts an hour per house, and a house outside the
// nowcast coverage is re-checked only every few hours.
//
// Publishing never throws out of a poll: a refused event (core too old,
// disconnected, rate-limited) is logged and the watcher carries on.
// -----------------------------------------------------------------------------

import { readNowcast } from './rain.js';
import { readTimezone } from './forecast.js';
import {
  detectRainTriggers,
  buildRainEventData,
  readForecastExtremes,
  evaluateForecastLevels,
  buildForecastEventData,
  SCENE_TRIGGERS,
} from './scene-triggers.js';
import { detectForecastHazards, buildHazardEventData } from './hazard-triggers.js';

const RAIN_INTERVAL_MS = 5 * 60 * 1000;
const FORECAST_INTERVAL_MS = 30 * 60 * 1000;

// A house outside the nowcast coverage: no point asking again before this.
const RAIN_UNAVAILABLE_RETRY_MS = 6 * 60 * 60 * 1000;

// The same rain trigger never fires twice for a house within this delay: the
// radar nowcast can flicker at the edge of a shower ("rain in 55 min", then
// dry, then rain again).
const RAIN_COOLDOWN_MS = 30 * 60 * 1000;

// The same ice / snow / storm trigger (and level) never fires twice for a
// house within this delay: the forecast can drop a hazard for one run and
// bring it back the next. UV needs none: each day fires once.
const HAZARD_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const COOLDOWN_HAZARDS = [
  SCENE_TRIGGERS.ICE_FORECAST,
  SCENE_TRIGGERS.SNOW_FORECAST,
  SCENE_TRIGGERS.STORM_FORECAST,
];

/**
 * @description Create the scene watcher.
 * @param {object} options - Options.
 * @param {object} options.houses - The house registry (houses.js).
 * @param {Function} options.fetchRain - `(latitude, longitude) => Promise<any>`.
 * @param {Function} options.fetchForecast - `(latitude, longitude) => Promise<any>`.
 * @param {Function} options.publish - `(key, data) => Promise<any>`, the SDK publishSceneEvent.
 * @param {Function} options.getPreferences - `() => ({ language, units })`.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {Function} [options.now] - `() => number` in ms (for tests).
 * @param {number} [options.rainIntervalMs] - Nowcast poll interval (for tests).
 * @param {number} [options.forecastIntervalMs] - Forecast poll interval (for tests).
 * @returns {object} The watcher ({ pollRain, pollForecast, start, stop }).
 * @example
 * const watcher = createSceneWatcher({ houses, fetchRain, fetchForecast, publish, getPreferences });
 */
function createSceneWatcher({
  houses,
  fetchRain,
  fetchForecast,
  publish,
  getPreferences,
  logger = console,
  now = () => Date.now(),
  rainIntervalMs = RAIN_INTERVAL_MS,
  forecastIntervalMs = FORECAST_INTERVAL_MS,
}) {
  // house id -> { nowcast, unavailableUntil, lastFired: Map, levels: Map, hazards: Map }
  const states = new Map();
  const timers = [];

  /**
   * @description The memory of a house, created on first use.
   * @param {object} house - The house.
   * @returns {object} Its state.
   * @example
   * stateOf(house).levels;
   */
  function stateOf(house) {
    let state = states.get(house.id);
    if (state === undefined) {
      state = {
        nowcast: null,
        unavailableUntil: 0,
        lastFired: new Map(),
        levels: new Map(),
        hazards: new Map(),
      };
      states.set(house.id, state);
    }
    return state;
  }

  /**
   * @description Publish one event, logging instead of throwing.
   * @param {string} key - The trigger key.
   * @param {object} data - The flat event data.
   * @returns {Promise<void>} Resolves once published (or refused).
   * @example
   * await safePublish('rain_expected', data);
   */
  async function safePublish(key, data) {
    try {
      logger.info(`Scene event ${key} for house "${data.house}"`);
      await publish(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  /**
   * @description Poll the nowcast of every located house once.
   * @returns {Promise<number>} The number of events published.
   * @example
   * await watcher.pollRain();
   */
  async function pollRain() {
    let published = 0;
    const { language } = getPreferences();
    // Sequential on purpose: a handful of houses at most.
    for (const house of houses.list()) {
      const state = stateOf(house);
      if (state.unavailableUntil > now()) {
        continue;
      }
      try {
        const data = await fetchRain(house.latitude, house.longitude);
        const nowcast = readNowcast(data, Math.floor(now() / 1000));
        if (!nowcast.available) {
          logger.debug(`No rain nowcast for house "${house.name}", retrying later`);
          state.unavailableUntil = now() + RAIN_UNAVAILABLE_RETRY_MS;
          // Coming back later is a new baseline.
          state.nowcast = null;
          continue;
        }
        const triggers = detectRainTriggers(state.nowcast, nowcast);
        state.nowcast = nowcast;
        for (const key of triggers) {
          const lastFired = state.lastFired.get(key);
          if (lastFired !== undefined && now() - lastFired < RAIN_COOLDOWN_MS) {
            logger.debug(`Scene event ${key} for house "${house.name}" skipped (cooldown)`);
            continue;
          }
          state.lastFired.set(key, now());
          await safePublish(key, buildRainEventData(key, house.name, nowcast, language));
          published += 1;
        }
      } catch (err) {
        // An upstream failure keeps the previous nowcast: the next poll diffs
        // against it, so a transition spanning the outage is not lost.
        logger.debug(`Rain nowcast failed for house "${house.name}": ${err.message}`);
      }
    }
    return published;
  }

  /**
   * @description Re-read the houses, then poll the forecast of every located
   * house once.
   * @returns {Promise<number>} The number of events published.
   * @example
   * await watcher.pollForecast();
   */
  async function pollForecast() {
    let published = 0;
    const located = await houses.refresh();
    // Forget the houses that were deleted or lost their location.
    const ids = new Set(located.map((house) => house.id));
    [...states.keys()].forEach((id) => {
      if (!ids.has(id)) {
        states.delete(id);
      }
    });

    const { language, units } = getPreferences();
    for (const house of located) {
      const state = stateOf(house);
      try {
        const data = await fetchForecast(house.latitude, house.longitude);
        const nowSeconds = Math.floor(now() / 1000);
        const timezone = readTimezone(data);
        const events = evaluateForecastLevels(
          state.levels,
          readForecastExtremes(data, nowSeconds, timezone),
        );
        const context = { timezone, units, language, nowSeconds };
        for (const event of events) {
          await safePublish(event.trigger, buildForecastEventData(event, house.name, context));
          published += 1;
        }
        const hazards = detectForecastHazards(state.hazards, data, context);
        for (const event of hazards) {
          if (COOLDOWN_HAZARDS.includes(event.trigger)) {
            const key = `${event.trigger}:${event.level || ''}`;
            const lastFired = state.lastFired.get(key);
            if (lastFired !== undefined && now() - lastFired < HAZARD_COOLDOWN_MS) {
              logger.debug(`Scene event ${key} for house "${house.name}" skipped (cooldown)`);
              continue;
            }
            state.lastFired.set(key, now());
          }
          await safePublish(event.trigger, buildHazardEventData(event, house.name, context));
          published += 1;
        }
      } catch (err) {
        logger.debug(`Forecast poll failed for house "${house.name}": ${err.message}`);
      }
    }
    return published;
  }

  /**
   * @description Run a poll on an interval, swallowing its failures.
   * @param {Function} poll - The poll.
   * @param {number} intervalMs - The interval.
   * @example
   * every(pollRain, RAIN_INTERVAL_MS);
   */
  function every(poll, intervalMs) {
    const timer = setInterval(() => {
      poll().catch((err) => logger.warn(`Scene watcher failed: ${err.message}`));
    }, intervalMs);
    // Never hold the process alive just for the watcher.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    timers.push(timer);
  }

  /**
   * @description Start polling. The first forecast poll reads the houses and
   * sets the baselines; the first nowcast poll follows it.
   * @returns {Promise<void>} Resolves once the baselines are set.
   * @example
   * await watcher.start();
   */
  async function start() {
    if (timers.length > 0) {
      return;
    }
    every(pollRain, rainIntervalMs);
    every(pollForecast, forecastIntervalMs);
    try {
      await pollForecast();
      await pollRain();
    } catch (err) {
      logger.warn(`Scene watcher failed to start: ${err.message}`);
    }
  }

  /**
   * @description Stop polling.
   * @example
   * watcher.stop();
   */
  function stop() {
    timers.splice(0).forEach((timer) => clearInterval(timer));
  }

  return { pollRain, pollForecast, start, stop };
}

export {
  createSceneWatcher,
  RAIN_INTERVAL_MS,
  FORECAST_INTERVAL_MS,
  RAIN_COOLDOWN_MS,
  RAIN_UNAVAILABLE_RETRY_MS,
};
