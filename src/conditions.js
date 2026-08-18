// -----------------------------------------------------------------------------
// Météo France icon codes -> pivot weather conditions (contract B.18).
//
// Météo France encodes the weather as an icon code shaped `p<n>[bis]<j|n>`:
//   - `n`     the phenomenon number (1..29, only some documented);
//   - `bis`   a DISTINCT condition from its base code, NOT a variant of it
//             (p14 = "Neige" in the legend but p14bis = "Averses");
//   - `j`/`n` day/night. That suffix feeds the pivot's `is_day` boolean and no
//             longer changes the condition: the pivot deprecates the `night`
//             condition precisely because it erased the actual weather.
//
// The `desc` field is the PRIMARY signal, the code table only a fallback for
// descriptions no keyword matches. The published legend turned out to disagree
// with what the API actually sends — it answers `p14j`/"Pluie" and
// `p12j`/"Pluie faible", which the legend maps to snow and thunderstorm — and
// the text is what MF's own website renders. Codes are also not exhaustive
// (p29 shows up as "Orages" without appearing in any documentation).
//
// A `bis` code therefore leans ENTIRELY on the description, and a description
// no keyword matches used to fall through to `unknown` — which the dashboard
// renders as a red thermometer labelled "Indisponible". Two real payloads did
// exactly that: `p2bis`/"Variable" (no keyword at all) and the ENGLISH labels
// the API sometimes returns despite `lang=fr` ("Cloudy", "Storms", "Slight
// showers"). Both are covered below, and the base code now backstops any `bis`
// description that still matches nothing, so an unrated wording degrades to the
// family of its icon instead of to no weather at all.
//
// The pivot enum is: clear | partly-cloudy | cloud | fog | drizzle | rain |
// pouring | sleet | hail | snow | thunderstorm | wind | night | unknown.
// `pouring`, `hail` and `wind` have no dedicated MF icon code (heavy rain is
// derived from the precipitation amount, see forecast.js).
// -----------------------------------------------------------------------------

// Base icon code -> pivot condition, consulted ONLY when the description
// yields nothing. Kept as published even where the field contradicts it (14,
// 12): with no description to go on, a documented guess still beats `unknown`.
// Codes 22-24 are undocumented and left out on purpose rather than guessed;
// 25 and 27-29 are undocumented too but the field pins them down — they arrive
// with "Orage avec grêle", "Risque d'orages" and "Orages".
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
  25: 'hail', // Orage avec grêle (observed as p25bis in the field)
  26: 'thunderstorm', // Risque d'orages (confirmed by the API's own `desc`)
  27: 'thunderstorm', // Risque d'orages
  28: 'thunderstorm', // Orages
  29: 'thunderstorm', // Orages
};

// Keyword fallback: guess the condition from the API's own description.
//
// Order matters, and encodes three rules:
//   - a COMPOSITE phenomenon is matched before each of its parts ("pluie et
//     neige" is sleet, not snow, so it is tested before the bare 'neige');
//   - "grêle" wins over "orage", so "Orage avec grêle" lands on hail — the
//     more specific of the two, and the one the pivot has an icon for;
//   - "orage" then wins over the generic rain keywords, so "Pluies orageuses"
//     and "Averses orageuses" land on thunderstorm.
//
// Accents are NOT reliable in the payload: MF returns "Eclaircies" unaccented
// while other labels carry their accents, so both spellings are listed.
//
// ENGLISH labels are listed alongside the French ones because the API ignores
// `lang=fr` on some entries and answers "Cloudy" / "Storms" / "Slight showers"
// mid-payload. They cost one array entry each and spare a red thermometer.
const KEYWORD_CONDITIONS = [
  // Hail before thunderstorm: "Orage avec grêle" carries both words.
  { keywords: ['grêle', 'grele', 'hail'], condition: 'hail' },
  { keywords: ['orage', 'storm', 'thunder'], condition: 'thunderstorm' },
  // Composites first: 'neige' alone would swallow them.
  { keywords: ['pluie et neige', 'neige et pluie', 'sleet'], condition: 'sleet' },
  { keywords: ['neige', 'verglas', 'snow', 'freezing'], condition: 'snow' },
  { keywords: ['bruine', 'drizzle'], condition: 'drizzle' },
  { keywords: ['pluie', 'averse', 'rain', 'shower'], condition: 'rain' },
  { keywords: ['brouillard', 'brume', 'fog', 'mist'], condition: 'fog' },
  // "Très nuageux" is an overcast sky on MF's own legend, not a sunny spell:
  // it must be tested before the bare 'nuage' below, which would otherwise
  // print a sun behind the cloud.
  { keywords: ['couvert', 'overcast', 'très nuageux', 'tres nuageux'], condition: 'cloud' },
  // Broken clouds, not a clear sky: MF pairs "Eclaircies" with the p2 icon,
  // which its own legend renders as a sun behind a cloud. "Variable" is the
  // same idea worded differently — it is what p2bis answers, and leaving it
  // unmatched is what put a red thermometer on the dashboard.
  { keywords: ['eclaircie', 'éclaircie', 'variable'], condition: 'partly-cloudy' },
  { keywords: ['nuage', 'nuageux', 'voilé', 'voile', 'cloud'], condition: 'partly-cloudy' },
  { keywords: ['soleil', 'ensoleillé', 'ciel clair', 'clear', 'sun'], condition: 'clear' },
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
  // The description wins over the code table whenever it is conclusive: the
  // table was built on a legend the API contradicts in the field (it answers
  // `p14j` for "Pluie", which the table maps to snow, and `p12j` for "Pluie
  // faible", which it maps to thunderstorm).
  const fromDescription = conditionFromDescription(description);
  if (fromDescription !== 'unknown') {
    return { condition: fromDescription, isDay };
  }
  // Nothing matched the wording. The base code is a rough guess for a `bis`
  // (it is a distinct phenomenon, not a variant) but it stays in the right
  // family, and a roughly right sky beats the red thermometer `unknown`
  // renders. Codes absent from the table still yield 'unknown'.
  return { condition: CONDITION_BY_CODE[Number(match[1])] || 'unknown', isDay };
}

export { parseWeather, conditionFromDescription, CONDITION_BY_CODE, KEYWORD_CONDITIONS };
