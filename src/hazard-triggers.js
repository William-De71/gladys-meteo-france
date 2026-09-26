// -----------------------------------------------------------------------------
// Forecast hazard triggers: black ice, snow, storm and UV (manifest
// `scene_triggers`, keys in scene-triggers.js). Same doctrine as the other
// forecast triggers: a TRANSITION, published once, and a first evaluation that
// is a baseline and never fires.
//
//   - ice_forecast: the black ice level of the next 24 hours (see ice.js)
//     reaches "risk" or "likely". Each level re-arms once the next 24 hours
//     are back below it.
//   - snow_forecast: snow (or sleet) enters the next 24 hours. MF's snow
//     amounts come in an unconfirmed unit, so presence is what fires, never a
//     quantity.
//   - storm_forecast: a thunderstorm (or hail) enters the next 12 hours.
//   - uv_forecast: the UV index of the coming day — today until noon, tomorrow
//     after — reaches the chosen level. MF only publishes a daily index, so
//     each day fires once per threshold, usually around noon the day before.
//     Same custom threshold ladder as frost / heat / wind.
//
// The watcher adds a cooldown on ice / snow / storm, a forecast being able to
// hesitate from one run to the next. Every function here is pure.
// -----------------------------------------------------------------------------

import { convertTemperature, convertPrecipitation, dayKey } from './forecast.js';
import { parseWeather } from './conditions.js';
import { evaluateIceHours, pickIceHour, ICE_LEVELS } from './ice.js';
import { SCENE_TRIGGERS, CUSTOM_LEVEL, describeMoment } from './scene-triggers.js';
import {
  CONDITION_LABELS,
  ICE_LABELS,
  textLanguage,
  unitSymbols,
  formatNumber,
  formatLocalTime,
  uvLabel,
} from './scene-text.js';

// How far ahead each hazard is watched.
const ICE_WINDOW_SECONDS = 24 * 3600;
const SNOW_WINDOW_SECONDS = 24 * 3600;
const STORM_WINDOW_SECONDS = 12 * 3600;

// Pivot conditions that count as snow, and as a storm.
const SNOW_CONDITIONS = ['snow', 'sleet', 'snow-thunderstorm'];
const STORM_CONDITIONS = ['thunderstorm', 'snow-thunderstorm', 'hail'];

// Levels of the `level` field of ice_forecast. Published values: never renamed.
const ICE_TRIGGER_LEVELS = [
  { level: 'risk', minimum: ICE_LEVELS.RISK },
  { level: 'likely', minimum: ICE_LEVELS.LIKELY },
];

// UV levels: the ladder of the custom threshold, and the fixed shortcuts.
// Level keys are published values of the `level` field: never renamed.
const UV_LEVELS = {
  thresholds: { min: 1, max: 11, step: 1 },
  levels: [
    { level: 'uv_6', threshold: 6 },
    { level: 'uv_8', threshold: 8 },
    { level: 'uv_11', threshold: 11 },
  ],
};

// Past this local hour, the coming day of the UV trigger is tomorrow.
const UV_SWITCH_HOUR = 12;

/**
 * @description Whether a value is a usable finite number.
 * @param {any} value - The value to test.
 * @returns {boolean} True when the value is a finite number.
 * @example
 * isNumber(12); // -> true
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @description The raw hourly entries of a window starting with the hour under
 * way, in time order.
 * @param {object} data - The raw forecast payload.
 * @param {number} nowSeconds - Current time in seconds.
 * @param {number} windowSeconds - The width of the window.
 * @returns {Array<object>} The entries.
 * @example
 * windowEntries(data, now, 12 * 3600);
 */
function windowEntries(data, nowSeconds, windowSeconds) {
  const hourly = Array.isArray(data && data.forecast) ? data.forecast : [];
  return hourly
    .filter(
      (entry) =>
        entry &&
        isNumber(entry.dt) &&
        entry.dt >= nowSeconds - 1800 &&
        entry.dt < nowSeconds + windowSeconds,
    )
    .sort((a, b) => a.dt - b.dt);
}

