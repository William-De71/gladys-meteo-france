// -----------------------------------------------------------------------------
// Raw Météo France forecast -> pivot weather format (contract B.18).
//
// The MF payload carries:
//   - `position`          { lat, lon, dept, timezone, ... }
//   - `forecast[]`        hourly entries (the FULL current day, past hours
//                         included) with T.value, weather, wind, rain['1h']...
//   - `daily_forecast[]`  daily entries with T.min/T.max, weather12H (which can
//                         be null on some days), precipitation['24h'], uv, sun_*
//   - `probability_forecast[]` precipitation probabilities, per 3h-6h slices
//
// Unit handling: MF always answers in METRIC (°C, m/s, mm, hPa). The pivot
// contract says the integration must answer in the REQUESTED unit system, so
// the `us` case converts here — the core never converts for us.
// -----------------------------------------------------------------------------

import { parseWeather } from './conditions.js';

// Pivot caps (the core enforces them too, but sending less is cheaper).
const MAX_HOURS = 24;
const MAX_DAYS = 8;

// Above this hourly rain amount, `rain` becomes `pouring`. 7.6 mm/h is the
// conventional "heavy rain" threshold (NWS), and MF has no dedicated icon code.
const POURING_THRESHOLD_MM_PER_HOUR = 7.6;

/**
 * @description Convert a Celsius temperature to the requested unit system.
 * @param {number} celsius - The temperature in °C.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number} The converted temperature, rounded to one decimal.
 * @example
 * convertTemperature(20, 'us'); // -> 68
 */
function convertTemperature(celsius, units) {
  if (units !== 'us') {
    return celsius;
  }
  return Math.round((celsius * (9 / 5) + 32) * 10) / 10;
}

/**
 * @description Convert a wind speed from m/s (what MF returns) to the requested
 * unit system: m/s for metric, mph for us.
 * @param {number} metersPerSecond - The speed in m/s.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number} The converted speed, rounded to one decimal.
 * @example
 * convertWindSpeed(10, 'us'); // -> 22.4
 */
function convertWindSpeed(metersPerSecond, units) {
  if (units !== 'us') {
    return metersPerSecond;
  }
  return Math.round(metersPerSecond * 2.23694 * 10) / 10;
}

/**
 * @description Convert a precipitation amount from mm to the requested unit
 * system: mm for metric, inches for us.
 * @param {number} millimeters - The amount in mm.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number} The converted amount, rounded to two decimals.
 * @example
 * convertPrecipitation(25.4, 'us'); // -> 1
 */
function convertPrecipitation(millimeters, units) {
  if (units !== 'us') {
    return millimeters;
  }
  return Math.round((millimeters / 25.4) * 100) / 100;
}

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
 * @description Convert a Météo France UNIX timestamp (seconds) to an ISO date.
 * @param {number} timestamp - The timestamp in seconds.
 * @returns {string|null} The ISO 8601 date, or null when unusable.
 * @example
 * toIsoDate(1754300000); // -> '2025-08-04T...'
 */
function toIsoDate(timestamp) {
  if (!isNumber(timestamp)) {
    return null;
  }
  return new Date(timestamp * 1000).toISOString();
}

/**
 * @description Refine a rain condition into `pouring` when the hourly amount
 * crosses the heavy-rain threshold. MF has no icon code for it.
 * @param {string} condition - The pivot condition from the icon code.
 * @param {number|null} rainMillimeters - The hourly rain amount in mm.
 * @returns {string} The possibly refined condition.
 * @example
 * refineRainIntensity('rain', 9); // -> 'pouring'
 */
function refineRainIntensity(condition, rainMillimeters) {
  if (condition !== 'rain' || !isNumber(rainMillimeters)) {
    return condition;
  }
  return rainMillimeters >= POURING_THRESHOLD_MM_PER_HOUR ? 'pouring' : condition;
}

/**
 * @description Read the hourly rain amount, whichever step the entry uses.
 * @param {object} entry - A raw hourly forecast entry.
 * @returns {number|null} The amount in mm, or null when absent.
 * @example
 * readHourlyRain({ rain: { '1h': 2.4 } }); // -> 2.4
 */
function readHourlyRain(entry) {
  const rain = entry && entry.rain;
  if (!rain) {
    return null;
  }
  if (isNumber(rain['1h'])) {
    return rain['1h'];
  }
  if (isNumber(rain['3h'])) {
    return rain['3h'];
  }
  return null;
}

/**
 * @description Find the precipitation probability covering a timestamp. MF
 * publishes them on 3h/6h slices, so the matching slice is the last one that
 * started at or before the entry.
 * @param {Array<object>} probabilities - The `probability_forecast` array.
 * @param {number} timestamp - The entry timestamp in seconds.
 * @returns {number|null} The probability 0-100, or null when unavailable.
 * @example
 * findProbability(probabilities, 1754300000);
 */
