// -----------------------------------------------------------------------------
// Météo France icon codes -> pivot weather conditions (contract B.18).
//
// Météo France encodes the weather as an icon code shaped `p<n>[bis]<j|n>`:
//   - `n`     the phenomenon number (1..26, only some documented);
//   - `bis`   a DISTINCT condition from its base code, NOT a variant of it
//             (p14 = "Neige" but p14bis = "Averses") -> never looked up in the
//             base table, it goes straight to the keyword fallback;
//   - `j`/`n` day/night. That suffix feeds the pivot's `is_day` boolean and no
//             longer changes the condition: the pivot deprecates the `night`
//             condition precisely because it erased the actual weather.
//
// The pivot enum is: clear | partly-cloudy | cloud | fog | drizzle | rain |
// pouring | sleet | hail | snow | thunderstorm | wind | night | unknown.
// `pouring`, `hail` and `wind` have no dedicated MF icon code (heavy rain is
// derived from the precipitation amount, see forecast.js).
// -----------------------------------------------------------------------------

// Base icon code -> pivot condition. Codes 22-25 are undocumented and left out
// on purpose rather than guessed: they fall through to the keyword fallback.
const CONDITION_BY_CODE = {
  1: 'clear', // Ensoleillé / Ciel clair
  2: 'partly-cloudy', // Peu nuageux
  3: 'partly-cloudy', // Nuageux
  4: 'partly-cloudy', // Nuageux
  5: 'cloud', // Très nuageux / Couvert
  6: 'fog', // Brouillard
  7: 'fog', // Brouillard givrant
  8: 'drizzle', // Rares averses
  9: 'rain', // Pluie faible
  10: 'rain', // Pluie modérée
  11: 'rain', // Averses
  12: 'thunderstorm', // Pluies orageuses
  13: 'sleet', // Pluie et neige mêlées
  14: 'snow', // Neige
  15: 'snow', // Fortes chutes de neige
  16: 'snow', // Neige
  17: 'thunderstorm', // Orages
  18: 'thunderstorm',
  19: 'thunderstorm',
  20: 'thunderstorm',
  21: 'thunderstorm',
  26: 'thunderstorm', // Risque d'orages (confirmed by the API's own `desc`)
};

// Keyword fallback for unknown codes and every `bis` code: guess from the API's
// own French description. Order matters — "orage" is checked before the generic
// rain keywords, so "Pluies orageuses" lands on thunderstorm.
const KEYWORD_CONDITIONS = [
  { keywords: ['orage'], condition: 'thunderstorm' },
  { keywords: ['neige', 'verglas'], condition: 'snow' },
  { keywords: ['bruine'], condition: 'drizzle' },
  { keywords: ['pluie', 'averse'], condition: 'rain' },
  { keywords: ['brouillard', 'brume'], condition: 'fog' },
  { keywords: ['couvert'], condition: 'cloud' },
  { keywords: ['nuage', 'nuageux', 'voilé'], condition: 'partly-cloudy' },
  { keywords: ['soleil', 'ensoleillé', 'ciel clair', 'éclaircie'], condition: 'clear' },
];

const ICON_CODE_REGEX = /^p(\d+)(bis)?([jn])$/;

/**
 * @description Guess a pivot condition from the API's French description, used
 * for undocumented and `bis` icon codes.
 * @param {string} [description] - The `desc` field of the MF weather object.
 * @returns {string} A pivot condition, 'unknown' when nothing matches.
 * @example
 * conditionFromDescription("Risque d'orages"); // -> 'thunderstorm'
 */
function conditionFromDescription(description) {
  const normalized = typeof description === 'string' ? description.toLowerCase() : '';
  const match = KEYWORD_CONDITIONS.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword)),
  );
  // 'unknown' is more honest than defaulting to clear: the core renders it as a
  // neutral icon instead of claiming a sunny sky.
  return match ? match.condition : 'unknown';
}

/**
 * @description Parse a Météo France icon code into a pivot condition and the
 * day/night flag.
 * @param {object} [weather] - The MF weather object ({ icon, desc }).
 * @returns {{ condition: string, isDay: boolean|null }} The pivot condition and
 * the day flag (null when the code could not be parsed).
 * @example
 * parseWeather({ icon: 'p14bisj', desc: 'Averses' });
 * // -> { condition: 'rain', isDay: true }
 */
function parseWeather(weather) {
  const icon = weather && typeof weather.icon === 'string' ? weather.icon : '';
  const description = weather && weather.desc;
  const match = ICON_CODE_REGEX.exec(icon);
  if (match === null) {
    // No parsable code: the description is all we have, and no day/night signal.
    return { condition: conditionFromDescription(description), isDay: null };
  }
  const isDay = match[3] === 'j';
  // A `bis` code is a distinct condition from its base: never look it up.
  if (match[2]) {
    return { condition: conditionFromDescription(description), isDay };
  }
  const condition = CONDITION_BY_CODE[Number(match[1])];
  return {
    condition: condition || conditionFromDescription(description),
    isDay,
  };
}

export { parseWeather, conditionFromDescription, CONDITION_BY_CODE, KEYWORD_CONDITIONS };
