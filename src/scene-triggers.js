// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`): what fires, and with which data.
//
// SDK doctrine: an event is a TRANSITION, published once — never a state
// re-published on every poll, and never a threshold the core would compare
// (the core matcher only does equality and membership). So:
//
//   - rain_expected / rain_stopped come from the radar nowcast: the hour turns
//     from dry to rainy, the rain under way stops;
//   - frost / heat / wind are FIXED levels (0 °C, -5 °C, 30 °C...) declared as
//     select options. Each level of each house is its own little state
//     machine: it fires when the next 24 hours start to reach it, and re-arms
//     only once the forecast is back clear of it BY A MARGIN — a forecast
//     hovering around 0 °C from one run to the next must not fire every hour.
//
// The first evaluation of a house is a baseline and never fires, like the
// core's own weather-alert check: a restart during an ongoing frost episode
// must not re-send every notification.
//
// Every function here is pure; scene-watcher.js owns the polling and state.
// -----------------------------------------------------------------------------

import { convertTemperature, convertWindSpeed, dayKey } from './forecast.js';
import { describeNowcast } from './scene-actions.js';
import {
  INTENSITY_LABELS,
  textLanguage,
  unitSymbols,
  formatNumber,
  formatLocalTime,
} from './scene-text.js';

// Keys of the manifest `scene_triggers`. A published key is never renamed.
const SCENE_TRIGGERS = {
  RAIN_EXPECTED: 'rain_expected',
  RAIN_STOPPED: 'rain_stopped',
  FROST_FORECAST: 'frost_forecast',
  HEAT_FORECAST: 'heat_forecast',
  WIND_FORECAST: 'wind_forecast',
};

// How far ahead the forecast triggers look.
const FORECAST_WINDOW_SECONDS = 24 * 3600;

// Forecast levels. `metric` is the forecast figure the level reads (always
// metric: the raw MF payload is), `below` says which side of the threshold is
// the alert, `margin` is how far back the forecast must go to re-arm it. Level
// keys are published values of the `level` field: never renamed.
const FORECAST_LEVELS = {
  [SCENE_TRIGGERS.FROST_FORECAST]: {
    metric: 'temperature_min',
    below: true,
    margin: 2,
    levels: [
      { level: 'frost', threshold: 0 },
      { level: 'hard_frost', threshold: -5 },
    ],
  },
  [SCENE_TRIGGERS.HEAT_FORECAST]: {
    metric: 'temperature_max',
    below: false,
    margin: 2,
    levels: [
      { level: 'heat_30', threshold: 30 },
      { level: 'heat_35', threshold: 35 },
    ],
  },
  [SCENE_TRIGGERS.WIND_FORECAST]: {
    metric: 'wind_gust',
    below: false,
    margin: 15,
    levels: [
      { level: 'gust_60', threshold: 60 },
      { level: 'gust_80', threshold: 80 },
      { level: 'gust_100', threshold: 100 },
    ],
  },
};

/**
 * @description The rain triggers a new nowcast fires, given the previous one.
 * @param {object|null} previous - The previous readNowcast() summary, or null
 * on the first poll (a baseline: nothing fires).
 * @param {object} current - The new readNowcast() summary.
 * @returns {Array<string>} The keys of the triggers to fire.
 * @example
 * detectRainTriggers(dryHour, rainIn15Minutes); // -> ['rain_expected']
 */
function detectRainTriggers(previous, current) {
  if (previous === null || !previous.available || !current.available) {
    return [];
  }
  const triggers = [];
  if (!previous.rainExpected && current.rainExpected) {
    triggers.push(SCENE_TRIGGERS.RAIN_EXPECTED);
  }
  if (previous.raining && !current.raining) {
    triggers.push(SCENE_TRIGGERS.RAIN_STOPPED);
  }
  return triggers;
}

