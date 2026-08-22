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
// yields nothing.
//
// REBUILT from a full survey of the icon set (August 2026) rather than from
// the published legend, which the field contradicts on almost every code. The
// method: probe every `p<n>[bis|ter|quater]<j|n>.svg` on meteofrance.com to
// list what exists (132 icons, 66 distinct codes, n up to 34), collect the
// `desc` the API actually answers over 60 locations, then read the rendered
// drawings for the codes no sampling reached. The full table lives in
// `Externe-Integration/meteo-france-icons/meteo-france-icones.md`.
//
// Three findings the legend got wrong, and that a colour analysis alone could
// not have caught either -- they are drawn as badges over the cloud:
//   - 8 is a "GIV." badge: freezing FOG, not the legend's "Rares averses";
//   - 10 and 11 carry a black-ice road sign: freezing RAIN, not plain rain;
//   - 24 and 25 carry a "G" badge: hail.
// Codes 30-34 are absent from every legend: thundery snow, sandstorm,
// waterspout, tornado and cyclone.
const CONDITION_BY_CODE = {
  1: 'clear', // Ensoleillé / Ciel clair (p1bis: Peu nuageux)
  2: 'partly-cloudy', // Eclaircies (p2bis: Variable)
  3: 'cloud', // Très nuageux (p3bis: Couvert)
  4: 'partly-cloudy', // Ciel voilé: a thin veil over an otherwise bright sky
  5: 'fog', // Brume
  6: 'fog', // Brume (3 haze bars, where 7 draws 6)
  7: 'fog', // Brouillard
  8: 'freezing-fog', // Brouillard givrant ("GIV." badge)
  9: 'rain', // Pluie faible
  10: 'freezing-rain', // Pluie verglaçante (black-ice road sign)
  11: 'freezing-rain', // Pluie verglaçante (black-ice road sign)
  12: 'rain', // Pluie faible (p12bis: Averses faibles)
  13: 'rain', // Pluie faible (p13bis: Averses faibles)
  14: 'rain', // Pluie (p14bis: Averses, p14ter: Pluie modérée)
  15: 'pouring', // Pluie forte (dark cloud, dense rain)
  16: 'thunderstorm', // Averses orageuses
  17: 'snow', // Neige faible (1 flake)
  18: 'snow', // Averses de neige faible (1 flake)
  19: 'sleet', // Pluie et neige (flakes AND drops)
  20: 'sleet', // Pluie et neige (flakes AND drops)
  21: 'snow', // Neige (2 flakes)
  22: 'snow', // Averses de neige (2 flakes)
  23: 'snow', // Neige forte (3 flakes, dark cloud)
  24: 'hail', // Grêle ("G" badge; the base code adds a bolt, p24bis/ter do not)
  25: 'hail', // Orage avec grêle ("G" badge + bolt)
  26: 'thunderstorm', // Risque d'orages
  27: 'thunderstorm', // Risque d'orages
  28: 'thunderstorm', // Orages
  29: 'thunderstorm', // Orages
  30: 'snow-thunderstorm', // Averses de neige orageuses (flakes + bolt)
  31: 'sandstorm', // Tempête de sable
  32: 'tornado', // Trombe marine
  33: 'tornado', // Tornade
  34: 'hurricane', // Cyclone
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
  // The violent and the freezing phenomena come FIRST: each of their wordings
  // contains a keyword of a milder family further down ("pluie verglaçante"
  // holds 'pluie', "brouillard givrant" holds 'brouillard', "averses de neige
  // orageuses" holds both 'neige' and 'orage'), so a later rule would swallow
  // them and drop the very warning that sets them apart.
  { keywords: ['cyclone', 'ouragan', 'hurricane'], condition: 'hurricane' },
  { keywords: ['tornade', 'trombe', 'tornado', 'waterspout'], condition: 'tornado' },
  { keywords: ['sable', 'poussière', 'poussiere', 'sandstorm', 'dust'], condition: 'sandstorm' },
  {
    keywords: ['verglaçante', 'verglacante', 'verglas', 'freezing rain'],
    condition: 'freezing-rain',
  },
  {
    keywords: ['brouillard givrant', 'brume givrante', 'freezing fog'],
    condition: 'freezing-fog',
  },
  // Hail before thunderstorm: "Orage avec grêle" carries both words.
  { keywords: ['grêle', 'grele', 'hail'], condition: 'hail' },
  // A thundery snow shower is neither plain snow nor plain thunderstorm, and
  // both of those keywords sit below.
  {
    keywords: ['neige orageuse', 'averses de neige orageuses', 'thundery snow'],
    condition: 'snow-thunderstorm',
  },
  { keywords: ['orage', 'storm', 'thunder'], condition: 'thunderstorm' },
  // Composites first: 'neige' alone would swallow them.
  { keywords: ['pluie et neige', 'neige et pluie', 'sleet'], condition: 'sleet' },
  { keywords: ['neige', 'verglas', 'snow', 'freezing'], condition: 'snow' },
  { keywords: ['bruine', 'drizzle'], condition: 'drizzle' },
  { keywords: ['pluie', 'averse', 'rain', 'shower'], condition: 'rain' },
  { keywords: ['brouillard', 'brume', 'fog', 'mist'], condition: 'fog' },
  // "Peu nuageux" is a mostly clear sky and must be tested BEFORE the bare
  // 'nuageux' below, which would otherwise swallow it into the overcast family.
  { keywords: ['peu nuageux', 'partly'], condition: 'partly-cloudy' },
  // Broken clouds, not a clear sky: MF pairs "Eclaircies" with the p2 icon,
  // which its own legend renders as a sun behind a cloud. "Variable" is the
  // same idea worded differently — it is what p2bis answers, and leaving it
  // unmatched is what put a red thermometer on the dashboard.
  { keywords: ['eclaircie', 'éclaircie', 'variable'], condition: 'partly-cloudy' },
  // "Nuageux", "Très nuageux" and "Couvert" are all a mostly covered sky on
  // MF's own legend, not a sunny spell: mapping them to `partly-cloudy` printed
  // a sun behind a cloud where meteofrance.com showed a plain cloud.
  {
    keywords: ['couvert', 'overcast', 'nuageux', 'nuage', 'cloud'],
    condition: 'cloud',
  },
  // "Ciel voilé" is a thin veil over an otherwise bright sky: the pivot has no
  // condition for it, and `partly-cloudy` is the closest of the two families.
  { keywords: ['voilé', 'voile'], condition: 'partly-cloudy' },
  { keywords: ['soleil', 'ensoleillé', 'ciel clair', 'clear', 'sun'], condition: 'clear' },
];

