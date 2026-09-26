// -----------------------------------------------------------------------------
// Hoar frost risk of the coming morning (scene action get_frost_risk).
//
// MF publishes no dew point, only the temperature and the relative humidity
// of each hour. So, hour by hour, from now until 10:00 of the coming morning:
//
//   1. the dew point, from the temperature and the humidity (Magnus formula);
//   2. the frost point, from the dew point and the temperature;
//   3. the level, from the temperature and the frost point:
//        2 frost likely  T <= 1 and Tf <= 0, or T <= 0 and Tf <= -2
//        1 frost risk    T <= 3 and Tf <= 0
//        0 no frost      otherwise
//   4. hoar frost forms by radiative cooling, under a clear sky and a light
//      wind: an overcast sky or a steady wind lowers the level by one.
//
// The morning keeps its worst hour. The raw MF figures are used, never the
// pivot ones: the pivot rounds temperatures to the degree, too coarse for
// thresholds this close to 0 °C.
//
// Every function here is pure.
// -----------------------------------------------------------------------------

import { dayKey, toKilometersPerHour } from './forecast.js';
import { formatLocalTime } from './scene-text.js';

const FROST_LEVELS = { NONE: 0, RISK: 1, LIKELY: 2 };

// The morning ends at this local hour (excluded).
const MORNING_END_HOUR = 10;

// From this cloud cover (%), the sky is overcast: no radiative cooling.
const OVERCAST_CLOUD_COVER = 80;

// From this mean wind (km/h), the air keeps mixing: no radiative cooling.
const STEADY_WIND_KMH = 20;

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
 * @description Dew point from the temperature and the relative humidity
 * (Magnus formula, Alduchov and Eskridge coefficients).
 * @param {number} temperature - The temperature, in °C.
 * @param {number} humidity - The relative humidity, in %.
 * @returns {number} The dew point, in °C.
 * @example
 * dewPoint(1, 90); // -> -0.46
 */
function dewPoint(temperature, humidity) {
  const gamma = Math.log(humidity / 100) + (17.625 * temperature) / (243.04 + temperature);
  return (243.04 * gamma) / (17.625 - gamma);
}

/**
 * @description Frost point from the dew point and the temperature.
 * @param {number} dew - The dew point, in °C.
 * @param {number} temperature - The temperature, in °C.
 * @returns {number} The frost point, in °C.
 * @example
 * frostPoint(-0.46, 1); // -> -0.57
 */
function frostPoint(dew, temperature) {
  const kelvin = temperature + 273.15;
  const dewKelvin = dew + 273.15;
  const correction = 2671.02 / (2954.61 / kelvin + 2.193665 * Math.log(kelvin) - 13.3448) - kelvin;
  return dewKelvin + correction - 273.15;
}

/**
 * @description Level of an hour from its temperature and frost point, before
 * the sky and the wind are taken into account.
 * @param {number} temperature - The temperature, in °C.
 * @param {number} frost - The frost point, in °C.
 * @returns {number} A FROST_LEVELS value.
 * @example
 * classifyFrost(0.5, -1); // -> 2
 */
function classifyFrost(temperature, frost) {
  if ((temperature <= 1 && frost <= 0) || (temperature <= 0 && frost <= -2)) {
    return FROST_LEVELS.LIKELY;
  }
  if (temperature <= 3 && frost <= 0) {
    return FROST_LEVELS.RISK;
  }
  return FROST_LEVELS.NONE;
}

/**
 * @description Local hour (0-23) of a moment.
 * @param {number} dt - The moment, in seconds.
 * @param {string|null} timezone - The IANA timezone of the place.
 * @returns {number} The hour.
 * @example
 * localHour(1785866400, 'Europe/Paris'); // -> 20
 */
function localHour(dt, timezone) {
  return Number(formatLocalTime(dt, timezone).slice(0, 2));
}

/**
 * @description Evaluate one hourly entry of the raw forecast.
 * @param {object} entry - A raw `forecast[]` entry.
 * @returns {object|null} The hour, or null without temperature or humidity.
 * @example
 * evaluateHour({ dt, T: { value: 1 }, humidity: 90, clouds: 10, wind: { speed: 5 } });
 */
function evaluateHour(entry) {
  const temperature = entry.T && entry.T.value;
  const { humidity } = entry;
  if (!isNumber(temperature) || !isNumber(humidity) || humidity <= 0 || humidity > 100) {
    return null;
  }
  const dew = dewPoint(temperature, humidity);
  const frost = frostPoint(dew, temperature);
  const baseLevel = classifyFrost(temperature, frost);
  const cloudCover = isNumber(entry.clouds) ? entry.clouds : null;
  // MF gives the wind in m/s, the threshold is in km/h.
  const windSpeed =
    entry.wind && isNumber(entry.wind.speed) ? toKilometersPerHour(entry.wind.speed) : null;
  const overcast = cloudCover !== null && cloudCover >= OVERCAST_CLOUD_COVER;
  const windy = windSpeed !== null && windSpeed >= STEADY_WIND_KMH;
  const reduced = baseLevel > FROST_LEVELS.NONE && (overcast || windy);
  return {
    dt: entry.dt,
    temperature,
    humidity,
    dewPoint: dew,
    frostPoint: frost,
    cloudCover,
    windSpeed,
    baseLevel,
    level: reduced ? baseLevel - 1 : baseLevel,
    reduced,
    overcast: reduced && overcast,
    windy: reduced && windy,
  };
}

/**
 * @description Frost risk of the coming morning: every hour from the one under
 * way until 10:00 of the morning to come (this morning before 10:00, tomorrow
 * morning after), and the worst of them — the highest level, then the coldest
 * hour, then the earliest.
 * @param {object} data - The raw forecast payload.
 * @param {string|null} timezone - The IANA timezone of the place.
 * @param {number} [nowSeconds] - Current time in seconds (for tests).
 * @returns {{date: string, today: boolean, worst: object}} The morning.
 * @throws {Error} When the forecast carries no usable hour for that morning.
 * @example
 * evaluateFrostRisk(rawForecast, 'Europe/Paris');
 */
function evaluateFrostRisk(data, timezone, nowSeconds = Math.floor(Date.now() / 1000)) {
  const today = localHour(nowSeconds, timezone) < MORNING_END_HOUR;
  const date = dayKey(today ? nowSeconds : nowSeconds + 86400, timezone);
  const hourly = Array.isArray(data && data.forecast) ? data.forecast : [];
  const hours = hourly
    .filter((entry) => entry && isNumber(entry.dt) && entry.dt >= nowSeconds - 1800)
    .filter((entry) => {
      const key = dayKey(entry.dt, timezone);
      return key < date || (key === date && localHour(entry.dt, timezone) < MORNING_END_HOUR);
    })
    .map(evaluateHour)
    .filter((hour) => hour !== null);
  if (hours.length === 0) {
    throw new Error(`Météo France has no hourly forecast until the morning of ${date}`);
  }
  const worst = hours.reduce((best, hour) => {
    if (hour.level !== best.level) {
      return hour.level > best.level ? hour : best;
    }
    if (hour.temperature !== best.temperature) {
      return hour.temperature < best.temperature ? hour : best;
    }
    return hour.dt < best.dt ? hour : best;
  });
  return { date, today, worst };
}

export {
  FROST_LEVELS,
  MORNING_END_HOUR,
  OVERCAST_CLOUD_COVER,
  STEADY_WIND_KMH,
  dewPoint,
  frostPoint,
  classifyFrost,
  evaluateHour,
  evaluateFrostRisk,
};
