// -----------------------------------------------------------------------------
// Raw Météo France forecast -> pivot weather format (contract B.18).
//
// The MF payload carries:
//   - `position`          { lat, lon, dept, timezone, ... }
//   - `forecast[]`        hourly entries (the FULL current day, past hours
//                         included) with T.value, weather, wind, clouds,
//                         rain['1h']...
//   - `daily_forecast[]`  daily entries with T.min/T.max, weather12H (which can
//                         be null on some days), precipitation['24h'], uv, sun_*
//   - `probability_forecast[]` precipitation probabilities, per 3h-6h slices
//
// Unit handling: MF always answers in METRIC (°C, km/h, mm, hPa). The pivot
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
 * @description Convert a Celsius temperature to the requested unit system, and
 * round it to the nearest whole degree.
 *
 * The rounding is deliberate: the dashboard widget TRUNCATES the decimals it
 * receives, so MF's own 27.9 °C showed up as 27° next to the 28° printed by
 * meteofrance.com. Rounding here is what makes the two agree — the decimal is
 * false precision on a forecast anyway.
 * @param {number} celsius - The temperature in °C.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number} The converted temperature, rounded to the nearest degree.
 * @example
 * convertTemperature(27.9, 'metric'); // -> 28
 */
function convertTemperature(celsius, units) {
  // `+ 0` normalises the -0 Math.round returns just below zero. JSON already
  // serialises it as 0, so this guards the in-memory value for any consumer
  // reading the number directly.
  if (units !== 'us') {
    return Math.round(celsius) + 0;
  }
  return Math.round(celsius * (9 / 5) + 32) + 0;
}

/**
 * @description Convert a wind speed from km/h (what MF returns) to the
 * requested unit system: km/h for metric, mph for us.
 *
 * The unit is km/h, NOT m/s: the mobile webservice answers with the very
 * numbers meteofrance.com prints next to a wind arrow. Reading them as m/s
 * made the `us` conversion overstate the wind by a factor of ~3.6.
 * @param {number} kilometersPerHour - The speed in km/h.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number} The converted speed, rounded to one decimal.
 * @example
 * convertWindSpeed(10, 'us'); // -> 6.2
 */