function findProbability(probabilities, timestamp) {
  if (!Array.isArray(probabilities)) {
    return null;
  }
  let best = null;
  probabilities.forEach((slice) => {
    if (!isNumber(slice.dt) || slice.dt > timestamp) {
      return;
    }
    if (best === null || slice.dt > best.dt) {
      best = slice;
    }
  });
  if (best === null) {
    return null;
  }
  // MF splits the probability per phenomenon: the overall chance of any
  // precipitation is the highest of them.
  const candidates = [
    best.rain_hazard_3h,
    best.rain_hazard_6h,
    best.snow_hazard_3h,
    best.snow_hazard_6h,
  ];
  const values = candidates.filter(isNumber);
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

/**
 * @description Pick the hourly entry that best describes a day, used when
 * `weather12H` is null (it happens on the current and last days).
 * @param {Array<object>} hourly - The raw hourly entries.
 * @param {number} dayTimestamp - Start of the day, in seconds.
 * @returns {object|null} The entry closest to midday, or null.
 * @example
 * findMiddayEntry(hourly, 1754265600);
 */
function findMiddayEntry(hourly, dayTimestamp) {
  const midday = dayTimestamp + 12 * 3600;
  return hourly.reduce((best, entry) => {
    if (!isNumber(entry.dt) || !entry.weather) {
      return best;
    }
    if (entry.dt < dayTimestamp || entry.dt >= dayTimestamp + 24 * 3600) {
      return best;
    }
    if (best === null || Math.abs(entry.dt - midday) < Math.abs(best.dt - midday)) {
      return entry;
    }
    return best;
  }, null);
}

/**
 * @description Build the pivot `hours` array from the raw hourly entries.
 * @param {Array<object>} hourly - The raw `forecast` array.
 * @param {Array<object>} probabilities - The raw `probability_forecast` array.
 * @param {string} units - The requested unit system.
 * @param {number} nowSeconds - Current time in seconds.
 * @returns {Array<object>} The pivot hours (≤ 24 entries).
 * @example
 * buildHours(forecast.forecast, forecast.probability_forecast, 'metric', 1754300000);
 */
function buildHours(hourly, probabilities, units, nowSeconds) {
  return (
    hourly
      // The payload includes the full current day: drop the past, keeping the
      // running hour (a 30-minute grace, as the pilot widget did).
      .filter((entry) => isNumber(entry.dt) && entry.dt >= nowSeconds - 1800)
      .slice(0, MAX_HOURS)
      .map((entry) => {
        const temperature = entry.T && entry.T.value;
        const datetime = toIsoDate(entry.dt);
        if (!isNumber(temperature) || datetime === null) {
          return null;
        }
        const { condition, isDay } = parseWeather(entry.weather);
        const rain = readHourlyRain(entry);
        const hour = {
          temperature: convertTemperature(temperature, units),
          weather: refineRainIntensity(condition, rain),
          datetime,
        };
        if (isDay !== null) {
          hour.is_day = isDay;
        }
        if (isNumber(entry.humidity)) {
          hour.humidity = entry.humidity;
        }
        if (entry.T && isNumber(entry.T.windchill)) {
          hour.apparent_temperature = convertTemperature(entry.T.windchill, units);
        }
        if (isNumber(entry.sea_level)) {
          hour.pressure = entry.sea_level;
        }
        if (entry.wind) {
          if (isNumber(entry.wind.speed)) {
            hour.wind_speed = convertWindSpeed(entry.wind.speed, units);
          }
          if (isNumber(entry.wind.gust) && entry.wind.gust > 0) {
            hour.wind_gust = convertWindSpeed(entry.wind.gust, units);
          }
          // MF uses -1 for "variable wind": not a bearing, so it is dropped.
          if (isNumber(entry.wind.direction) && entry.wind.direction >= 0) {
            hour.wind_direction = entry.wind.direction;
          }
        }
        if (rain !== null) {
          hour.precipitation = convertPrecipitation(rain, units);
        }
        const probability = findProbability(probabilities, entry.dt);
        if (probability !== null) {
          hour.precipitation_probability = probability;
        }
        return hour;
      })
      .filter((hour) => hour !== null)
  );
}

/**
 * @description Build the pivot `days` array from the raw daily entries.
 * @param {Array<object>} daily - The raw `daily_forecast` array.
 * @param {Array<object>} hourly - The raw `forecast` array (weather12H fallback).
 * @param {string} units - The requested unit system.
 * @returns {Array<object>} The pivot days (≤ 8 entries).
 * @example
 * buildDays(forecast.daily_forecast, forecast.forecast, 'metric');
 */
function buildDays(daily, hourly, units) {
  return daily
    .slice(0, MAX_DAYS)
    .map((entry) => {
      const temperatureMin = entry.T && entry.T.min;
      const temperatureMax = entry.T && entry.T.max;
      const datetime = toIsoDate(entry.dt);
      if (!isNumber(temperatureMin) || !isNumber(temperatureMax) || datetime === null) {
        return null;
      }
      const day = {
        temperature_min: convertTemperature(temperatureMin, units),
        temperature_max: convertTemperature(temperatureMax, units),
        datetime,
      };
      // weather12H is null on some days: fall back to the hourly entry closest
      // to midday rather than dropping the condition entirely.
      let weather = entry.weather12H;
      if (!weather || !weather.icon) {
        const middayEntry = findMiddayEntry(hourly, entry.dt);
        weather = middayEntry ? middayEntry.weather : null;
      }
      if (weather) {
        day.weather = parseWeather(weather).condition;
      }
      if (isNumber(entry.humidity && entry.humidity.max)) {
        day.humidity = entry.humidity.max;
      }
      if (entry.precipitation && isNumber(entry.precipitation['24h'])) {
        day.precipitation = convertPrecipitation(entry.precipitation['24h'], units);
      }
      if (isNumber(entry.uv)) {
        day.uv_index = entry.uv;
      }
      const sunrise = toIsoDate(entry.sun && entry.sun.rise);
      if (sunrise !== null) {
        day.sunrise = sunrise;
      }
      const sunset = toIsoDate(entry.sun && entry.sun.set);
      if (sunset !== null) {
        day.sunset = sunset;
      }
      return day;
    })
    .filter((day) => day !== null);
}

/**
 * @description Turn a raw Météo France forecast payload into the pivot weather
 * format (current conditions + hours + days). Alerts and images are added by
 * the caller, which owns the vigilance and the API key.
 * @param {object} data - The raw forecast payload.
 * @param {object} [options] - Options.
 * @param {string} [options.units] - The requested unit system ('metric'|'us').
 * @param {number} [options.nowSeconds] - Current time in seconds (for tests).
 * @returns {object} The pivot weather payload.
 * @example
 * const weather = buildWeather(rawForecast, { units: 'metric' });
 */
function buildWeather(data, { units = 'metric', nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const hourly = Array.isArray(data && data.forecast) ? data.forecast : [];
  const daily = Array.isArray(data && data.daily_forecast) ? data.daily_forecast : [];
  const probabilities = Array.isArray(data && data.probability_forecast)
    ? data.probability_forecast
    : [];

  const hours = buildHours(hourly, probabilities, units, nowSeconds);
  const days = buildDays(daily, hourly, units);

  // Current conditions = the first upcoming hourly entry. MF has no dedicated
  // "current" block in this endpoint, and the pilot widget did exactly this.
  const current = hours[0];
  if (current === undefined) {
    throw new Error('Météo France returned no usable forecast entry');
  }

  const weather = {
    temperature: current.temperature,
    weather: current.weather,
    datetime: current.datetime,
    hours,
    days,
  };

  // Copy the optional current fields the first hour already carries.
  const carried = [
    'apparent_temperature',
    'humidity',
    'pressure',
    'wind_speed',
    'wind_direction',
    'wind_gust',
    'is_day',
  ];
  carried.forEach((field) => {
    if (current[field] !== undefined) {
      weather[field] = current[field];
    }
  });

  // Today's UV index and sun times live on the daily entry covering `current`.
  const today = daily.find((entry) => {
    if (!isNumber(entry.dt)) {
      return false;
    }
    const start = entry.dt;
    return nowSeconds >= start && nowSeconds < start + 24 * 3600;
  });
  if (today) {
    if (isNumber(today.uv)) {
      weather.uv_index = today.uv;
    }
    const sunrise = toIsoDate(today.sun && today.sun.rise);
    if (sunrise !== null) {
      weather.sunrise = sunrise;
    }
    const sunset = toIsoDate(today.sun && today.sun.set);
    if (sunset !== null) {
      weather.sunset = sunset;
    }
  }

  return weather;
}

/**
 * @description Read the department number out of a raw forecast payload.
 * @param {object} data - The raw forecast payload.
 * @returns {string|null} The department (e.g. '06'), or null when absent.
 * @example
 * readDepartment(rawForecast); // -> '75'
 */
function readDepartment(data) {
  const department = data && data.position && data.position.dept;
  return typeof department === 'string' && department.length > 0 ? department : null;
}

export {
  buildWeather,
  readDepartment,
  convertTemperature,
  convertWindSpeed,
  convertPrecipitation,
  POURING_THRESHOLD_MM_PER_HOUR,
};
