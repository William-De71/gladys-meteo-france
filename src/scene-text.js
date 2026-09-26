// -----------------------------------------------------------------------------
// Texts and formats of the scene triggers and actions.
//
// A scene author reads our outputs in a message ("{{…summary}}"), so every
// output that is meant for a human comes in the language of the instance
// (French or English, the two the manifest speaks), with the unit system the
// core asked for in its last weather request. The machine-facing outputs
// (`condition`, `intensity`, `level`) stay stable English keys.
// -----------------------------------------------------------------------------

// Pivot condition -> human label.
const CONDITION_LABELS = {
  fr: {
    clear: 'Ensoleillé',
    'partly-cloudy': 'Éclaircies',
    cloud: 'Nuageux',
    fog: 'Brouillard',
    'freezing-fog': 'Brouillard givrant',
    drizzle: 'Bruine',
    rain: 'Pluie',
    pouring: 'Pluie forte',
    sleet: 'Pluie et neige',
    snow: 'Neige',
    'freezing-rain': 'Pluie verglaçante',
    hail: 'Grêle',
    thunderstorm: 'Orages',
    'snow-thunderstorm': 'Orages de neige',
    wind: 'Vent',
    sandstorm: 'Tempête de sable',
    tornado: 'Tornade',
    hurricane: 'Cyclone',
    night: 'Nuit',
    unknown: 'Inconnu',
  },
  en: {
    clear: 'Sunny',
    'partly-cloudy': 'Partly cloudy',
    cloud: 'Cloudy',
    fog: 'Fog',
    'freezing-fog': 'Freezing fog',
    drizzle: 'Drizzle',
    rain: 'Rain',
    pouring: 'Heavy rain',
    sleet: 'Sleet',
    snow: 'Snow',
    'freezing-rain': 'Freezing rain',
    hail: 'Hail',
    thunderstorm: 'Thunderstorms',
    'snow-thunderstorm': 'Thundersnow',
    wind: 'Wind',
    sandstorm: 'Sandstorm',
    tornado: 'Tornado',
    hurricane: 'Hurricane',
    night: 'Night',
    unknown: 'Unknown',
  },
};

// Rain intensity key (see rain.js) -> human label.
const INTENSITY_LABELS = {
  fr: { none: 'Temps sec', light: 'Pluie faible', moderate: 'Pluie modérée', heavy: 'Pluie forte' },
  en: { none: 'Dry', light: 'Light rain', moderate: 'Moderate rain', heavy: 'Heavy rain' },
};

// Vigilance level key -> human label.
const VIGILANCE_LABELS = {
  fr: { green: 'verte', yellow: 'jaune', orange: 'orange', red: 'rouge' },
  en: { green: 'green', yellow: 'yellow', orange: 'orange', red: 'red' },
};

// Frost risk level (see frost.js) -> human label.
const FROST_LABELS = {
  fr: { 0: 'Pas de givre', 1: 'Risque de givre', 2: 'Givre probable' },
  en: { 0: 'No frost', 1: 'Frost risk', 2: 'Frost likely' },
};

// Black ice risk level (see ice.js) -> human label.
const ICE_LABELS = {
  fr: { 0: 'Pas de verglas', 1: 'Risque de verglas', 2: 'Verglas probable' },
  en: { 0: 'No black ice', 1: 'Black ice risk', 2: 'Black ice likely' },
};

// UV index bands of the WHO scale, lowest first: [minimum index, fr, en].
const UV_BANDS = [
  [0, 'faible', 'low'],
  [3, 'modéré', 'moderate'],
  [6, 'élevé', 'high'],
  [8, 'très élevé', 'very high'],
  [11, 'extrême', 'extreme'],
];

// The eight compass points, clockwise from north.
const COMPASS_POINTS = {
  fr: ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'],
  en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
};

// Units of the numbers we hand to a scene, per unit system.
const UNIT_SYMBOLS = {
  metric: { temperature: '°C', wind: 'km/h', precipitation: 'mm' },
  us: { temperature: '°F', wind: 'mph', precipitation: 'in' },
};

/**
 * @description Reduce a language to the two the texts are written in.
 * @param {string} [language] - The language of the instance (e.g. 'fr-FR').
 * @returns {'fr'|'en'} The text language.
 * @example
 * textLanguage('fr-FR'); // -> 'fr'
 */
function textLanguage(language) {
  return typeof language === 'string' && language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/**
 * @description The unit symbols of a unit system.
 * @param {string} [units] - 'metric' or 'us'.
 * @returns {{temperature: string, wind: string, precipitation: string}} The symbols.
 * @example
 * unitSymbols('us').temperature; // -> '°F'
 */
function unitSymbols(units) {
  return units === 'us' ? UNIT_SYMBOLS.us : UNIT_SYMBOLS.metric;
}

/**
 * @description Format a number the way the language writes it (decimal comma
 * in French).
 * @param {number} value - The number.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} The formatted number.
 * @example
 * formatNumber(4.2, 'fr'); // -> '4,2'
 */
function formatNumber(value, language) {
  return value.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-GB', {
    maximumFractionDigits: 2,
  });
}

/**
 * @description Label of a UV index on the WHO scale.
 * @param {number} index - The UV index.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} The label, e.g. 'très élevé'.
 * @example
 * uvLabel(8, 'fr'); // -> 'très élevé'
 */
function uvLabel(index, language) {
  const band = [...UV_BANDS].reverse().find(([minimum]) => index >= minimum) || UV_BANDS[0];
  return language === 'fr' ? band[1] : band[2];
}

/**
 * @description Compass point a wind blows from.
 * @param {number} degrees - The direction, in degrees (0 = north).
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} The compass point, e.g. 'sud-ouest'.
 * @example
 * compassPoint(225, 'fr'); // -> 'sud-ouest'
 */
function compassPoint(degrees, language) {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[language === 'fr' ? 'fr' : 'en'][index];
}

/**
 * @description Format a moment as a local "HH:MM".
 * @param {number|string|Date} moment - Seconds since the epoch, an ISO date or a Date.
 * @param {string|null} timezone - The IANA timezone of the place, or null for UTC.
 * @returns {string} The local time, e.g. '06:00'.
 * @example
 * formatLocalTime(1790370900, 'Europe/Paris'); // -> '23:15'
 */
function formatLocalTime(moment, timezone) {
  const date = typeof moment === 'number' ? new Date(moment * 1000) : new Date(moment);
  const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: timezone || 'UTC' }).format(
      date,
    );
  } catch {
    // An unknown timezone must not sink the output.
    return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' }).format(date);
  }
}

/**
 * @description Name of a weekday in the language.
 * @param {string} dateKey - The 'YYYY-MM-DD' date.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} e.g. 'samedi 27' / 'Saturday 27'.
 * @example
 * formatDayName('2026-09-26', 'fr'); // -> 'samedi 26'
 */
function formatDayName(dateKey, language) {
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

/**
 * @description Upper-case the first letter of a text.
 * @param {string} text - The text.
 * @returns {string} The capitalised text.
 * @example
 * capitalize('samedi 26'); // -> 'Samedi 26'
 */
function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

export {
  CONDITION_LABELS,
  INTENSITY_LABELS,
  VIGILANCE_LABELS,
  FROST_LABELS,
  ICE_LABELS,
  textLanguage,
  unitSymbols,
  formatNumber,
  formatLocalTime,
  uvLabel,
  compassPoint,
  formatDayName,
  capitalize,
};
