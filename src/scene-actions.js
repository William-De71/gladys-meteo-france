// -----------------------------------------------------------------------------
// Outputs of the scene actions (manifest `scene_actions`).
//
// Five read-only actions, so a scene can act on the weather without a
// dedicated core feature: the forecast of a day, the rain over the next hours,
// the rain within the hour, the vigilance, and the frost risk of the coming
// morning. Each returns scalars only — the
// SDK contract — and always a `summary` sentence ready to put in a message.
//
// An unknown figure is left out, never sent as 0: a 0 mm or a 0 % would read
// as "dry" in the conditions that follow. The actions never fire a scene
// trigger, so a scene cannot loop through the integration.
//
// Every builder is pure: the caller fetches, the builder shapes.
// -----------------------------------------------------------------------------

import { dayKey, convertWindSpeed } from './forecast.js';
import { evaluateFrostRisk } from './frost.js';
import { PHENOMENON_NAMES, departmentName, parseSummary, parseBulletin } from './vigilance.js';
import {
  CONDITION_LABELS,
  INTENSITY_LABELS,
  VIGILANCE_LABELS,
  FROST_LABELS,
  textLanguage,
  unitSymbols,
  formatNumber,
  formatLocalTime,
  formatDayName,
  capitalize,
} from './scene-text.js';

// Keys of the manifest `scene_actions`. A published key is never renamed.
const SCENE_ACTIONS = {
  GET_FORECAST: 'get_forecast',
  GET_RAIN_NEXT_HOURS: 'get_rain_next_hours',
  GET_RAIN_NEXT_HOUR: 'get_rain_next_hour',
  GET_VIGILANCE: 'get_vigilance',
  GET_FROST_RISK: 'get_frost_risk',
};

// Bounds of the `hours` field of get_rain_next_hours, mirrored from the
// manifest: the pivot carries 24 hours.
const MIN_RAIN_HOURS = 1;
const MAX_RAIN_HOURS = 24;
const DEFAULT_RAIN_HOURS = 12;

// Last day the `day` field of get_forecast offers (the pivot carries 8 days).
const MAX_DAY_OFFSET = 7;

// Gusts below this are not worth a word in the forecast summary (km/h).
const NOTABLE_GUST_KMH = 40;

// A string output is capped at 10 000 characters by the core.
const MAX_OUTPUT_LENGTH = 10000;

// MF vigilance color -> stable level key.
const VIGILANCE_LEVELS = { 1: 'green', 2: 'yellow', 3: 'orange', 4: 'red' };

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
 * @description Shift a 'YYYY-MM-DD' date by a number of days.
 * @param {string} dateKey - The date.
 * @param {number} days - The number of days to add.
 * @returns {string} The shifted date.
 * @example
 * addDays('2026-09-30', 1); // -> '2026-10-01'
 */
function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * @description Read the day offset of the `day` field (a select, so a string),
 * falling back to today on anything unusable.
 * @param {any} value - The resolved field value.
 * @returns {number} The offset, 0 to MAX_DAY_OFFSET.
 * @example
 * readDayOffset('1'); // -> 1
 */
function readDayOffset(value) {
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 && offset <= MAX_DAY_OFFSET ? offset : 0;
}

/**
 * @description Read the `hours` field of get_rain_next_hours, clamped.
 * @param {any} value - The resolved field value.
 * @returns {number} The number of hours, MIN_RAIN_HOURS to MAX_RAIN_HOURS.
 * @example
 * readRainHours(48); // -> 24
 */
function readRainHours(value) {
  const hours = Math.round(Number(value));
  if (!Number.isFinite(hours)) {
    return DEFAULT_RAIN_HOURS;
  }
  return Math.min(MAX_RAIN_HOURS, Math.max(MIN_RAIN_HOURS, hours));
}

/**
 * @description Name the day of a forecast in a sentence.
 * @param {number} offset - Days from today.
 * @param {string} dateKey - The 'YYYY-MM-DD' date.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} "Aujourd'hui", "Demain", "Samedi 27"...
 * @example
 * dayLabel(1, '2026-09-26', 'fr'); // -> 'Demain'
 */
