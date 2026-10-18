// -----------------------------------------------------------------------------
// Avalanche watcher: reads the bulletin of the massif of every located house
// once an hour and publishes avalanche_risk when the danger rises (see
// avalanche.js for what fires).
//
// Météo France writes the bulletins around 16:00, sometimes amends them: an
// hour is plenty, and the upstream load is one call per massif and hour, a
// massif shared by several houses being read once. A house outside the 36
// massifs costs nothing.
//
// The state is kept per massif: the first reading after a start is a baseline,
// a failed reading keeps the previous danger, so a rise spanning the outage is
// not lost. Publishing never throws out of a poll.
// -----------------------------------------------------------------------------

import { findMassif } from './massifs.js';
import {
  parseAvalancheBulletin,
  readTriggerRisk,
  detectAvalancheRise,
  buildAvalancheEventData,
} from './avalanche.js';
import { SCENE_TRIGGERS } from './scene-triggers.js';

const AVALANCHE_INTERVAL_MS = 60 * 60 * 1000;
const AVALANCHE_TRIGGER = SCENE_TRIGGERS.AVALANCHE_RISK;

/**
 * @description Create the avalanche watcher.
 * @param {object} options - Options.
 * @param {object} options.houses - The house registry (houses.js), refreshed
 * by the scene watcher.
 * @param {Function} options.fetchBulletin - `(massifId) => Promise<string>`.
 * @param {Function} options.publish - `(key, data) => Promise<any>`, the SDK publishSceneEvent.
 * @param {Function} options.getPreferences - `() => ({ language })`.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {number} [options.intervalMs] - Poll interval (for tests).
 * @returns {object} The watcher ({ poll, start, stop }).
 * @example
 * const watcher = createAvalancheWatcher({ houses, fetchBulletin, publish, getPreferences });
 */
function createAvalancheWatcher({
  houses,
  fetchBulletin,
  publish,
  getPreferences,
  logger = console,
  intervalMs = AVALANCHE_INTERVAL_MS,
}) {
  // massif id -> danger 0-5 of the last reading.
  const risks = new Map();
  let timer = null;

  /**
   * @description Read the bulletin of every watched massif once.
   * @returns {Promise<number>} The number of events published.
   * @example
   * await watcher.poll();
   */
  async function poll() {
    // massif id -> { massif, houses: [names] }
    const watched = new Map();
    for (const house of houses.list()) {
      const massif = findMassif(house.latitude, house.longitude);
      if (massif === null) {
        continue;
      }
      if (!watched.has(massif.id)) {
        watched.set(massif.id, { massif, houses: [] });
      }
      watched.get(massif.id).houses.push(house.name);
    }
    // Forget the massifs no house is in anymore: coming back is a new baseline.
    [...risks.keys()].forEach((id) => {
      if (!watched.has(id)) {
        risks.delete(id);
      }
    });

    const { language } = getPreferences();
    let published = 0;
    for (const [id, { massif, houses: names }] of watched) {
      let bulletin;
      try {
        bulletin = parseAvalancheBulletin(await fetchBulletin(id));
      } catch (err) {
        logger.debug(`Avalanche bulletin of massif ${massif.name} failed: ${err.message}`);
        continue;
      }
      const previousRisk = risks.get(id);
      const risk = readTriggerRisk(bulletin);
      risks.set(id, risk);
      for (const level of detectAvalancheRise(previousRisk, risk)) {
        for (const house of names) {
          const data = buildAvalancheEventData({
            level,
            bulletin,
            massif,
            house,
            previousRisk,
            language,
          });
          try {
            logger.info(`Scene event ${AVALANCHE_TRIGGER} (${level.level}) for house "${house}"`);
            await publish(AVALANCHE_TRIGGER, data);
          } catch (err) {
            logger.warn(`Scene event ${AVALANCHE_TRIGGER} refused: ${err.message}`);
          }
          published += 1;
        }
      }
    }
    return published;
  }

  /**
   * @description Start polling; the first poll sets the baselines.
   * @returns {Promise<void>} Resolves once the baselines are set.
   * @example
   * await watcher.start();
   */
  async function start() {
    if (timer !== null) {
      return;
    }
    timer = setInterval(() => {
      poll().catch((err) => logger.warn(`Avalanche watcher failed: ${err.message}`));
    }, intervalMs);
    // Never hold the process alive just for the watcher.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    try {
      await poll();
    } catch (err) {
      logger.warn(`Avalanche watcher failed to start: ${err.message}`);
    }
  }

  /**
   * @description Stop polling.
   * @example
   * watcher.stop();
   */
  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { poll, start, stop };
}

export { createAvalancheWatcher, AVALANCHE_INTERVAL_MS };