/**
 * @description Whether a raw entry carries snow: a snowy sky, or a snow amount
 * (whatever its step and unit).
 * @param {object} entry - A raw `forecast[]` entry.
 * @returns {boolean} True when it snows.
 * @example
 * isSnowy({ weather: { desc: 'Neige' }, snow: { '1h': 0.4 } }); // -> true
 */
function isSnowy(entry) {
  if (SNOW_CONDITIONS.includes(parseWeather(entry.weather).condition)) {
    return true;
  }
  const snow = entry.snow || {};
  return ['1h', '3h', '6h'].some((step) => isNumber(snow[step]) && snow[step] > 0);
}

/**
 * @description Highest snow probability of the slices a window touches.
 * @param {Array<object>} probabilities - The raw `probability_forecast` array.
 * @param {number} from - Window start, in seconds.
 * @param {number} to - Window end, in seconds.
 * @returns {number|null} The probability 0-100, or null when none.
 * @example
 * readSnowProbability(data.probability_forecast, now, now + 86400); // -> 60
 */
function readSnowProbability(probabilities, from, to) {
  const values = (Array.isArray(probabilities) ? probabilities : [])
    .filter((slice) => slice && isNumber(slice.dt) && slice.dt >= from - 6 * 3600 && slice.dt < to)
    .flatMap((slice) => ['3h', '6h'].map((step) => slice.snow && slice.snow[step]))
    .filter(isNumber);
  return values.length === 0 ? null : Math.max(...values);
}

/**
 * @description Lowest rain-snow limit of a list of raw entries (MF sends a
 * number of metres as a string, or "Non pertinent").
 * @param {Array<object>} entries - Raw `forecast[]` entries.
 * @returns {number|null} The limit in metres, or null when none applies.
 * @example
 * readRainSnowLimit([{ 'rain snow limit': '800' }]); // -> 800
 */
function readRainSnowLimit(entries) {
  const values = entries
    .map((entry) => Number(entry['rain snow limit']))
    .filter((value) => isNumber(value) && value > 0);
  return values.length === 0 ? null : Math.min(...values);
}

/**
 * @description Run a presence state machine: fire when the hazard appears,
 * re-arm when it is gone. `states` is mutated.
 * @param {Map<string, string>} states - The memory of the house.
 * @param {string} key - The state key.
 * @param {boolean} present - Whether the hazard is in the window.
 * @returns {boolean} True when the hazard just appeared.
 * @example
 * appeared(states, 'snow_forecast', true);
 */
function appeared(states, key, present) {
  const previous = states.get(key);
  states.set(key, present ? 'present' : 'absent');
  // Undefined: baseline, never fires.
  return previous === 'absent' && present;
}

/**
 * @description The UV thresholds, lowest first.
 * @returns {Array<number>} The ladder.
 * @example
 * uvThresholds(); // -> [1, 2, ..., 11]
 */
function uvThresholds() {
  const { min, max, step } = UV_LEVELS.thresholds;
  const ladder = [];
  for (let threshold = min; threshold <= max; threshold += step) {
    ladder.push(threshold);
  }
  return ladder;
}

/**
 * @description The UV events of a poll: every threshold the coming day
 * reaches for the first time (its "custom" event, preceded by the fixed level
 * sitting on it). `states` is mutated; the first poll is a baseline.
 * @param {Map<string, string>} states - The memory of the house.
 * @param {object} data - The raw forecast payload.
 * @param {string|null} timezone - The IANA timezone of the place.
 * @param {number} nowSeconds - Current time in seconds.
 * @returns {Array<object>} The events.
 * @example
 * detectUvLevels(new Map(), data, 'Europe/Paris', now); // -> [] (baseline)
 */