function dayLabel(offset, dateKey, language) {
  if (offset === 0) {
    return language === 'fr' ? "Aujourd'hui" : 'Today';
  }
  if (offset === 1) {
    return language === 'fr' ? 'Demain' : 'Tomorrow';
  }
  return capitalize(formatDayName(dateKey, language));
}

/**
 * @description Outputs of get_forecast: one day of the pivot forecast.
 * @param {object} params - Parameters.
 * @param {object} params.weather - The pivot weather (already in `units`).
 * @param {string|null} params.timezone - The IANA timezone of the place.
 * @param {string} params.units - 'metric' or 'us'.
 * @param {string} params.language - The language of the instance.
 * @param {any} params.day - The `day` field (offset from today).
 * @param {number} [params.nowSeconds] - Current time in seconds (for tests).
 * @returns {object} The outputs.
 * @throws {Error} When the forecast does not reach that day.
 * @example
 * buildForecastOutputs({ weather, timezone: 'Europe/Paris', units: 'metric', language: 'fr', day: '1' });
 */
function buildForecastOutputs({
  weather,
  timezone,
  units,
  language,
  day,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const offset = readDayOffset(day);
  const date = addDays(dayKey(nowSeconds, timezone), offset);
  // A pivot day is stamped at 00:00 UTC of the local day it describes (see
  // dayKey in forecast.js), so its UTC date IS its local date.
  const entry = (weather.days || []).find(
    (candidate) => typeof candidate.datetime === 'string' && candidate.datetime.startsWith(date),
  );
  if (entry === undefined) {
    throw new Error(`Météo France has no forecast for ${date}`);
  }

  const outputs = {
    date,
    temperature_min: entry.temperature_min,
    temperature_max: entry.temperature_max,
  };
  if (entry.weather) {
    outputs.condition = entry.weather;
    outputs.condition_label = CONDITION_LABELS[lang][entry.weather] || entry.weather;
  }
  const optional = [
    'precipitation',
    'precipitation_probability',
    'wind_speed',
    'wind_gust',
    'uv_index',
    'humidity',
  ];
  optional.forEach((field) => {
    if (isNumber(entry[field])) {
      outputs[field] = entry[field];
    }
  });
  if (entry.sunrise) {
    outputs.sunrise = formatLocalTime(entry.sunrise, timezone);
  }
  if (entry.sunset) {
    outputs.sunset = formatLocalTime(entry.sunset, timezone);
  }

  // "Demain : pluie, 8 à 14 °C, 3 mm de pluie (70 %), rafales à 45 km/h."
  const parts = [];
  if (outputs.condition_label) {
    parts.push(outputs.condition_label.toLowerCase());
  }
  parts.push(
    lang === 'fr'
      ? `${entry.temperature_min} à ${entry.temperature_max} ${symbols.temperature}`
      : `${entry.temperature_min} to ${entry.temperature_max} ${symbols.temperature}`,
  );
  if (isNumber(outputs.precipitation) && outputs.precipitation > 0) {
    const amount = `${formatNumber(outputs.precipitation, lang)} ${symbols.precipitation}`;
    let rain = lang === 'fr' ? `${amount} de pluie` : `${amount} of rain`;
    if (isNumber(outputs.precipitation_probability)) {
      rain +=
        lang === 'fr'
          ? ` (${outputs.precipitation_probability} %)`
          : ` (${outputs.precipitation_probability}%)`;
    }
    parts.push(rain);
  }
  if (isNumber(outputs.wind_gust)) {
    const gustKmh = units === 'us' ? outputs.wind_gust / 0.621371 : outputs.wind_gust;
    if (gustKmh >= NOTABLE_GUST_KMH) {
      const gust = `${formatNumber(outputs.wind_gust, lang)} ${symbols.wind}`;
      parts.push(lang === 'fr' ? `rafales à ${gust}` : `gusts up to ${gust}`);
    }
  }
  // French typography puts a space before the colon, English does not.
  const colon = lang === 'fr' ? ' :' : ':';
  outputs.summary = `${dayLabel(offset, date, lang)}${colon} ${parts.join(', ')}.`;
  return outputs;
}

/**
 * @description Outputs of get_rain_next_hours: the rain over the next hours of
 * the pivot forecast (the first pivot hour is the one under way).
 * @param {object} params - Parameters.
 * @param {object} params.weather - The pivot weather (already in `units`).
 * @param {string|null} params.timezone - The IANA timezone of the place.
 * @param {string} params.units - 'metric' or 'us'.
 * @param {string} params.language - The language of the instance.
 * @param {any} params.hours - The `hours` field.
 * @returns {object} The outputs.
 * @example
 * buildRainHoursOutputs({ weather, timezone: 'Europe/Paris', units: 'metric', language: 'fr', hours: 12 });
 */
function buildRainHoursOutputs({ weather, timezone, units, language, hours }) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const count = readRainHours(hours);
  const window = (weather.hours || []).slice(0, count);

  const amounts = window.map((hour) => (isNumber(hour.precipitation) ? hour.precipitation : 0));
  const firstRainIndex = amounts.findIndex((amount) => amount > 0);
  // Round the sum the way the pivot rounds each hour (mm to 0.1, inches to 0.01).
  const precision = units === 'us' ? 100 : 10;
  const total =
    Math.round(amounts.reduce((sum, amount) => sum + amount, 0) * precision) / precision;

  const outputs = {
    hours: window.length,
    dry: firstRainIndex === -1,
    precipitation: total,
    rainy_hours: amounts.filter((amount) => amount > 0).length,
  };
  const probabilities = window.map((hour) => hour.precipitation_probability).filter(isNumber);
  if (probabilities.length > 0) {
    outputs.max_probability = Math.max(...probabilities);
  }

  const span =
    lang === 'fr'
      ? `dans les ${window.length} prochaines heures`
      : `in the next ${window.length} hours`;
  if (firstRainIndex === -1) {
    outputs.summary = lang === 'fr' ? `Pas de pluie prévue ${span}.` : `No rain expected ${span}.`;
    return outputs;
  }

  outputs.hours_until_rain = firstRainIndex;
  outputs.first_rain_time = formatLocalTime(window[firstRainIndex].datetime, timezone);
  const amount = `${formatNumber(total, lang)} ${symbols.precipitation}`;
  outputs.summary =
    lang === 'fr'
      ? `Pluie prévue à partir de ${outputs.first_rain_time} ${span} : ${amount} sur ${outputs.rainy_hours} h.`
      : `Rain expected from ${outputs.first_rain_time} ${span}: ${amount} over ${outputs.rainy_hours} h.`;
  return outputs;
}

