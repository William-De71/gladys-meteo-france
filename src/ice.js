// -----------------------------------------------------------------------------
// Black ice (verglas) risk: scene action get_ice_risk and trigger ice_forecast.
//
// MF publishes no ground temperature and no ice forecast: its `freezing`
// probability is the chance of a temperature below 0 °C (80-90 % on the Mont
// Blanc summit at -7 °C, with no precipitation at all). So the risk is read
// hour by hour from what does make ice — water on a cold surface:
//
//   2 ice likely  freezing rain forecast, or rain with T <= 0 °C, or a surface
//                 wet from the last 6 hours with T <= -1 °C
//   1 ice risk    a surface wet from the last 6 hours with T <= 1 °C
//   0 no ice      otherwise
//
// "Wet" means rain in that hour or in the 6 hours before it. The air
// temperature stands for the ground one, hence the 1 °C margin of the risk.
// The raw MF hours are read (the pivot ones are rounded to the degree), and
// the look-back reaches the past hours of the day MF still carries.
//
// Every function here is pure.
// -----------------------------------------------------------------------------

import { parseWeather } from './conditions.js';

const ICE_LEVELS = { NONE: 0, RISK: 1, LIKELY: 2 };

// How far back rain keeps a surface wet.
const WET_LOOKBACK_SECONDS = 6 * 3600;

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
 * @description Rain amount of a raw entry, whichever step it uses.
 * @param {object} entry - A raw `forecast[]` entry.
 * @returns {number} The amount in mm, 0 when absent.
 * @example
 * readRainAmount({ rain: { '3h': 1.2 } }); // -> 1.2
 */
function readRainAmount(entry) {
  const rain = entry && entry.rain;
  if (!rain) {
    return 0;
  }
  const amount = ['1h', '3h', '6h'].map((step) => rain[step]).find(isNumber);
  return amount === undefined ? 0 : amount;
}

/**
 * @description Level of an hour.
 * @param {object} hour - { temperature, freezingRain, raining, wet }.
 * @returns {number} An ICE_LEVELS value.
 * @example
 * classifyIce({ temperature: -1.5, freezingRain: false, raining: false, wet: true }); // -> 2
 */
function classifyIce({ temperature, freezingRain, raining, wet }) {
  if (freezingRain || (raining && temperature <= 0) || (wet && temperature <= -1)) {
    return ICE_LEVELS.LIKELY;
  }
  if (wet && temperature <= 1) {
    return ICE_LEVELS.RISK;
  }
  return ICE_LEVELS.NONE;
}

/**
 * @description Evaluate the hours of a raw forecast a window includes.
 * @param {Array<object>} hourly - The raw `forecast[]` array.
 * @param {Function} includes - `(dt) => boolean`, the window.
 * @returns {Array<object>} The evaluated hours: { dt, temperature,
 * freezingRain, raining, wet, recentRain, level }.
 * @example
 * evaluateIceHours(data.forecast, (dt) => dt >= now);
 */
function evaluateIceHours(hourly, includes) {
  const entries = (Array.isArray(hourly) ? hourly : []).filter(
    (entry) => entry && isNumber(entry.dt),
  );
  return entries
    .filter((entry) => includes(entry.dt))
    .map((entry) => {
      const temperature = entry.T && entry.T.value;
      if (!isNumber(temperature)) {
        return null;
      }
      const recentRain = entries
        .filter((other) => other.dt <= entry.dt && other.dt >= entry.dt - WET_LOOKBACK_SECONDS)
        .reduce((sum, other) => sum + readRainAmount(other), 0);
      const hour = {
        dt: entry.dt,
        temperature,
        freezingRain: parseWeather(entry.weather).condition === 'freezing-rain',
        raining: readRainAmount(entry) > 0,
        wet: recentRain > 0,
        recentRain: Math.round(recentRain * 10) / 10,
      };
      hour.level = classifyIce(hour);
      return hour;
    })
    .filter((hour) => hour !== null);
}

/**
 * @description The hour that sums up a window: the first hour at the highest
 * level (when the ice sets in), or the coldest hour when there is none.
 * @param {Array<object>} hours - evaluateIceHours() entries, in time order.
 * @returns {object|null} The hour, or null for an empty window.
 * @example
 * pickIceHour(hours);
 */
function pickIceHour(hours) {
  if (hours.length === 0) {
    return null;
  }
  const level = Math.max(...hours.map((hour) => hour.level));
  if (level > ICE_LEVELS.NONE) {
    return hours.find((hour) => hour.level === level);
  }
  return hours.reduce((best, hour) => (hour.temperature < best.temperature ? hour : best));
}

/**
 * @description Highest `freezing` probability (chance of a temperature below
 * 0 °C) of the slices a window touches.
 * @param {Array<object>} probabilities - The raw `probability_forecast` array.
 * @param {Function} includes - `(dt) => boolean`, the window.
 * @returns {number|null} The probability 0-100, or null when none.
 * @example
 * readFreezingProbability(data.probability_forecast, includes); // -> 40
 */
function readFreezingProbability(probabilities, includes) {
  const values = (Array.isArray(probabilities) ? probabilities : [])
    .filter((slice) => slice && includes(slice.dt) && isNumber(slice.freezing))
    .map((slice) => slice.freezing);
  return values.length === 0 ? null : Math.max(...values);
}

export {
  ICE_LEVELS,
  WET_LOOKBACK_SECONDS,
  readRainAmount,
  classifyIce,
  evaluateIceHours,
  pickIceHour,
  readFreezingProbability,
};