function detectUvLevels(states, data, timezone, nowSeconds) {
  const todayKey = dayKey(nowSeconds, timezone);
  const hour = Number(formatLocalTime(nowSeconds, timezone).slice(0, 2));
  const date = hour < UV_SWITCH_HOUR ? todayKey : dayKey(nowSeconds + 86400, timezone);
  // Forget the past days.
  [...states.keys()]
    .filter((key) => /^uv:\d{4}-\d{2}-\d{2}:/.test(key) && key.slice(3, 13) < todayKey)
    .forEach((key) => states.delete(key));
  // A daily entry is stamped at 00:00 UTC of the local day it describes.
  const daily = Array.isArray(data && data.daily_forecast) ? data.daily_forecast : [];
  const entry = daily.find((candidate) => candidate && dayKey(candidate.dt, null) === date);
  if (!entry || !isNumber(entry.uv)) {
    return [];
  }
  const baseline = !states.has('uv:baseline');
  states.set('uv:baseline', 'done');
  const events = [];
  uvThresholds()
    .filter((threshold) => entry.uv >= threshold)
    .forEach((threshold) => {
      const key = `uv:${date}:${threshold}`;
      if (states.has(key)) {
        return;
      }
      states.set(key, 'fired');
      if (baseline) {
        return;
      }
      const event = {
        trigger: SCENE_TRIGGERS.UV_FORECAST,
        threshold,
        uv: entry.uv,
        date,
        today: date === todayKey,
      };
      const fixed = UV_LEVELS.levels.find((candidate) => candidate.threshold === threshold);
      if (fixed !== undefined) {
        events.push({ ...event, level: fixed.level });
      }
      events.push({ ...event, level: CUSTOM_LEVEL });
    });
  return events;
}

/**
 * @description The hazard events of a forecast poll for one house. `states`
 * is mutated: it is the memory of the house.
 * @param {Map<string, string>} states - The memory of the house.
 * @param {object} data - The raw forecast payload.
 * @param {object} context - { timezone, nowSeconds }.
 * @returns {Array<object>} The events: { trigger, level?, dt?, ... }.
 * @example
 * detectForecastHazards(new Map(), data, { timezone: 'Europe/Paris', nowSeconds }); // -> []
 */
function detectForecastHazards(states, data, { timezone, nowSeconds }) {
  const events = [];

  // Black ice: one state machine per level.
  const iceHours = evaluateIceHours(
    data && data.forecast,
    (dt) => dt >= nowSeconds - 1800 && dt < nowSeconds + ICE_WINDOW_SECONDS,
  );
  if (iceHours.length > 0) {
    ICE_TRIGGER_LEVELS.forEach(({ level, minimum }) => {
      const reached = iceHours.filter((hour) => hour.level >= minimum);
      if (appeared(states, `ice:${level}`, reached.length > 0)) {
        const hour = pickIceHour(reached);
        events.push({ trigger: SCENE_TRIGGERS.ICE_FORECAST, level, iceLevel: hour.level, hour });
      }
    });
  }

  // Snow in the next 24 hours.
  const snowWindow = windowEntries(data, nowSeconds, SNOW_WINDOW_SECONDS);
  if (snowWindow.length > 0) {
    const firstSnow = snowWindow.find(isSnowy);
    if (appeared(states, 'snow', firstSnow !== undefined)) {
      events.push({
        trigger: SCENE_TRIGGERS.SNOW_FORECAST,
        dt: firstSnow.dt,
        condition: parseWeather(firstSnow.weather).condition,
        probability: readSnowProbability(
          data.probability_forecast,
          nowSeconds,
          nowSeconds + SNOW_WINDOW_SECONDS,
        ),
        limit: readRainSnowLimit(snowWindow),
      });
    }
  }

  // Storm in the next 12 hours.
  const stormWindow = windowEntries(data, nowSeconds, STORM_WINDOW_SECONDS);
  if (stormWindow.length > 0) {
    const firstStorm = stormWindow.find((entry) =>
      STORM_CONDITIONS.includes(parseWeather(entry.weather).condition),
    );
    if (appeared(states, 'storm', firstStorm !== undefined)) {
      events.push({
        trigger: SCENE_TRIGGERS.STORM_FORECAST,
        dt: firstStorm.dt,
        condition: parseWeather(firstStorm.weather).condition,
      });
    }
  }

  return events.concat(detectUvLevels(states, data, timezone, nowSeconds));
}

