// -----------------------------------------------------------------------------
// Texts and formats of the scene triggers and actions.
//
// A scene author reads our outputs in a message ("{{…summary}}"), so every
// output that is meant for a human comes in the language of the instance
// (English, French, German or Spanish, the four Gladys speaks), with the unit
// system the core asked for in its last weather request. The machine-facing
// outputs (`condition`, `intensity`, `level`) stay stable English keys.
//
// German and Spanish labels follow the official Gladys wording
// (front/src/config/i18n of the Gladys repository).

// The languages of the texts; any other falls back to English.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Locale of the numbers and dates of each language.
const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
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
  de: {
    clear: 'Klarer Himmel',
    'partly-cloudy': 'Leicht bewölkt',
    cloud: 'Bewölkt',
    fog: 'Nebel',
    'freezing-fog': 'Gefrierender Nebel',
    drizzle: 'Nieselregen',
    rain: 'Regen',
    pouring: 'Starkregen',
    sleet: 'Schneeregen',
    snow: 'Schnee',
    'freezing-rain': 'Gefrierender Regen',
    hail: 'Hagel',
    thunderstorm: 'Gewitter',
    'snow-thunderstorm': 'Gewittrige Schneeschauer',
    wind: 'Windig',
    sandstorm: 'Sandsturm',
    tornado: 'Tornado',
    hurricane: 'Hurrikan',
    night: 'Nacht',
    unknown: 'Unbekannt',
  },
  es: {
    clear: 'Cielo despejado',
    'partly-cloudy': 'Parcialmente nublado',
    cloud: 'Nublado',
    fog: 'Niebla',
    'freezing-fog': 'Niebla helada',
    drizzle: 'Llovizna',
    rain: 'Lluvia',
    pouring: 'Lluvia intensa',
    sleet: 'Aguanieve',
    snow: 'Nieve',
    'freezing-rain': 'Lluvia helada',
    hail: 'Granizo',
    thunderstorm: 'Tormenta',
    'snow-thunderstorm': 'Chubascos de nieve con tormenta',
    wind: 'Ventoso',
    sandstorm: 'Tormenta de arena',
    tornado: 'Tornado',
    hurricane: 'Huracán',
    night: 'Noche',
    unknown: 'Desconocido',
  },
};

// Rain intensity key (see rain.js) -> human label.
const INTENSITY_LABELS = {
  fr: { none: 'Temps sec', light: 'Pluie faible', moderate: 'Pluie modérée', heavy: 'Pluie forte' },
  en: { none: 'Dry', light: 'Light rain', moderate: 'Moderate rain', heavy: 'Heavy rain' },
  de: {
    none: 'Trocken',
    light: 'Leichter Regen',
    moderate: 'Mäßiger Regen',
    heavy: 'Starker Regen',
  },
  es: { none: 'Seco', light: 'Lluvia débil', moderate: 'Lluvia moderada', heavy: 'Lluvia fuerte' },
};

// Vigilance level key -> human label.
const VIGILANCE_LABELS = {
  fr: { green: 'verte', yellow: 'jaune', orange: 'orange', red: 'rouge' },
  en: { green: 'green', yellow: 'yellow', orange: 'orange', red: 'red' },
  de: { green: 'grün', yellow: 'gelb', orange: 'orange', red: 'rot' },
  es: { green: 'verde', yellow: 'amarillo', orange: 'naranja', red: 'rojo' },
};

// Météo France vigilance phenomenon id -> its name. French: the official
// names (see vigilance.js, which keeps them in the alerts of the dashboard).
const PHENOMENON_LABELS = {
  fr: {
    1: 'Vent violent',
    2: 'Pluie-inondation',
    3: 'Orages',
    4: 'Crues',
    5: 'Neige-verglas',
    6: 'Canicule',
    7: 'Grand froid',
    8: 'Avalanches',
    9: 'Vagues-submersion',
  },
  en: {
    1: 'Strong wind',
    2: 'Rain and flooding',
    3: 'Thunderstorms',
    4: 'River floods',
    5: 'Snow and ice',
    6: 'Heatwave',
    7: 'Extreme cold',
    8: 'Avalanches',
    9: 'Waves and coastal flooding',
  },
  de: {
    1: 'Sturm',
    2: 'Starkregen und Überschwemmung',
    3: 'Gewitter',
    4: 'Hochwasser',
    5: 'Schnee und Glätte',
    6: 'Hitzewelle',
    7: 'Strenge Kälte',
    8: 'Lawinen',
    9: 'Wellen und Sturmflut',
  },
  es: {
    1: 'Viento fuerte',
    2: 'Lluvia e inundaciones',
    3: 'Tormentas',
    4: 'Crecidas',
    5: 'Nieve y hielo',
    6: 'Ola de calor',
    7: 'Frío intenso',
    8: 'Aludes',
    9: 'Oleaje e inundación costera',
  },
};

// Frost risk level (see frost.js) -> human label.
const FROST_LABELS = {
  fr: { 0: 'Pas de givre', 1: 'Risque de givre', 2: 'Givre probable' },
  en: { 0: 'No frost', 1: 'Frost risk', 2: 'Frost likely' },
  de: { 0: 'Kein Reif', 1: 'Reifgefahr', 2: 'Reif wahrscheinlich' },
  es: { 0: 'Sin escarcha', 1: 'Riesgo de escarcha', 2: 'Escarcha probable' },
};

// Black ice risk level (see ice.js) -> human label.
const ICE_LABELS = {
  fr: { 0: 'Pas de verglas', 1: 'Risque de verglas', 2: 'Verglas probable' },
  en: { 0: 'No black ice', 1: 'Black ice risk', 2: 'Black ice likely' },
  de: { 0: 'Keine Glätte', 1: 'Glättegefahr', 2: 'Glätte wahrscheinlich' },
  es: { 0: 'Sin hielo', 1: 'Riesgo de hielo', 2: 'Hielo probable' },
};