/**
 * @description Data of a rain trigger: the house (matched against the
 * optional "House" filter), the intensity (matched against the "Intensity"
 * filter of rain_expected), and the figures as scene variables.
 * @param {string} key - The trigger key.
 * @param {string} house - The house name.
 * @param {object} nowcast - The readNowcast() summary.
 * @param {string} language - The language of the instance.
 * @returns {object} The flat event data.
 * @example
 * buildRainEventData('rain_expected', 'Maison', nowcast, 'fr');
 */
function buildRainEventData(key, house, nowcast, language) {
  const lang = textLanguage(language);
  if (key === SCENE_TRIGGERS.RAIN_EXPECTED) {
    return {
      house,
      intensity: nowcast.intensity,
      intensity_label: INTENSITY_LABELS[lang][nowcast.intensity],
      minutes_until_rain: nowcast.minutesUntilRain,
      summary: describeNowcast(nowcast, lang),
    };
  }
  const dryForHour = nowcast.minutesUntilNextRain === null;
  let summary;
  if (dryForHour) {
    summary =
      lang === 'fr'
        ? "Fin de la pluie, pas de nouvelle averse prévue dans l'heure."
        : 'The rain has stopped, no more rain expected within the hour.';
  } else {
    summary =
      lang === 'fr'
        ? `Fin de la pluie, reprise prévue dans ${nowcast.minutesUntilNextRain} min.`
        : `The rain has stopped, more expected in ${nowcast.minutesUntilNextRain} min.`;
  }
  return {
    house,
    dry_for_hour: dryForHour,
    minutes_until_next_rain: nowcast.minutesUntilNextRain,
    summary,
  };
}

/**
 * @description Extremes of the next 24 hours of a raw forecast payload, in MF
 * units (°C, km/h), with the moment each is reached.
 * @param {object} data - The raw forecast payload.
 * @param {number} [nowSeconds] - Current time in seconds (for tests).
 * @returns {{temperature_min: {value: number, dt: number}|null,
 *   temperature_max: {value: number, dt: number}|null,
 *   wind_gust: {value: number, dt: number}|null}} The extremes.
 * @example
 * readForecastExtremes(rawForecast);
 */
function readForecastExtremes(data, nowSeconds = Math.floor(Date.now() / 1000)) {
  const hourly = Array.isArray(data && data.forecast) ? data.forecast : [];
  // The hour under way counts (30-minute grace, like the pivot hours).
  const window = hourly.filter(
    (entry) =>
      entry &&
      Number.isFinite(entry.dt) &&
      entry.dt >= nowSeconds - 1800 &&
      entry.dt < nowSeconds + FORECAST_WINDOW_SECONDS,
  );
  const extreme = (read, better) =>
    window.reduce((best, entry) => {
      const value = read(entry);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return best;
      }
      return best === null || better(value, best.value) ? { value, dt: entry.dt } : best;
    }, null);
  const temperature = (entry) => entry.T && entry.T.value;
  return {
    temperature_min: extreme(temperature, (a, b) => a < b),
    temperature_max: extreme(temperature, (a, b) => a > b),
    wind_gust: extreme(
      (entry) => entry.wind && entry.wind.gust,
      (a, b) => a > b,
    ),
  };
}

/**
 * @description Run the forecast level state machines of one house over new
 * extremes. `states` is mutated: it is the memory of the house.
 * @param {Map<string, string>} states - `${trigger}:${level}` -> 'reached' | 'clear'.
 * @param {object} extremes - The readForecastExtremes() result.
 * @returns {Array<{trigger: string, level: string, value: number, dt: number}>}
 * The levels newly reached.
 * @example
 * evaluateForecastLevels(new Map(), extremes); // -> [] (baseline)
 */
