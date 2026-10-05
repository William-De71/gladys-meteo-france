// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`): what fires, and with which data.
//
// SDK doctrine: an event is a TRANSITION, published once — never a state
// re-published on every poll, and never a threshold the core would compare
// (the core matcher only does equality and membership). So:
//
//   - rain_expected / rain_stopped come from the radar nowcast: the hour turns
//     from dry to rainy, the rain under way stops;
//   - ice / snow / storm / UV: see hazard-triggers.js;
//   - frost / heat / wind watch a ladder of thresholds (every degree, every
//     5 km/h);
//   - frost and heat fire once per DAY and threshold: the coldest night
//     (noon to noon) or the hottest day (midnight to midnight) entering the
//     next 24 hours, so usually the day before. An episode would be the wrong
//     unit here: a mild threshold (20 °C in summer, 5 °C in winter) can stay
//     reached for weeks, and the shutters close every day of a heatwave;
//   - wind fires once per EPISODE: each threshold of each house is its own
//     little state machine, firing when the next 24 hours start to reach it
//     and re-arming only once the forecast is back clear of it BY A MARGIN —
//     a forecast hovering around a threshold must not fire every hour.
//
// A custom threshold is still an equality for the core: the scene picks the
// "custom" level and types a value in the `threshold` field, and the
// integration publishes one "custom" event per threshold crossed, carrying
// that threshold. The fixed levels (0 °C, -5 °C, 30 °C...) are the shortcuts
// of the select: the crossing of their threshold also publishes an event
// carrying the level key.
//
// The first evaluation of a house is a baseline and never fires, like the
// core's own weather-alert check: a restart during a frosty night or a windy
// episode must not re-send every notification.
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
  // Watched in hazard-triggers.js.
  ICE_FORECAST: 'ice_forecast',
  SNOW_FORECAST: 'snow_forecast',
  STORM_FORECAST: 'storm_forecast',
  UV_FORECAST: 'uv_forecast',
};

// How far ahead the forecast triggers look.
const FORECAST_WINDOW_SECONDS = 24 * 3600;

// The option of the `level` select that hands over to the `threshold` field.
// A published value: never renamed.
const CUSTOM_LEVEL = 'custom';

