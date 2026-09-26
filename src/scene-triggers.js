// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`): what fires, and with which data.
//
// SDK doctrine: an event is a TRANSITION, published once — never a state
// re-published on every poll, and never a threshold the core would compare
// (the core matcher only does equality and membership). So:
//
//   - rain_expected / rain_stopped come from the radar nowcast: the hour turns
//     from dry to rainy, the rain under way stops;
//   - frost / heat / wind watch a ladder of thresholds (every degree, every
//     5 km/h). Each threshold of each house is its own little state machine:
//     it fires when the next 24 hours start to reach it, and re-arms only
//     once the forecast is back clear of it BY A MARGIN — a forecast hovering
//     around 0 °C from one run to the next must not fire every hour.
//
// A custom threshold is still an equality for the core: the scene picks the
// "custom" level and types a value in the `threshold` field, and the
// integration publishes one "custom" event per threshold crossed, carrying
// that threshold. The fixed levels (0 °C, -5 °C, 30 °C...) are the shortcuts
// of the select: the crossing of their threshold also publishes an event
// carrying the level key.
//
// The first evaluation of a house is a baseline and never fires, like the
// core's own weather-alert check: a restart during an ongoing frost episode
// must not re-send every notification.
//
// Every function here is pure; scene-watcher.js owns the polling and state.
// -----------------------------------------------------------------------------

import {
  convertTemperature,
  convertSceneWindSpeed,
  toKilometersPerHour,
  dayKey,
} from './forecast.js';
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

// The option of the `level` select that hands over to the `threshold` field.
// A published value: never renamed.
const CUSTOM_LEVEL = 'custom';

// Forecast levels. `metric` is the forecast figure the level reads (always
// metric: °C, and km/h for the wind, converted from the m/s of MF), `below` says which side of the threshold is
// the alert, `margin` is how far back the forecast must go to re-arm it.
// `thresholds` is the ladder watched, the bounds of the `threshold` field;
// `levels` are the fixed shortcuts, whose thresholds sit on the ladder. Level
// keys are published values of the `level` field: never renamed.
const FORECAST_LEVELS = {
  [SCENE_TRIGGERS.FROST_FORECAST]: {
    metric: 'temperature_min',
    below: true,
    margin: 2,
    thresholds: { min: -20, max: 5, step: 1 },
    levels: [
      { level: 'frost', threshold: 0 },
      { level: 'hard_frost', threshold: -5 },
    ],
  },
  [SCENE_TRIGGERS.HEAT_FORECAST]: {
    metric: 'temperature_max',
    below: false,
    margin: 2,
    thresholds: { min: 20, max: 45, step: 1 },
    levels: [
      { level: 'heat_30', threshold: 30 },
      { level: 'heat_35', threshold: 35 },
    ],
  },
  [SCENE_TRIGGERS.WIND_FORECAST]: {
    metric: 'wind_gust',
    below: false,
    margin: 15,
    thresholds: { min: 20, max: 150, step: 5 },
    levels: [
      { level: 'gust_60', threshold: 60 },
      { level: 'gust_80', threshold: 80 },
      { level: 'gust_100', threshold: 100 },
    ],
  },
};

// A custom frost threshold this low reads "hard frost", like the fixed level.
const HARD_FROST_THRESHOLD = FORECAST_LEVELS[SCENE_TRIGGERS.FROST_FORECAST].levels.find(
  ({ level }) => level === 'hard_frost',
).threshold;

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
 * @description Extremes of the next 24 hours of a raw forecast payload, in °C
 * and km/h (MF gives the wind in m/s), with the moment each is reached.
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
      (entry) =>
        entry.wind && typeof entry.wind.gust === 'number'
          ? toKilometersPerHour(entry.wind.gust)
          : null,
      (a, b) => a > b,
    ),
  };
}

/**
 * @description The ladder of thresholds a forecast trigger watches, from the
 * mildest to the most severe (the order the forecast crosses them in).
 * @param {object} config - A FORECAST_LEVELS entry.
 * @returns {Array<number>} The thresholds.
 * @example
 * forecastThresholds(FORECAST_LEVELS.wind_forecast); // -> [20, 25, ..., 150]
 */
function forecastThresholds({ below, thresholds: { min, max, step } }) {
  const ladder = [];
  for (let threshold = min; threshold <= max; threshold += step) {
    ladder.push(threshold);
  }
  return below ? ladder.reverse() : ladder;
}

/**
 * @description Run the forecast threshold state machines of one house over
 * new extremes. `states` is mutated: it is the memory of the house. A
 * threshold newly reached yields its "custom" event, preceded by the event of
 * the fixed level sitting on it, if any.
 * @param {Map<string, string>} states - `${trigger}:${threshold}` -> 'reached' | 'clear'.
 * @param {object} extremes - The readForecastExtremes() result.
 * @returns {Array<{trigger: string, level: string, threshold: number, value: number, dt: number}>}
 * The events to publish.
 * @example
 * evaluateForecastLevels(new Map(), extremes); // -> [] (baseline)
 */
function evaluateForecastLevels(states, extremes) {
  const reached = [];
  Object.entries(FORECAST_LEVELS).forEach(([trigger, config]) => {
    const { metric, below, margin, levels } = config;
    const extreme = extremes[metric];
    if (extreme === null || extreme === undefined) {
      // No figure this run: keep the memory as it is.
      return;
    }
    forecastThresholds(config).forEach((threshold) => {
      const key = `${trigger}:${threshold}`;
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
        const event = { trigger, threshold, value: extreme.value, dt: extreme.dt };
        const fixed = levels.find((candidate) => candidate.threshold === threshold);
        if (fixed !== undefined) {
          reached.push({ ...event, level: fixed.level });
        }
        reached.push({ ...event, level: CUSTOM_LEVEL });
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
 * @description Data of a forecast trigger: the house, the level and the
 * threshold (matched against the "House", "Level" and "Custom threshold"
 * filters, the threshold always metric like the field), and the figures as
 * scene variables, in the unit system of the instance.
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
    threshold: event.threshold,
    time: formatLocalTime(event.dt, timezone),
    hours_until: Math.max(0, Math.round((event.dt - nowSeconds) / 3600)),
  };

  if (event.trigger === SCENE_TRIGGERS.WIND_FORECAST) {
    data.wind_gust = convertSceneWindSpeed(event.value, units);
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
    const hard = event.threshold <= HARD_FROST_THRESHOLD;
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
  CUSTOM_LEVEL,
  FORECAST_LEVELS,
  FORECAST_WINDOW_SECONDS,
  detectRainTriggers,
  buildRainEventData,
  readForecastExtremes,
  forecastThresholds,
  evaluateForecastLevels,
  buildForecastEventData,
};