function evaluateForecastLevels(states, extremes) {
  const reached = [];
  Object.entries(FORECAST_LEVELS).forEach(([trigger, { metric, below, margin, levels }]) => {
    const extreme = extremes[metric];
    if (extreme === null || extreme === undefined) {
      // No figure this run: keep the memory as it is.
      return;
    }
    levels.forEach(({ level, threshold }) => {
      const key = `${trigger}:${level}`;
      const isReached = below ? extreme.value <= threshold : extreme.value >= threshold;
      const isClear = below
        ? extreme.value > threshold + margin
        : extreme.value < threshold - margin;
      const previous = states.get(key);
      if (previous === undefined) {
        // Baseline: remember, never fire.
        states.set(key, isReached ? 'reached' : 'clear');
        return;
      }
      if (previous === 'clear' && isReached) {
        states.set(key, 'reached');
        reached.push({ trigger, level, value: extreme.value, dt: extreme.dt });
      } else if (previous === 'reached' && isClear) {
        states.set(key, 'clear');
      }
    });
  });
  return reached;
}

/**
 * @description "aujourd'hui à 06:00" / "demain à 06:00" for a moment.
 * @param {number} dt - The moment, in seconds.
 * @param {string|null} timezone - The IANA timezone of the place.
 * @param {string} language - 'fr' or 'en'.
 * @param {number} nowSeconds - Current time in seconds.
 * @returns {string} The phrase.
 * @example
 * describeMoment(dt, 'Europe/Paris', 'fr', now); // -> 'demain à 06:00'
 */
function describeMoment(dt, timezone, language, nowSeconds) {
  const time = formatLocalTime(dt, timezone);
  const today = dayKey(nowSeconds, timezone) === dayKey(dt, timezone);
  if (language === 'fr') {
    return `${today ? "aujourd'hui" : 'demain'} à ${time}`;
  }
  return `${today ? 'today' : 'tomorrow'} at ${time}`;
}

/**
 * @description Data of a forecast trigger: the house and the level (matched
 * against the "House" and "Level" filters), and the figures as scene
 * variables, in the unit system of the instance.
 * @param {object} event - An evaluateForecastLevels() entry.
 * @param {string} house - The house name.
 * @param {object} context - { timezone, units, language, nowSeconds }.
 * @returns {object} The flat event data.
 * @example
 * buildForecastEventData(event, 'Maison', { timezone: 'Europe/Paris', units: 'metric', language: 'fr' });
 */
function buildForecastEventData(
  event,
  house,
  { timezone, units, language, nowSeconds = Math.floor(Date.now() / 1000) },
) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const moment = describeMoment(event.dt, timezone, lang, nowSeconds);
  const data = {
    house,
    level: event.level,
    time: formatLocalTime(event.dt, timezone),
    hours_until: Math.max(0, Math.round((event.dt - nowSeconds) / 3600)),
  };

  if (event.trigger === SCENE_TRIGGERS.WIND_FORECAST) {
    data.wind_gust = convertWindSpeed(event.value, units);
    const gust = `${formatNumber(data.wind_gust, lang)} ${symbols.wind}`;
    data.summary =
      lang === 'fr'
        ? `Vent fort annoncé : rafales à ${gust} prévues ${moment}.`
        : `Strong wind forecast: gusts up to ${gust} expected ${moment}.`;
    return data;
  }

  const temperature = convertTemperature(event.value, units);
  const degrees = `${temperature} ${symbols.temperature}`;
  if (event.trigger === SCENE_TRIGGERS.FROST_FORECAST) {
    data.temperature_min = temperature;
    const hard = event.level === 'hard_frost';
    if (lang === 'fr') {
      data.summary = `${hard ? 'Gel fort' : 'Gel'} annoncé : ${degrees} prévus ${moment}.`;
    } else {
      data.summary = `${hard ? 'Hard frost' : 'Frost'} forecast: ${degrees} expected ${moment}.`;
    }
    return data;
  }

  data.temperature_max = temperature;
  data.summary =
    lang === 'fr'
      ? `Forte chaleur annoncée : ${degrees} prévus ${moment}.`
      : `Heat forecast: ${degrees} expected ${moment}.`;
  return data;
}

export {
  SCENE_TRIGGERS,
  FORECAST_LEVELS,
  FORECAST_WINDOW_SECONDS,
  detectRainTriggers,
  buildRainEventData,
  readForecastExtremes,
  evaluateForecastLevels,
  buildForecastEventData,
};
