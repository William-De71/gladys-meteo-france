// -----------------------------------------------------------------------------
// Outputs of the scene actions (manifest `scene_actions`).
//
// Read-only actions, so a scene can act on the weather without a dedicated
// core feature: the forecast of a day or of an hour, the rain over the next
// hours, the rain within the hour, the vigilance, and the frost and black ice
// risks of the coming morning. Each returns scalars only — the
// SDK contract — and always a `summary` sentence ready to put in a message.
//
// An unknown figure is left out, never sent as 0: a 0 mm or a 0 % would read
// as "dry" in the conditions that follow. The actions never fire a scene
// trigger, so a scene cannot loop through the integration.
//
// Every builder is pure: the caller fetches, the builder shapes.
// -----------------------------------------------------------------------------

import {
  dayKey,
  convertTemperature,
  convertPrecipitation,
  convertSceneWindSpeed,
  pivotToSceneWindSpeed,
  toKilometersPerHour,
  findProbability,
} from './forecast.js';
import { parseWeather } from './conditions.js';
import { evaluateFrostRisk, readMorningWindow } from './frost.js';
import { evaluateIceHours, pickIceHour, readFreezingProbability, readRainAmount } from './ice.js';
import { departmentName, parseSummary, parseBulletin } from './vigilance.js';
import {
  CONDITION_LABELS,
  INTENSITY_LABELS,
  VIGILANCE_LABELS,
  FROST_LABELS,
  ICE_LABELS,
  PHENOMENON_LABELS,
  textLanguage,
  pick,
  inSentence,
  colon,
  percent,
  unitSymbols,
  formatNumber,
  formatLocalTime,
  formatDayName,
  capitalize,
  uvLabel,
  compassPoint,
} from './scene-text.js';