/**
 * @description The sentence describing a nowcast (shared with the triggers).
 * @param {object} nowcast - The readNowcast() summary.
 * @param {string} language - The language of the instance.
 * @returns {string} The sentence.
 * @example
 * describeNowcast(nowcast, 'fr'); // -> 'Pluie faible prévue dans 15 min.'
 */
function describeNowcast(nowcast, language) {
  const lang = textLanguage(language);
  const label = INTENSITY_LABELS[lang][nowcast.intensity];
  if (!nowcast.available) {
    return lang === 'fr'
      ? "Prévision de pluie dans l'heure indisponible pour ce lieu."
      : 'Rain within the hour is not available for this place.';
  }
  if (nowcast.raining) {
    if (nowcast.minutesUntilDry !== null) {
      return lang === 'fr'
        ? `${label} en cours, fin prévue dans ${nowcast.minutesUntilDry} min.`
        : `${label} now, ending in ${nowcast.minutesUntilDry} min.`;
    }
    return lang === 'fr'
      ? `${label} en cours pour l'heure à venir.`
      : `${label} now, for the whole coming hour.`;
  }
  if (nowcast.rainExpected) {
    return lang === 'fr'
      ? `${label} prévue dans ${nowcast.minutesUntilRain} min.`
      : `${label} expected in ${nowcast.minutesUntilRain} min.`;
  }
  return lang === 'fr' ? "Pas de pluie prévue dans l'heure." : 'No rain expected within the hour.';
}