function convertWindSpeed(kilometersPerHour, units) {
  if (units !== 'us') {
    return kilometersPerHour;
  }
  return Math.round(kilometersPerHour * 0.621371 * 10) / 10;
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
 * @description Read the probability of one `probability_forecast` slice. MF
 * nests them per phenomenon and per step: `rain['3h']`, and only `rain['6h']`
 * on the far days where the 3h step is no longer published (the '3h' key is
 * then present but null). The overall chance of any precipitation is the
 * highest of the phenomena.
 * @param {object} slice - A raw `probability_forecast` entry.
 * @returns {{value: number, hours: number}|null} The probability 0-100 and the
 * width of the slice in hours, or null when the slice carries none.
 * @example
 * readSliceProbability({ rain: { '3h': 40, '6h': 40 } }); // -> { value: 40, hours: 3 }
 */
function readSliceProbability(slice) {
  if (!slice || typeof slice !== 'object') {
    return null;
  }
  const atStep = (step) => [slice.rain, slice.snow].map((p) => p && p[step]).filter(isNumber);

  const threeHour = atStep('3h');
  if (threeHour.length > 0) {
    return { value: Math.max(...threeHour), hours: 3 };
  }
  const sixHour = atStep('6h');
  if (sixHour.length > 0) {
    return { value: Math.max(...sixHour), hours: 6 };
  }
  return null;
}

/**
 * @description Find the precipitation probability covering a timestamp. MF
 * publishes them on 3h/6h slices, so the matching slice is the last one that
 * started at or before the entry — provided the entry still falls inside it,
 * otherwise a gap in the array would leak a stale value onto later hours.
 * @param {Array<object>} probabilities - The `probability_forecast` array.
 * @param {number} timestamp - The entry timestamp in seconds.
 * @returns {number|null} The probability 0-100, or null when unavailable.
 * @example
 * findProbability(probabilities, 1754300000);
 */
function findProbability(probabilities, timestamp) {
  if (!Array.isArray(probabilities) || !isNumber(timestamp)) {
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
  const probability = readSliceProbability(best);
  if (probability === null) {
    return null;
  }
  // Each slice covers its own width: past that, the value no longer applies.
  if (timestamp >= best.dt + probability.hours * 3600) {
    return null;
  }
  return probability.value;
}

/**
 * @description Build the calendar-day key of a timestamp in a given timezone.
 *
 * Days must be grouped in LOCAL time, but `daily_forecast[].dt` is stamped at
 * 00:00 UTC as a pure day marker: in Paris (UTC+2) that lands on the right
 * local day, while in Guadeloupe (UTC-4) it lands on the previous one. So the
 * daily entry is keyed on its UTC date and the hourly entries on their local
 * date — which is what makes the two meet on the same day.
 * @param {number} timestamp - The timestamp in seconds.
 * @param {string|null} timezone - An IANA timezone, or null for UTC.
 * @returns {string|null} The 'YYYY-MM-DD' key, or null when unusable.
 * @example
 * dayKey(1754300000, 'Europe/Paris'); // -> '2025-08-04'
 */
function dayKey(timestamp, timezone) {
  if (!isNumber(timestamp)) {
    return null;
  }
  const date = new Date(timestamp * 1000);
  if (!timezone) {
    return date.toISOString().slice(0, 10);
  }
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // An unknown timezone must not sink the whole forecast.
    return date.toISOString().slice(0, 10);
  }
}

/**
 * @description Group the hourly entries by local calendar day.
 * @param {Array<object>} hourly - The raw `forecast` array.
 * @param {string|null} timezone - The IANA timezone of the location.
 * @returns {Map<string, Array<object>>} The entries indexed by day key.
 * @example
 * groupHourlyByDay(forecast.forecast, 'Europe/Paris');
 */
function groupHourlyByDay(hourly, timezone) {
  const days = new Map();
  hourly.forEach((entry) => {
    const key = dayKey(entry && entry.dt, timezone);
    if (key === null) {
      return;
    }
    const bucket = days.get(key);
    if (bucket === undefined) {
      days.set(key, [entry]);
    } else {
      bucket.push(entry);
    }
  });
  return days;
}

/**
 * @description Highest finite value a reader extracts from a list of entries.
 * @param {Array<object>} entries - The entries to scan.
 * @param {Function} read - Reader returning a number or null per entry.
 * @returns {number|null} The maximum, or null when no entry carries a value.
 * @example
 * maxOf(entries, (entry) => entry.wind && entry.wind.speed);
 */
function maxOf(entries, read) {
  const values = entries.map(read).filter(isNumber);
  return values.length === 0 ? null : Math.max(...values);
}

/**
 * @description Set a field on every day, but only when EVERY day has a value.
 *
 * The dashboard widget hides a whole forecast row as soon as one column misses
 * the field, so a partially filled field is worse than no field at all.
 * @param {Array<object>} days - The pivot days to complete.
 * @param {Array<number|null>} values - One value per day, aligned by index.
 * @param {string} field - The pivot field name.
 * @returns {void}
 * @example
 * assignWhenComplete(days, [4.2, 3.1], 'wind_speed');
 */
function assignWhenComplete(days, values, field) {
  if (days.length === 0 || values.length !== days.length || !values.every(isNumber)) {
    return;
  }
  days.forEach((day, index) => {
    day[field] = values[index];
  });
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
        // MF publishes the cloud cover as `clouds`, already a 0-100 percentage
        // like the pivot wants. It carries what the condition enum cannot say:
        // "Ciel voilé" and "Eclaircies" both map to `partly-cloudy` but sit at
        // 30% and 40-75% of cover. Out-of-range values are dropped rather than
        // clamped — a percentage outside 0-100 is a payload we do not
        // understand, not a value to guess at.
        if (isNumber(entry.clouds) && entry.clouds >= 0 && entry.clouds <= 100) {
          hour.cloud_cover = entry.clouds;
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
        hour.datetimeSeconds = entry.dt;
        return hour;
      })
      .filter((hour) => hour !== null)
  );
}

/**
 * @description Fill `precipitation_probability` on the pivot hours.
 *
 * MF stops publishing the probability of the slice already under way (its
 * `rain`/`snow` steps come back null), which would leave the running hour — and
 * only it — without a value. Since the widget hides the whole row as soon as
 * one hour misses the field, that first hole is backfilled from the earliest
 * known slice. If any hour is still uncovered afterwards, the field is dropped
 * everywhere rather than sent half-filled.
 * @param {Array<object>} hours - The pivot hours, carrying `datetimeSeconds`.
 * @param {Array<object>} probabilities - The raw `probability_forecast` array.
 * @returns {void}
 * @example
 * assignHourlyProbabilities(hours, forecast.probability_forecast);
 */