/**
 * @description Data of a hazard trigger: the house (and the level, matched
 * against the filters), and the figures as scene variables, in the unit
 * system of the instance.
 * @param {object} event - A detectForecastHazards() entry.
 * @param {string} house - The house name.
 * @param {object} context - { timezone, units, language, nowSeconds }.
 * @returns {object} The flat event data.
 * @example
 * buildHazardEventData(event, 'Maison', { timezone: 'Europe/Paris', units: 'metric', language: 'fr' });
 */
function buildHazardEventData(
  event,
  house,
  { timezone, units, language, nowSeconds = Math.floor(Date.now() / 1000) },
) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const fr = lang === 'fr';

  if (event.trigger === SCENE_TRIGGERS.UV_FORECAST) {
    const label = uvLabel(event.uv, lang);
    let when;
    if (fr) {
      when = event.today ? "aujourd'hui" : 'demain';
    } else {
      when = event.today ? 'today' : 'tomorrow';
    }
    return {
      house,
      level: event.level,
      threshold: event.threshold,
      uv_index: event.uv,
      uv_label: label,
      date: event.date,
      summary: fr
        ? `Indice UV de ${event.uv} (${label}) prévu ${when}.`
        : `UV index of ${event.uv} (${label}) expected ${when}.`,
    };
  }

  const dt = event.trigger === SCENE_TRIGGERS.ICE_FORECAST ? event.hour.dt : event.dt;
  const moment = describeMoment(dt, timezone, lang, nowSeconds);
  const data = {
    house,
    time: formatLocalTime(dt, timezone),
    hours_until: Math.max(0, Math.round((dt - nowSeconds) / 3600)),
  };

  if (event.trigger === SCENE_TRIGGERS.ICE_FORECAST) {
    const { hour } = event;
    data.level = event.level;
    data.level_label = ICE_LABELS[lang][event.iceLevel];
    data.temperature = convertTemperature(hour.temperature, units);
    data.freezing_rain = hour.freezingRain;
    data.recent_rain = convertPrecipitation(hour.recentRain, units);
    const degrees = `${data.temperature} ${symbols.temperature}`;
    let cause;
    if (hour.freezingRain) {
      cause = fr ? 'pluie verglaçante' : 'freezing rain';
    } else {
      const rain = `${formatNumber(data.recent_rain, lang)} ${symbols.precipitation}`;
      cause = fr ? `après ${rain} de pluie` : `after ${rain} of rain`;
    }
    data.summary = fr
      ? `${data.level_label} ${moment} : ${degrees}, ${cause}.`
      : `${data.level_label} ${moment}: ${degrees}, ${cause}.`;
    return data;
  }

  data.condition = event.condition;
  data.condition_label = CONDITION_LABELS[lang][event.condition] || event.condition;

  if (event.trigger === SCENE_TRIGGERS.SNOW_FORECAST) {
    let summary = fr ? `Neige annoncée ${moment}` : `Snow expected ${moment}`;
    if (isNumber(event.probability)) {
      data.snow_probability = event.probability;
      summary += fr ? ` (probabilité ${event.probability} %)` : ` (${event.probability}% chance)`;
    }
    summary += '.';
    if (isNumber(event.limit)) {
      data.rain_snow_limit = event.limit;
      summary += fr
        ? ` Limite pluie-neige à ${event.limit} m.`
        : ` Rain-snow limit at ${event.limit} m.`;
    }
    data.summary = summary;
    return data;
  }

  const storm = {
    fr: { hail: 'Grêle annoncée', 'snow-thunderstorm': 'Orages de neige annoncés' },
    en: { hail: 'Hail expected', 'snow-thunderstorm': 'Thundersnow expected' },
  };
  const fallback = fr ? 'Orages annoncés' : 'Thunderstorms expected';
  data.summary = `${storm[lang][event.condition] || fallback} ${moment}.`;
  return data;
}

export {
  ICE_TRIGGER_LEVELS,
  UV_LEVELS,
  UV_SWITCH_HOUR,
  SNOW_CONDITIONS,
  STORM_CONDITIONS,
  uvThresholds,
  isSnowy,
  detectUvLevels,
  detectForecastHazards,
  buildHazardEventData,
};