// Avalanche danger level 1-5 (European scale, see avalanche.js) -> label,
// as the official bulletins of each language write it.
const AVALANCHE_LABELS = {
  fr: { 1: 'faible', 2: 'limité', 3: 'marqué', 4: 'fort', 5: 'très fort' },
  en: { 1: 'low', 2: 'moderate', 3: 'considerable', 4: 'high', 5: 'very high' },
  de: { 1: 'gering', 2: 'mäßig', 3: 'erheblich', 4: 'groß', 5: 'sehr groß' },
  es: { 1: 'débil', 2: 'limitado', 3: 'notable', 4: 'fuerte', 5: 'muy fuerte' },
};

// UV index bands of the WHO scale, lowest first.
const UV_BANDS = [
  [0, { en: 'low', fr: 'faible', de: 'niedrig', es: 'bajo' }],
  [3, { en: 'moderate', fr: 'modéré', de: 'mäßig', es: 'moderado' }],
  [6, { en: 'high', fr: 'élevé', de: 'hoch', es: 'alto' }],
  [8, { en: 'very high', fr: 'très élevé', de: 'sehr hoch', es: 'muy alto' }],
  [11, { en: 'extreme', fr: 'extrême', de: 'extrem', es: 'extremo' }],
];

// The eight compass points, clockwise from north.
const COMPASS_POINTS = {
  fr: ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'],
  en: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
  de: ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'],
  es: ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'],
};

// Units of the numbers we hand to a scene, per unit system.
const UNIT_SYMBOLS = {
  metric: { temperature: '°C', wind: 'km/h', precipitation: 'mm' },
  us: { temperature: '°F', wind: 'mph', precipitation: 'in' },
};

/**
 * @description Reduce a language to the four the texts are written in.
 * @param {string} [language] - The language of the instance (e.g. 'fr-FR').
 * @returns {'en'|'fr'|'de'|'es'} The text language, English by default.
 * @example
 * textLanguage('de-DE'); // -> 'de'
 */
function textLanguage(language) {
  const code = typeof language === 'string' ? language.slice(0, 2).toLowerCase() : '';
  return LANGUAGES.includes(code) ? code : 'en';
}

/**
 * @description Pick the text of a language.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @param {{en: string, fr: string, de: string, es: string}} texts - The texts.
 * @returns {string} The text of the language, English by default.
 * @example
 * pick('de', { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' }); // -> 'Heute'
 */
function pick(language, texts) {
  return texts[language] ?? texts.en;
}

/**
 * @description Put a label in the middle of a sentence: lower-cased, except in
 * German, where nouns keep their capital ("Morgen: Regen, 8 bis 14 °C").
 * @param {string} label - The label, e.g. 'Pluie'.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The label as written inside a sentence.
 * @example
 * inSentence('Pluie', 'fr'); // -> 'pluie'
 */
function inSentence(label, language) {
  return language === 'de' ? label : label.toLowerCase();
}

/**
 * @description The colon of a language: French puts a space before it.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} ' :' in French, ':' otherwise.
 * @example
 * colon('fr'); // -> ' :'
 */
function colon(language) {
  return language === 'fr' ? ' :' : ':';
}

/**
 * @description Write a percentage the way the language does: "60 %" in
 * French, German and Spanish, "60%" in English.
 * @param {number} value - The percentage.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The percentage.
 * @example
 * percent(60, 'de'); // -> '60 %'
 */
function percent(value, language) {
  return language === 'en' ? `${value}%` : `${value} %`;
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
 * in French, German and Spanish).
 * @param {number} value - The number.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The formatted number.
 * @example
 * formatNumber(4.2, 'fr'); // -> '4,2'
 */
function formatNumber(value, language) {
  return value.toLocaleString(LOCALES[language] ?? LOCALES.en, {
    maximumFractionDigits: 2,
  });
}

/**
 * @description Label of a UV index on the WHO scale.
 * @param {number} index - The UV index.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The label, e.g. 'très élevé'.
 * @example
 * uvLabel(8, 'fr'); // -> 'très élevé'
 */
function uvLabel(index, language) {
  const band = [...UV_BANDS].reverse().find(([minimum]) => index >= minimum) || UV_BANDS[0];
  return pick(language, band[1]);
}

/**
 * @description Compass point a wind blows from.
 * @param {number} degrees - The direction, in degrees (0 = north).
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The compass point, e.g. 'sud-ouest'.
 * @example
 * compassPoint(225, 'fr'); // -> 'sud-ouest'
 */
function compassPoint(degrees, language) {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return (COMPASS_POINTS[language] ?? COMPASS_POINTS.en)[index];
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
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} e.g. 'samedi 26' / 'Saturday 26' / 'Samstag, 26. September'.
 * @example
 * formatDayName('2026-09-26', 'fr'); // -> 'samedi 26'
 */
function formatDayName(dateKey, language) {
  // German writes the day as an ordinal ("26."): with the month, the label
  // still reads well before a colon ("Samstag, 26. September: Regen").
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    weekday: 'long',
    day: 'numeric',
    ...(language === 'de' ? { month: 'long' } : {}),
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
  LANGUAGES,
  CONDITION_LABELS,
  INTENSITY_LABELS,
  VIGILANCE_LABELS,
  FROST_LABELS,
  ICE_LABELS,
  AVALANCHE_LABELS,
  PHENOMENON_LABELS,
  textLanguage,
  pick,
  inSentence,
  colon,
  percent,
  unitSymbols,
  formatNumber,
  formatLocalTime,
  uvLabel,
  compassPoint,
  formatDayName,
  capitalize,
};