// `bis`, `ter` and `quater` all appear in the icon set, and the API does send
// them: `p18terj` came back in a real payload. Missing a suffix here sends the
// code down the "unparsable" branch, which loses the day/night flag AND the
// per-code fallback.
const ICON_CODE_REGEX = /^p(\d+)(bis|ter|quater)?([jn])$/;

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

// How "notable" a condition is, used to summarise a whole day from its hours.
//
// This is NOT a severity scale for warnings — vigilance owns that. It answers
// one question: of the skies a day goes through, which one does a forecast
// print next to that day? A day alternating sun and showers is a showery day on
// meteofrance.com, never a sunny one, so precipitation outranks any clear sky.
//
// Within precipitation the order follows intensity (drizzle < rain < pouring)
// and then the phenomena that override it whatever their amount (snow, hail,
// thunderstorm). Fog and cloud sit just above the clear skies: they describe a
// dull day, but any rain that day describes it better.
//
// `unknown` is deliberately the lowest: it must never win over a real sky.
const CONDITION_SIGNIFICANCE = {
  unknown: 0,
  clear: 1,
  'partly-cloudy': 2,
  cloud: 3,
  wind: 4,
  fog: 5,
  'freezing-fog': 6,
  drizzle: 7,
  rain: 8,
  pouring: 9,
  sleet: 10,
  snow: 11,
  'freezing-rain': 12,
  hail: 13,
  thunderstorm: 14,
  'snow-thunderstorm': 15,
  // The three that a day is named after whatever else it holds. Leaving them
  // unrated scored them 0, below a clear sky, so an hour of cyclone could not
  // win the day summary.
  sandstorm: 16,
  tornado: 17,
  hurricane: 18,
};

/**
 * @description Rank a pivot condition on the day-summary scale.
 * @param {string} condition - A pivot condition.
 * @returns {number} Its significance, 0 for anything unrated.
 * @example
 * conditionSignificance('rain'); // -> 7
 */
function conditionSignificance(condition) {
  return CONDITION_SIGNIFICANCE[condition] || 0;
}

export {
  parseWeather,
  conditionFromDescription,
  conditionSignificance,
  CONDITION_BY_CODE,
  CONDITION_SIGNIFICANCE,
  KEYWORD_CONDITIONS,
};