/**
 * @description Outputs of get_rain_next_hour: the radar nowcast.
 * @param {object} nowcast - The readNowcast() summary.
 * @param {string} language - The language of the instance.
 * @returns {object} The outputs.
 * @example
 * buildRainNowcastOutputs(readNowcast(rawRain), 'fr');
 */
function buildRainNowcastOutputs(nowcast, language) {
  const lang = textLanguage(language);
  const outputs = {
    available: nowcast.available,
    raining: nowcast.raining,
    rain_expected: nowcast.rainExpected,
    intensity: nowcast.intensity,
    intensity_label: INTENSITY_LABELS[lang][nowcast.intensity],
    summary: describeNowcast(nowcast, lang),
  };
  if (nowcast.minutesUntilRain !== null) {
    outputs.minutes_until_rain = nowcast.minutesUntilRain;
  }
  if (nowcast.minutesUntilDry !== null) {
    outputs.minutes_until_dry = nowcast.minutesUntilDry;
  }
  return outputs;
}

/**
 * @description Outputs of get_vigilance: the vigilance of the department of
 * the house.
 * @param {object} warningData - The raw warning payload.
 * @param {string} department - The department number.
 * @param {string} language - The language of the instance.
 * @returns {object} The outputs.
 * @example
 * buildVigilanceOutputs(warningData, '33', 'fr');
 */
function buildVigilanceOutputs(warningData, department, language) {
  const lang = textLanguage(language);
  const items = Array.isArray(warningData && warningData.phenomenons_items)
    ? warningData.phenomenons_items
    : [];
  const active = items
    .filter((item) => VIGILANCE_LEVELS[item.phenomenon_max_color_id] !== undefined)
    .filter((item) => item.phenomenon_max_color_id > 1)
    .sort((a, b) => b.phenomenon_max_color_id - a.phenomenon_max_color_id);
  const colors = active.map((item) => item.phenomenon_max_color_id);
  const colorMax = warningData && warningData.color_max;
  const color = Math.max(1, isNumber(colorMax) ? colorMax : 1, ...colors);
  const level = VIGILANCE_LEVELS[color] || 'green';
  const area = departmentName(department);

  const phenomena = active
    .map((item) => {
      const name = PHENOMENON_NAMES[Number(item.phenomenon_id)] || `${item.phenomenon_id}`;
      const itemLevel = VIGILANCE_LEVELS[item.phenomenon_max_color_id];
      return `${name} (${VIGILANCE_LABELS[lang][itemLevel]})`;
    })
    .join(', ');

  const outputs = {
    color,
    level,
    level_label: VIGILANCE_LABELS[lang][level],
    has_alert: color > 1,
    department,
    department_name: area,
  };
  if (phenomena) {
    outputs.phenomena = phenomena;
  }
  if (color > 1) {
    outputs.summary =
      lang === 'fr'
        ? `Vigilance ${outputs.level_label} en ${area} : ${phenomena}.`
        : `${capitalize(outputs.level_label)} warning in ${area}: ${phenomena}.`;
  } else {
    outputs.summary =
      lang === 'fr'
        ? `Pas de vigilance particulière en ${area}.`
        : `No particular warning in ${area}.`;
  }
  const comment = parseSummary(warningData);
  if (comment) {
    outputs.comment = comment.substring(0, MAX_OUTPUT_LENGTH);
  }
  const bulletin = parseBulletin(warningData);
  if (bulletin) {
    outputs.bulletin = bulletin.substring(0, MAX_OUTPUT_LENGTH);
  }
  return outputs;
}

/**
 * @description Convert a temperature from °C to the unit system, keeping one
 * decimal: the frost figures sit too close to the thresholds for whole degrees.
 * @param {number} celsius - The temperature, in °C.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number} The converted temperature.
 * @example
 * convertPrecise(-0.46, 'metric'); // -> -0.5
 */