// Forecast levels. `metric` is the forecast figure the level reads (always
// metric: °C, and km/h for the wind, converted from the m/s of MF), `below`
// says which side of the threshold is the alert. A daily level has a
// `dayStartHour`, the local hour its day starts at (noon for a night of
// frost); an episode level has a `margin`, how far back the forecast must go
// to re-arm it.
// `thresholds` is the ladder watched, the bounds of the `threshold` field;
// `levels` are the fixed shortcuts, whose thresholds sit on the ladder. Level
// keys are published values of the `level` field: never renamed.
const FORECAST_LEVELS = {
  [SCENE_TRIGGERS.FROST_FORECAST]: {
    metric: 'temperature_min',
    below: true,
    dayStartHour: 12,
    thresholds: { min: -20, max: 5, step: 1 },
    levels: [
      { level: 'frost', threshold: 0 },
      { level: 'hard_frost', threshold: -5 },
    ],
  },
  [SCENE_TRIGGERS.HEAT_FORECAST]: {
    metric: 'temperature_max',
    below: false,
    dayStartHour: 0,
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
 * and km/h (MF gives the wind in m/s), with the moment each is reached. The
 * temperatures are split by day (see `dayStartHour`), in time order: one
 * extreme for each day the window touches.
 * @param {object} data - The raw forecast payload.
 * @param {number} [nowSeconds] - Current time in seconds (for tests).
 * @param {string|null} [timezone] - The IANA timezone of the place.
 * @returns {{temperature_min: Array<{day: string, value: number, dt: number}>,
 *   temperature_max: Array<{day: string, value: number, dt: number}>,
 *   wind_gust: {value: number, dt: number}|null}} The extremes.
 * @example
 * readForecastExtremes(rawForecast, now, 'Europe/Paris');
 */
function readForecastExtremes(data, nowSeconds = Math.floor(Date.now() / 1000), timezone = null) {
  const hourly = Array.isArray(data && data.forecast) ? data.forecast : [];
  // The hour under way counts (30-minute grace, like the pivot hours).
  const window = hourly
    .filter(
      (entry) =>
        entry &&
        Number.isFinite(entry.dt) &&
        entry.dt >= nowSeconds - 1800 &&
        entry.dt < nowSeconds + FORECAST_WINDOW_SECONDS,
    )
    .sort((a, b) => a.dt - b.dt);
  const isBetter = (value, best, better) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (best === undefined || better(value, best.value));
  const extreme = (read, better) =>
    window.reduce((best, entry) => {
      const value = read(entry);
      return isBetter(value, best === null ? undefined : best, better)
        ? { value, dt: entry.dt }
        : best;
    }, null);
  const temperature = (entry) => entry.T && entry.T.value;
  const daily = (trigger, better) => {
    const shift = FORECAST_LEVELS[trigger].dayStartHour * 3600;
    const days = new Map();
    window.forEach((entry) => {
      const value = temperature(entry);
      const day = dayKey(entry.dt - shift, timezone);
      if (isBetter(value, days.get(day), better)) {
        days.set(day, { day, value, dt: entry.dt });
      }
    });
    return [...days.values()];
  };
  return {
    temperature_min: daily(SCENE_TRIGGERS.FROST_FORECAST, (a, b) => a < b),
    temperature_max: daily(SCENE_TRIGGERS.HEAT_FORECAST, (a, b) => a > b),
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
 * @description Whether a forecast figure reaches a threshold.
 * @param {object} config - A FORECAST_LEVELS entry.
 * @param {number} value - The forecast figure.
 * @param {number} threshold - The threshold.
 * @returns {boolean} True when reached.
 * @example
 * reaches(FORECAST_LEVELS.frost_forecast, -1, 0); // -> true
 */
function reaches({ below }, value, threshold) {
  return below ? value <= threshold : value >= threshold;
}

/**
 * @description The events of a threshold newly reached: its "custom" event,
 * preceded by the event of the fixed level sitting on it, if any.
 * @param {string} trigger - The trigger key.
 * @param {object} config - Its FORECAST_LEVELS entry.
 * @param {number} threshold - The threshold reached.
 * @param {{value: number, dt: number}} extreme - The figure reaching it.
 * @returns {Array<object>} The events.
 * @example
 * thresholdEvents('heat_forecast', config, 30, { value: 31, dt });
 */
function thresholdEvents(trigger, { levels }, threshold, { value, dt }) {
  const event = { trigger, threshold, value, dt };
  const fixed = levels.find((candidate) => candidate.threshold === threshold);
  return [
    ...(fixed === undefined ? [] : [{ ...event, level: fixed.level }]),
    { ...event, level: CUSTOM_LEVEL },
  ];
}

/**
 * @description Daily levels: every threshold each day of the window reaches
 * for the first time. `states` is mutated; the first run is a baseline.
 * @param {Map<string, string>} states - The memory of the house.
 * @param {string} trigger - The trigger key.
 * @param {object} config - Its FORECAST_LEVELS entry.
 * @param {Array<{day: string, value: number, dt: number}>} days - The extremes by day.
 * @returns {Array<object>} The events.
 * @example
 * evaluateDailyLevels(new Map(), 'heat_forecast', config, days); // -> [] (baseline)
 */
function evaluateDailyLevels(states, trigger, config, days) {
  if (days.length === 0) {
    // No figure this run: keep the memory as it is.
    return [];
  }
  // Forget the days the window has left.
  const firstDay = days[0].day;
  [...states.keys()]
    .filter((key) => {
      const [prefix, day] = key.split(':');
      return prefix === trigger && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < firstDay;
    })
    .forEach((key) => states.delete(key));
  const baselineKey = `${trigger}:baseline`;
  const baseline = !states.has(baselineKey);
  states.set(baselineKey, 'done');
  const events = [];
  days.forEach((extreme) => {
    forecastThresholds(config)
      .filter((threshold) => reaches(config, extreme.value, threshold))
      .forEach((threshold) => {
        const key = `${trigger}:${extreme.day}:${threshold}`;
        if (states.has(key)) {
          return;
        }
        states.set(key, 'fired');
        if (!baseline) {
          events.push(...thresholdEvents(trigger, config, threshold, extreme));
        }
      });
  });
  return events;
}

/**
 * @description Episode levels: one state machine per threshold, firing when
 * the forecast reaches it and re-arming once it is clear by the margin.
 * `states` is mutated; the first run is a baseline.
 * @param {Map<string, string>} states - The memory of the house.
 * @param {string} trigger - The trigger key.
 * @param {object} config - Its FORECAST_LEVELS entry.
 * @param {{value: number, dt: number}|null} extreme - The extreme of the window.
 * @returns {Array<object>} The events.
 * @example
 * evaluateEpisodeLevels(new Map(), 'wind_forecast', config, extreme); // -> [] (baseline)
 */
function evaluateEpisodeLevels(states, trigger, config, extreme) {
  if (extreme === null || extreme === undefined) {
    // No figure this run: keep the memory as it is.
    return [];
  }
  const { below, margin } = config;
  const events = [];
  forecastThresholds(config).forEach((threshold) => {
    const key = `${trigger}:${threshold}`;
    const isReached = reaches(config, extreme.value, threshold);
    const isClear = below ? extreme.value > threshold + margin : extreme.value < threshold - margin;
    const previous = states.get(key);
    if (previous === undefined) {
      // Baseline: remember, never fire.
      states.set(key, isReached ? 'reached' : 'clear');
      return;
    }
    if (previous === 'clear' && isReached) {
      states.set(key, 'reached');
      events.push(...thresholdEvents(trigger, config, threshold, extreme));
    } else if (previous === 'reached' && isClear) {
      states.set(key, 'clear');
    }
  });
  return events;
}

/**
 * @description Run the forecast levels of one house over new extremes.
 * `states` is mutated: it is the memory of the house. A threshold newly
 * reached yields its "custom" event, preceded by the event of the fixed level
 * sitting on it, if any.
 * @param {Map<string, string>} states - The memory of the house.
 * @param {object} extremes - The readForecastExtremes() result.
 * @returns {Array<{trigger: string, level: string, threshold: number, value: number, dt: number}>}
 * The events to publish.
 * @example
 * evaluateForecastLevels(new Map(), extremes); // -> [] (baseline)
 */
function evaluateForecastLevels(states, extremes) {
  return Object.entries(FORECAST_LEVELS).flatMap(([trigger, config]) => {
    const extreme = extremes[config.metric];
    return config.dayStartHour === undefined
      ? evaluateEpisodeLevels(states, trigger, config, extreme)
      : evaluateDailyLevels(states, trigger, config, extreme || []);
  });
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
  describeMoment,
};