function assignHourlyProbabilities(hours, probabilities) {
  if (hours.length === 0) {
    return;
  }
  const values = hours.map((hour) => findProbability(probabilities, hour.datetimeSeconds));

  // Backfill the leading hole with the first known value: the running hour
  // belongs to a slice MF no longer rates, not to a slice without rain.
  const firstKnown = values.findIndex(isNumber);
  if (firstKnown > 0) {
    values.fill(values[firstKnown], 0, firstKnown);
  }
  if (!values.every(isNumber)) {
    return;
  }
  hours.forEach((hour, index) => {
    hour.precipitation_probability = values[index];
  });
}

/**
 * @description Build the pivot `days` array from the raw daily entries.
 * @param {Array<object>} daily - The raw `daily_forecast` array.
 * @param {Array<object>} hourly - The raw `forecast` array (weather12H fallback).
 * @param {Array<object>} probabilities - The raw `probability_forecast` array.
 * @param {string} units - The requested unit system.
 * @param {string|null} timezone - The IANA timezone of the location.
 * @returns {Array<object>} The pivot days (≤ 8 entries).
 * @example
 * buildDays(forecast.daily_forecast, forecast.forecast, probabilities, 'metric', 'Europe/Paris');
 */
function buildDays(daily, hourly, probabilities, units, timezone) {
  const kept = [];
  const days = daily
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
      kept.push(entry);
      return day;
    })
    .filter((day) => day !== null);

  // Wind and probability have no daily equivalent in the MF payload: they are
  // aggregated from the hourly entries of the matching day. This MUST happen
  // here — the core truncates `hours` to a single day, so the widget could
  // never compute it for the later days.
  const hourlyByDay = groupHourlyByDay(hourly, timezone);
  const probabilitiesByDay = groupHourlyByDay(probabilities, timezone);
  const entriesOf = (index, source) => source.get(dayKey(kept[index].dt, null)) || [];

  const gusts = days.map((_day, index) =>
    maxOf(entriesOf(index, hourlyByDay), (entry) => entry.wind && entry.wind.gust),
  );
  const speeds = days.map((_day, index) =>
    maxOf(entriesOf(index, hourlyByDay), (entry) => entry.wind && entry.wind.speed),
  );
  // The day's wind is its peak SUSTAINED speed, never its peak gust: MF's own
  // forecast prints the mean wind, and reporting the gust here made the widget
  // show 14 km/h where meteofrance.com showed 10. The gust has its own field
  // just below, so nothing is lost by keeping the two apart.
  const toSpeed = (value) => (isNumber(value) ? convertWindSpeed(value, units) : null);
  assignWhenComplete(days, speeds.map(toSpeed), 'wind_speed');
  // A 0 gust is MF saying "no gust" — a real measurement, not a hole — so it is
  // reported as a 0 rather than dropped. Nulling it would starve the
  // all-or-nothing rule below and hide the gusts of EVERY day as soon as a
  // single one is calm, which is what emptied the row on an ordinary week.
  // A day with no wind entry at all stays null: that one is a genuine hole.
  assignWhenComplete(days, gusts.map(toSpeed), 'wind_gust');

  const dailyProbabilities = days.map((_day, index) =>
    maxOf(entriesOf(index, probabilitiesByDay), (slice) => {
      const probability = readSliceProbability(slice);
      return probability === null ? null : probability.value;
    }),
  );
  assignWhenComplete(days, dailyProbabilities, 'precipitation_probability');

  return days;
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

  const position = (data && data.position) || {};
  const timezone = typeof position.timezone === 'string' ? position.timezone : null;

  const hours = buildHours(hourly, probabilities, units, nowSeconds);
  assignHourlyProbabilities(hours, probabilities);
  // Internal bookkeeping of the probability pass: never part of the pivot.
  hours.forEach((hour) => delete hour.datetimeSeconds);
  const days = buildDays(daily, hourly, probabilities, units, timezone);

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
    'cloud_cover',
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