function convertPrecise(celsius, units) {
  const value = units === 'us' ? celsius * (9 / 5) + 32 : celsius;
  return Math.round(value * 10) / 10 + 0;
}

/**
 * @description Outputs of get_frost_risk: the hoar frost risk of the coming
 * morning, read on its worst hour (see frost.js).
 * @param {object} params - Parameters.
 * @param {object} params.data - The raw forecast payload (MF units).
 * @param {string|null} params.timezone - The IANA timezone of the place.
 * @param {string} params.units - 'metric' or 'us'.
 * @param {string} params.language - The language of the instance.
 * @param {number} [params.nowSeconds] - Current time in seconds (for tests).
 * @returns {object} The outputs.
 * @throws {Error} When the forecast does not reach the morning.
 * @example
 * buildFrostRiskOutputs({ data, timezone: 'Europe/Paris', units: 'metric', language: 'fr' });
 */
function buildFrostRiskOutputs({
  data,
  timezone,
  units,
  language,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const { date, today, worst } = evaluateFrostRisk(data, timezone, nowSeconds);
  const outputs = {
    level: worst.level,
    level_label: FROST_LABELS[lang][worst.level],
    date,
    time: formatLocalTime(worst.dt, timezone),
    temperature: convertPrecise(worst.temperature, units),
    dew_point: convertPrecise(worst.dewPoint, units),
    frost_point: convertPrecise(worst.frostPoint, units),
    humidity: worst.humidity,
    reduced: worst.reduced,
  };
  if (worst.cloudCover !== null) {
    outputs.cloud_cover = worst.cloudCover;
  }
  if (worst.windSpeed !== null) {
    outputs.wind_speed = convertWindSpeed(worst.windSpeed, units);
  }

  const degrees = (value) => `${formatNumber(value, lang)} ${symbols.temperature}`;
  let when;
  if (lang === 'fr') {
    when = today ? 'ce matin' : 'demain matin';
  } else {
    when = today ? 'this morning' : 'tomorrow morning';
  }
  // "Givre probable demain matin : 0,4 °C vers 06:00, point de givre -2,1 °C."
  if (worst.level > 0) {
    outputs.summary =
      lang === 'fr'
        ? `${outputs.level_label} ${when} : ${degrees(outputs.temperature)} vers ${outputs.time}, point de givre ${degrees(outputs.frost_point)}.`
        : `${outputs.level_label} ${when}: ${degrees(outputs.temperature)} around ${outputs.time}, frost point ${degrees(outputs.frost_point)}.`;
  } else {
    outputs.summary =
      lang === 'fr'
        ? `Pas de givre attendu ${when} : minimum ${degrees(outputs.temperature)} vers ${outputs.time}.`
        : `No frost expected ${when}: low of ${degrees(outputs.temperature)} around ${outputs.time}.`;
  }
  if (worst.reduced) {
    const causes = {
      fr: { sky: 'le ciel couvert', wind: 'le vent', both: 'le ciel couvert et le vent' },
      en: { sky: 'the overcast sky', wind: 'the wind', both: 'the overcast sky and the wind' },
    }[lang];
    let cause = causes.wind;
    if (worst.overcast) {
      cause = worst.windy ? causes.both : causes.sky;
    }
    outputs.summary +=
      lang === 'fr' ? ` Risque atténué par ${cause}.` : ` Risk lowered by ${cause}.`;
  }
  return outputs;
}

export {
  SCENE_ACTIONS,
  buildFrostRiskOutputs,
  buildForecastOutputs,
  buildRainHoursOutputs,
  buildRainNowcastOutputs,
  buildVigilanceOutputs,
  describeNowcast,
  readDayOffset,
  readRainHours,
  addDays,
  MAX_DAY_OFFSET,
  MIN_RAIN_HOURS,
  MAX_RAIN_HOURS,
  DEFAULT_RAIN_HOURS,
};