// Keys of the manifest `scene_actions`. A published key is never renamed.
const SCENE_ACTIONS = {
  GET_FORECAST: 'get_forecast',
  GET_RAIN_NEXT_HOURS: 'get_rain_next_hours',
  GET_RAIN_NEXT_HOUR: 'get_rain_next_hour',
  GET_VIGILANCE: 'get_vigilance',
  GET_FROST_RISK: 'get_frost_risk',
  GET_ICE_RISK: 'get_ice_risk',
  GET_HOUR_FORECAST: 'get_hour_forecast',
  // Built in avalanche.js.
  GET_AVALANCHE_RISK: 'get_avalanche_risk',
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

// A UV index from this one is worth a word in the forecast summary ("high").
const NOTABLE_UV_INDEX = 6;

// Last day the `day` field of get_hour_forecast offers: past it, MF only
// publishes 6-hour steps.
const MAX_HOUR_DAY_OFFSET = 2;

// Default of the `hour` field of get_hour_forecast.
const DEFAULT_FORECAST_HOUR = 8;

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
 * @description "3 mm of rain" in the language.
 * @param {number} amount - The amount, in the unit system of the instance.
 * @param {object} symbols - The unitSymbols() of the instance.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The phrase.
 * @example
 * rainAmount(4.2, unitSymbols('metric'), 'fr'); // -> '4,2 mm de pluie'
 */
function rainAmount(amount, symbols, language) {
  const value = `${formatNumber(amount, language)} ${symbols.precipitation}`;
  return pick(language, {
    en: `${value} of rain`,
    fr: `${value} de pluie`,
    de: `${value} Regen`,
    es: `${value} de lluvia`,
  });
}

/**
 * @description "after 2.4 mm of rain" in the language (shared with the black
 * ice trigger).
 * @param {number} amount - The amount, in the unit system of the instance.
 * @param {object} symbols - The unitSymbols() of the instance.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The phrase.
 * @example
 * afterRain(2.4, unitSymbols('metric'), 'de'); // -> 'nach 2,4 mm Regen'
 */
function afterRain(amount, symbols, language) {
  const value = `${formatNumber(amount, language)} ${symbols.precipitation}`;
  return pick(language, {
    en: `after ${value} of rain`,
    fr: `après ${value} de pluie`,
    de: `nach ${value} Regen`,
    es: `tras ${value} de lluvia`,
  });
}

/**
 * @description "gusts up to 55 km/h" in the language.
 * @param {number} speed - The gust, in the unit system of the instance.
 * @param {object} symbols - The unitSymbols() of the instance.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The phrase.
 * @example
 * gusts(55, unitSymbols('metric'), 'es'); // -> 'rachas de hasta 55 km/h'
 */
function gusts(speed, symbols, language) {
  const value = `${formatNumber(speed, language)} ${symbols.wind}`;
  return pick(language, {
    en: `gusts up to ${value}`,
    fr: `rafales à ${value}`,
    de: `Böen bis ${value}`,
    es: `rachas de hasta ${value}`,
  });
}

/**
 * @description Name the day of a forecast in a sentence.
 * @param {number} offset - Days from today.
 * @param {string} dateKey - The 'YYYY-MM-DD' date.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} "Aujourd'hui", "Demain", "Samedi 27"...
 * @example
 * dayLabel(1, '2026-09-26', 'fr'); // -> 'Demain'
 */
function dayLabel(offset, dateKey, language) {
  if (offset === 0) {
    return pick(language, { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' });
  }
  if (offset === 1) {
    return pick(language, { en: 'Tomorrow', fr: 'Demain', de: 'Morgen', es: 'Mañana' });
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
  // The pivot carries the wind in m/s for metric; a scene reads km/h.
  ['wind_speed', 'wind_gust'].forEach((field) => {
    if (isNumber(outputs[field])) {
      outputs[field] = pivotToSceneWindSpeed(outputs[field], units);
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
    parts.push(inSentence(outputs.condition_label, lang));
  }
  const [min, max] = [entry.temperature_min, entry.temperature_max];
  parts.push(
    pick(lang, {
      en: `${min} to ${max} ${symbols.temperature}`,
      fr: `${min} à ${max} ${symbols.temperature}`,
      de: `${min} bis ${max} ${symbols.temperature}`,
      es: `de ${min} a ${max} ${symbols.temperature}`,
    }),
  );
  if (isNumber(outputs.precipitation) && outputs.precipitation > 0) {
    let rain = rainAmount(outputs.precipitation, symbols, lang);
    if (isNumber(outputs.precipitation_probability)) {
      rain += ` (${percent(outputs.precipitation_probability, lang)})`;
    }
    parts.push(rain);
  }
  if (isNumber(outputs.wind_gust)) {
    const gustKmh = units === 'us' ? outputs.wind_gust / 0.621371 : outputs.wind_gust;
    if (gustKmh >= NOTABLE_GUST_KMH) {
      parts.push(gusts(outputs.wind_gust, symbols, lang));
    }
  }
  if (isNumber(outputs.uv_index) && outputs.uv_index >= NOTABLE_UV_INDEX) {
    parts.push(`UV ${outputs.uv_index} (${uvLabel(outputs.uv_index, lang)})`);
  }
  outputs.summary = `${dayLabel(offset, date, lang)}${colon(lang)} ${parts.join(', ')}.`;
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

  const span = pick(lang, {
    en: `in the next ${window.length} hours`,
    fr: `dans les ${window.length} prochaines heures`,
    de: `in den nächsten ${window.length} Stunden`,
    es: `en las próximas ${window.length} horas`,
  });
  if (firstRainIndex === -1) {
    outputs.summary = pick(lang, {
      en: `No rain expected ${span}.`,
      fr: `Pas de pluie prévue ${span}.`,
      de: `Kein Regen ${span} erwartet.`,
      es: `No se prevé lluvia ${span}.`,
    });
    return outputs;
  }

  outputs.hours_until_rain = firstRainIndex;
  outputs.first_rain_time = formatLocalTime(window[firstRainIndex].datetime, timezone);
  const amount = `${formatNumber(total, lang)} ${symbols.precipitation}`;
  const [from, rainy] = [outputs.first_rain_time, outputs.rainy_hours];
  outputs.summary = pick(lang, {
    en: `Rain expected from ${from} ${span}: ${amount} over ${rainy} h.`,
    fr: `Pluie prévue à partir de ${from} ${span} : ${amount} sur ${rainy} h.`,
    de: `Regen ab ${from} ${span} erwartet: ${amount} in ${rainy} Std.`,
    es: `Lluvia prevista a partir de las ${from} ${span}: ${amount} en ${rainy} h.`,
  });
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
    return pick(lang, {
      en: 'Rain within the hour is not available for this place.',
      fr: "Prévision de pluie dans l'heure indisponible pour ce lieu.",
      de: 'Regen in der nächsten Stunde ist für diesen Ort nicht verfügbar.',
      es: 'La previsión de lluvia en la próxima hora no está disponible para este lugar.',
    });
  }
  if (nowcast.raining) {
    const dry = nowcast.minutesUntilDry;
    if (dry !== null) {
      return pick(lang, {
        en: `${label} now, ending in ${dry} min.`,
        fr: `${label} en cours, fin prévue dans ${dry} min.`,
        de: `${label} jetzt, Ende in ${dry} Min.`,
        es: `${label} en curso, termina en ${dry} min.`,
      });
    }
    return pick(lang, {
      en: `${label} now, for the whole coming hour.`,
      fr: `${label} en cours pour l'heure à venir.`,
      de: `${label} jetzt, die ganze kommende Stunde.`,
      es: `${label} en curso durante toda la próxima hora.`,
    });
  }
  if (nowcast.rainExpected) {
    const soon = nowcast.minutesUntilRain;
    return pick(lang, {
      en: `${label} expected in ${soon} min.`,
      fr: `${label} prévue dans ${soon} min.`,
      de: `${label} in ${soon} Min. erwartet.`,
      es: `${label} prevista en ${soon} min.`,
    });
  }
  return pick(lang, {
    en: 'No rain expected within the hour.',
    fr: "Pas de pluie prévue dans l'heure.",
    de: 'Kein Regen in der nächsten Stunde erwartet.',
    es: 'No se prevé lluvia en la próxima hora.',
  });
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
      const names = PHENOMENON_LABELS[lang];
      const name = names[Number(item.phenomenon_id)] || `${item.phenomenon_id}`;
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
  const label = outputs.level_label;
  if (color > 1) {
    outputs.summary = pick(lang, {
      en: `${capitalize(label)} warning in ${area}: ${phenomena}.`,
      fr: `Vigilance ${label} en ${area} : ${phenomena}.`,
      de: `Warnstufe ${label} in ${area}: ${phenomena}.`,
      es: `Aviso ${label} en ${area}: ${phenomena}.`,
    });
  } else {
    outputs.summary = pick(lang, {
      en: `No particular warning in ${area}.`,
      fr: `Pas de vigilance particulière en ${area}.`,
      de: `Keine besondere Warnung in ${area}.`,
      es: `Sin aviso especial en ${area}.`,
    });
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
    outputs.wind_speed = convertSceneWindSpeed(worst.windSpeed, units);
  }

  const degrees = (value) => `${formatNumber(value, lang)} ${symbols.temperature}`;
  const when = morningPhrase(today, lang);
  // "Givre probable demain matin : 0,4 °C vers 06:00, point de givre -2,1 °C."
  const [label, low, time] = [outputs.level_label, degrees(outputs.temperature), outputs.time];
  if (worst.level > 0) {
    const point = degrees(outputs.frost_point);
    outputs.summary = pick(lang, {
      en: `${label} ${when}: ${low} around ${time}, frost point ${point}.`,
      fr: `${label} ${when} : ${low} vers ${time}, point de givre ${point}.`,
      de: `${label} ${when}: ${low} gegen ${time}, Frostpunkt ${point}.`,
      es: `${label} ${when}: ${low} hacia las ${time}, punto de escarcha ${point}.`,
    });
  } else {
    outputs.summary = pick(lang, {
      en: `No frost expected ${when}: low of ${low} around ${time}.`,
      fr: `Pas de givre attendu ${when} : minimum ${low} vers ${time}.`,
      de: `Kein Reif ${when} erwartet: Tiefstwert ${low} gegen ${time}.`,
      es: `No se espera escarcha ${when}: mínima de ${low} hacia las ${time}.`,
    });
  }
  if (worst.reduced) {
    const causes = pick(lang, {
      en: { sky: 'the overcast sky', wind: 'the wind', both: 'the overcast sky and the wind' },
      fr: { sky: 'le ciel couvert', wind: 'le vent', both: 'le ciel couvert et le vent' },
      de: {
        sky: 'den bedeckten Himmel',
        wind: 'den Wind',
        both: 'den bedeckten Himmel und den Wind',
      },
      es: { sky: 'el cielo cubierto', wind: 'el viento', both: 'el cielo cubierto y el viento' },
    });
    let cause = causes.wind;
    if (worst.overcast) {
      cause = worst.windy ? causes.both : causes.sky;
    }
    outputs.summary += pick(lang, {
      en: ` Risk lowered by ${cause}.`,
      fr: ` Risque atténué par ${cause}.`,
      de: ` Risiko verringert durch ${cause}.`,
      es: ` Riesgo atenuado por ${cause}.`,
    });
  }
  return outputs;
}

/**
 * @description "ce matin" / "demain matin" for the coming morning.
 * @param {boolean} today - Whether the morning is today's.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} The phrase.
 * @example
 * morningPhrase(false, 'fr'); // -> 'demain matin'
 */
function morningPhrase(today, language) {
  if (today) {
    return pick(language, {
      en: 'this morning',
      fr: 'ce matin',
      de: 'heute Morgen',
      es: 'esta mañana',
    });
  }
  return pick(language, {
    en: 'tomorrow morning',
    fr: 'demain matin',
    de: 'morgen früh',
    es: 'mañana por la mañana',
  });
}

/**
 * @description Outputs of get_ice_risk: the black ice risk of the coming
 * morning (see ice.js and readMorningWindow), read on the hour the ice sets
 * in, or on the coldest hour when there is none.
 * @param {object} params - Parameters.
 * @param {object} params.data - The raw forecast payload (MF units).
 * @param {string|null} params.timezone - The IANA timezone of the place.
 * @param {string} params.units - 'metric' or 'us'.
 * @param {string} params.language - The language of the instance.
 * @param {number} [params.nowSeconds] - Current time in seconds (for tests).
 * @returns {object} The outputs.
 * @throws {Error} When the forecast does not reach the morning.
 * @example
 * buildIceRiskOutputs({ data, timezone: 'Europe/Paris', units: 'metric', language: 'fr' });
 */
function buildIceRiskOutputs({
  data,
  timezone,
  units,
  language,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const { date, today, includes } = readMorningWindow(nowSeconds, timezone);
  const hour = pickIceHour(evaluateIceHours(data && data.forecast, includes));
  if (hour === null) {
    throw new Error(`Météo France has no hourly forecast until the morning of ${date}`);
  }
  const outputs = {
    level: hour.level,
    level_label: ICE_LABELS[lang][hour.level],
    date,
    time: formatLocalTime(hour.dt, timezone),
    temperature: convertPrecise(hour.temperature, units),
    freezing_rain: hour.freezingRain,
    recent_rain: convertPrecipitation(hour.recentRain, units),
  };
  const freezing = readFreezingProbability(data && data.probability_forecast, includes);
  if (freezing !== null) {
    outputs.freezing_probability = freezing;
  }

  const degrees = `${formatNumber(outputs.temperature, lang)} ${symbols.temperature}`;
  const when = morningPhrase(today, lang);
  const time = outputs.time;
  if (hour.level === 0) {
    outputs.summary = pick(lang, {
      en: `No black ice expected ${when}: low of ${degrees} around ${time}.`,
      fr: `Pas de verglas attendu ${when} : minimum ${degrees} vers ${time}.`,
      de: `Keine Glätte ${when} erwartet: Tiefstwert ${degrees} gegen ${time}.`,
      es: `No se espera hielo ${when}: mínima de ${degrees} hacia las ${time}.`,
    });
    return outputs;
  }
  // "Verglas probable demain matin vers 06:00 : -1,5 °C après 2,4 mm de pluie."
  const cause = hour.freezingRain
    ? pick(lang, {
        en: 'freezing rain forecast',
        fr: 'pluie verglaçante annoncée',
        de: 'gefrierender Regen angekündigt',
        es: 'lluvia helada prevista',
      })
    : afterRain(outputs.recent_rain, symbols, lang);
  const label = outputs.level_label;
  outputs.summary = pick(lang, {
    en: `${label} ${when} around ${time}: ${degrees}, ${cause}.`,
    fr: `${label} ${when} vers ${time} : ${degrees}, ${cause}.`,
    de: `${label} ${when} gegen ${time}: ${degrees}, ${cause}.`,
    es: `${label} ${when} hacia las ${time}: ${degrees}, ${cause}.`,
  });
  return outputs;
}

/**
 * @description Read the `hour` field of get_hour_forecast.
 * @param {any} value - The resolved field value.
 * @returns {number} The hour, 0 to 23.
 * @example
 * readForecastHour('7'); // -> 7
 */
function readForecastHour(value) {
  const hour = Math.round(Number(value));
  if (!Number.isFinite(hour) || value === null || value === '') {
    return DEFAULT_FORECAST_HOUR;
  }
  return Math.min(23, Math.max(0, hour));
}

/**
 * @description Outputs of get_hour_forecast: the raw MF entry covering an hour
 * of today, tomorrow or the day after (hourly steps first, then 3-hour ones:
 * the entry is the last one starting at or before the hour asked).
 * @param {object} params - Parameters.
 * @param {object} params.data - The raw forecast payload (MF units).
 * @param {string|null} params.timezone - The IANA timezone of the place.
 * @param {string} params.units - 'metric' or 'us'.
 * @param {string} params.language - The language of the instance.
 * @param {any} params.day - The `day` field (offset from today).
 * @param {any} params.hour - The `hour` field.
 * @param {number} [params.nowSeconds] - Current time in seconds (for tests).
 * @returns {object} The outputs.
 * @throws {Error} When the forecast does not reach that day.
 * @example
 * buildHourForecastOutputs({ data, timezone: 'Europe/Paris', units: 'metric', language: 'fr', day: '1', hour: 8 });
 */
function buildHourForecastOutputs({
  data,
  timezone,
  units,
  language,
  day,
  hour,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const lang = textLanguage(language);
  const symbols = unitSymbols(units);
  const offset = Math.min(readDayOffset(day), MAX_HOUR_DAY_OFFSET);
  const wantedHour = readForecastHour(hour);
  const date = addDays(dayKey(nowSeconds, timezone), offset);
  const localHour = (dt) => Number(formatLocalTime(dt, timezone).slice(0, 2));
  const ofDay = (Array.isArray(data && data.forecast) ? data.forecast : [])
    .filter((entry) => entry && isNumber(entry.dt) && entry.T && isNumber(entry.T.value))
    .filter((entry) => dayKey(entry.dt, timezone) === date)
    .sort((a, b) => a.dt - b.dt);
  if (ofDay.length === 0) {
    throw new Error(`Météo France has no hourly forecast for ${date}`);
  }
  const before = ofDay.filter((entry) => localHour(entry.dt) <= wantedHour);
  const entry = before.length > 0 ? before[before.length - 1] : ofDay[0];

  const outputs = {
    date,
    time: formatLocalTime(entry.dt, timezone),
    temperature: convertTemperature(entry.T.value, units),
  };
  if (isNumber(entry.T.windchill)) {
    outputs.apparent_temperature = convertTemperature(entry.T.windchill, units);
  }
  if (isNumber(entry.humidity)) {
    outputs.humidity = entry.humidity;
  }
  const { condition } = parseWeather(entry.weather);
  if (condition !== 'unknown') {
    outputs.condition = condition;
    outputs.condition_label = CONDITION_LABELS[lang][condition] || condition;
  }
  outputs.precipitation = convertPrecipitation(readRainAmount(entry), units);
  const probability = findProbability(data.probability_forecast, entry.dt);
  if (probability !== null) {
    outputs.precipitation_probability = probability;
  }
  const wind = entry.wind || {};
  if (isNumber(wind.speed)) {
    outputs.wind_speed = convertSceneWindSpeed(toKilometersPerHour(wind.speed), units);
  }
  // A 0 gust is MF saying "no notable gust" — what it answers on a calm day,
  // hour after hour — so it is sent as a 0, as get_forecast does: leaving it
  // out left the variable empty in the scene.
  if (isNumber(wind.gust) && wind.gust >= 0) {
    outputs.wind_gust = convertSceneWindSpeed(toKilometersPerHour(wind.gust), units);
  }
  // MF uses -1 for "variable wind": not a bearing.
  if (isNumber(wind.direction) && wind.direction >= 0) {
    outputs.wind_direction = wind.direction;
    outputs.wind_direction_label = capitalize(compassPoint(wind.direction, lang));
  }
  if (isNumber(entry.clouds)) {
    outputs.cloud_cover = entry.clouds;
  }

  // "Demain à 08:00 : éclaircies, 12 °C (ressenti 10 °C), vent de sud-ouest à
  // 15 km/h, rafales à 40 km/h, pas de pluie."
  const parts = [];
  if (outputs.condition_label) {
    parts.push(inSentence(outputs.condition_label, lang));
  }
  let temperature = `${outputs.temperature} ${symbols.temperature}`;
  if (
    isNumber(outputs.apparent_temperature) &&
    outputs.apparent_temperature !== outputs.temperature
  ) {
    const feels = `${outputs.apparent_temperature} ${symbols.temperature}`;
    temperature += pick(lang, {
      en: ` (feels like ${feels})`,
      fr: ` (ressenti ${feels})`,
      de: ` (gefühlt ${feels})`,
      es: ` (sensación de ${feels})`,
    });
  }
  parts.push(temperature);
  if (isNumber(outputs.wind_speed)) {
    const speed = `${formatNumber(outputs.wind_speed, lang)} ${symbols.wind}`;
    const from = outputs.wind_direction_label && compassPoint(outputs.wind_direction, lang);
    // "vent d'est", "vent d'ouest": French elides "de" before a vowel.
    const of = from && /^[aeiou]/.test(from) ? `d'${from}` : `de ${from}`;
    parts.push(
      from
        ? pick(lang, {
            en: `${from} wind at ${speed}`,
            fr: `vent ${of} à ${speed}`,
            de: `Wind aus ${from} mit ${speed}`,
            es: `viento del ${from} a ${speed}`,
          })
        : pick(lang, {
            en: `wind at ${speed}`,
            fr: `vent à ${speed}`,
            de: `Wind mit ${speed}`,
            es: `viento a ${speed}`,
          }),
    );
  }
  if (isNumber(outputs.wind_gust) && outputs.wind_gust > 0) {
    parts.push(gusts(outputs.wind_gust, symbols, lang));
  }
  if (outputs.precipitation > 0) {
    parts.push(rainAmount(outputs.precipitation, symbols, lang));
  } else {
    parts.push(
      pick(lang, { en: 'no rain', fr: 'pas de pluie', de: 'kein Regen', es: 'sin lluvia' }),
    );
  }
  const at = pick(lang, { en: 'at', fr: 'à', de: 'um', es: 'a las' });
  const dayName = dayLabel(offset, date, lang);
  outputs.summary = `${dayName} ${at} ${outputs.time}${colon(lang)} ${parts.join(', ')}.`;
  return outputs;
}

export {
  afterRain,
  gusts,
  SCENE_ACTIONS,
  buildFrostRiskOutputs,
  buildIceRiskOutputs,
  buildHourForecastOutputs,
  readForecastHour,
  MAX_HOUR_DAY_OFFSET,
  DEFAULT_FORECAST_HOUR,
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
