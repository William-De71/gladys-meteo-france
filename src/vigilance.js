// -----------------------------------------------------------------------------
// Météo France vigilance -> pivot CAP alerts (contract B.18).
//
// MF publishes a per-department vigilance with:
//   - `phenomenons_items[]`  { phenomenon_id, phenomenon_max_color_id }
//   - `color_max`            the department's highest color
//   - `comments.text[]`      the SHORT official summary (one sentence)
//   - `text` / `text_avalanche`  the FULL multi-paragraph bulletin
//
// The pivot models alerts through CAP: `severity` + `event` required,
// `description` / `type` / `start` / `end` optional. Mapping decisions:
//   - color 1 (green) is NOT an alert and is filtered out;
//   - colors 2/3/4 map to moderate/severe/extreme (`minor` stays unused: MF has
//     no level below yellow that still warrants an alert);
//   - the department goes into `event` ("Vent violent (Ain)") — the pivot has no
//     geographic field, and `event` is the label the core renders everywhere;
//   - `description` gets the FULL bulletin: the pivot allows 5000 characters,
//     which covers the ~4000 the MF bulletin runs up to. The short summary is
//     prepended so the first line stays SMS-friendly when a channel truncates.
// -----------------------------------------------------------------------------

// Official MF vigilance phenomena. The API only returns the numeric id.
const PHENOMENON_NAMES = {
  1: 'Vent violent',
  2: 'Pluie-inondation',
  3: 'Orages',
  4: 'Crues',
  5: 'Neige-verglas',
  6: 'Canicule',
  7: 'Grand froid',
  8: 'Avalanches',
  9: 'Vagues-submersion',
};

// MF phenomenon -> pivot alert type. The nine MF phenomena land exactly on nine
// of the ten pivot types (only `fog` stays unused: MF has no fog vigilance).
const PHENOMENON_TYPES = {
  1: 'wind',
  2: 'rain', // "Pluie-inondation": the rain IS the phenomenon; id 4 is the flood
  3: 'thunderstorm',
  4: 'flood',
  5: 'snow',
  6: 'heat',
  7: 'cold',
  8: 'avalanche',
  9: 'coastal',
};

// MF vigilance color -> CAP severity. Green (1) is not an alert.
const COLOR_SEVERITIES = {
  2: 'moderate', // jaune
  3: 'severe', // orange
  4: 'extreme', // rouge
};

// The pivot has no geographic field, so the department name is folded into
// `event`. Numbers alone ("06") read poorly in a notification.
const DEPARTMENT_NAMES = {
  '01': 'Ain',
  '02': 'Aisne',
  '03': 'Allier',
  '04': 'Alpes-de-Haute-Provence',
  '05': 'Hautes-Alpes',
  '06': 'Alpes-Maritimes',
  '07': 'Ardèche',
  '08': 'Ardennes',
  '09': 'Ariège',
  10: 'Aube',
  11: 'Aude',
  12: 'Aveyron',
  13: 'Bouches-du-Rhône',
  14: 'Calvados',
  15: 'Cantal',
  16: 'Charente',
  17: 'Charente-Maritime',
  18: 'Cher',
  19: 'Corrèze',
  '2A': 'Corse-du-Sud',
  '2B': 'Haute-Corse',
  21: "Côte-d'Or",
  22: "Côtes-d'Armor",
  23: 'Creuse',
  24: 'Dordogne',
  25: 'Doubs',
  26: 'Drôme',
  27: 'Eure',
  28: 'Eure-et-Loir',
  29: 'Finistère',
  30: 'Gard',
  31: 'Haute-Garonne',
  32: 'Gers',
  33: 'Gironde',
  34: 'Hérault',
  35: 'Ille-et-Vilaine',
  36: 'Indre',
  37: 'Indre-et-Loire',
  38: 'Isère',
  39: 'Jura',
  40: 'Landes',
  41: 'Loir-et-Cher',
  42: 'Loire',
  43: 'Haute-Loire',
  44: 'Loire-Atlantique',
  45: 'Loiret',
  46: 'Lot',
  47: 'Lot-et-Garonne',
  48: 'Lozère',
  49: 'Maine-et-Loire',
  50: 'Manche',
  51: 'Marne',
  52: 'Haute-Marne',
  53: 'Mayenne',
  54: 'Meurthe-et-Moselle',
  55: 'Meuse',
  56: 'Morbihan',
  57: 'Moselle',
  58: 'Nièvre',
  59: 'Nord',
  60: 'Oise',
  61: 'Orne',
  62: 'Pas-de-Calais',
  63: 'Puy-de-Dôme',
  64: 'Pyrénées-Atlantiques',
  65: 'Hautes-Pyrénées',
  66: 'Pyrénées-Orientales',
  67: 'Bas-Rhin',
  68: 'Haut-Rhin',
  69: 'Rhône',
  70: 'Haute-Saône',
  71: 'Saône-et-Loire',
  72: 'Sarthe',
  73: 'Savoie',
  74: 'Haute-Savoie',
  75: 'Paris',
  76: 'Seine-Maritime',
  77: 'Seine-et-Marne',
  78: 'Yvelines',
  79: 'Deux-Sèvres',
  80: 'Somme',
  81: 'Tarn',
  82: 'Tarn-et-Garonne',
  83: 'Var',
  84: 'Vaucluse',
  85: 'Vendée',
  86: 'Vienne',
  87: 'Haute-Vienne',
  88: 'Vosges',
  89: 'Yonne',
  90: 'Territoire de Belfort',
  91: 'Essonne',
  92: 'Hauts-de-Seine',
  93: 'Seine-Saint-Denis',
  94: 'Val-de-Marne',
  95: "Val-d'Oise",
  971: 'Guadeloupe',
  972: 'Martinique',
  973: 'Guyane',
  974: 'La Réunion',
  976: 'Mayotte',
};

// Pivot cap: `event` is truncated to 100 characters by the core.
const MAX_EVENT_LENGTH = 100;
// Pivot cap: `description` is truncated to 5000 characters by the core.
const MAX_DESCRIPTION_LENGTH = 5000;

/**
 * @description Human label of a department number.
 * @param {string} department - The department number (e.g. '06').
 * @returns {string} The department name, or the raw number when unknown.
 * @example
 * departmentName('06'); // -> 'Alpes-Maritimes'
 */
function departmentName(department) {
  return DEPARTMENT_NAMES[department] || department;
}

/**
 * @description Extract the SHORT official vigilance summary (one sentence,
 * e.g. "Épisode caniculaire sévère et durable en cours.").
 * @param {object} warningData - The raw warning payload.
 * @returns {string} The summary, or an empty string.
 * @example
 * parseSummary(warningData);
 */
function parseSummary(warningData) {
  const comments = warningData && warningData.comments;
  const lines = comments && comments.text;
  return Array.isArray(lines) ? lines.join(' ').trim() : '';
}

/**
 * @description Extract the FULL vigilance bulletin. The bulletin structure
 * varies, so the payload is walked and every textual leaf under a `text` key is
 * collected.
 * @param {object} warningData - The raw warning payload.
 * @returns {string} The bulletin, or an empty string.
 * @example
 * parseBulletin(warningData);
 */
function parseBulletin(warningData) {
  const texts = [];
  const walk = (node) => {
    if (!node) {
      return;
    }
    if (typeof node === 'string') {
      if (node.trim()) {
        texts.push(node.trim());
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      Object.keys(node).forEach((key) => {
        if (key === 'text' || key === 'text_items') {
          walk(node[key]);
        } else if (typeof node[key] === 'object') {
          walk(node[key]);
        }
      });
    }
  };
  walk([warningData && warningData.text, warningData && warningData.text_avalanche]);
  return texts.join('\n');
}

/**
 * @description Build the alert description: the short official summary first
 * (so a truncating channel still delivers a meaningful sentence), then the full
 * bulletin.
 * @param {string} summary - The short summary.
 * @param {string} bulletin - The full bulletin.
 * @returns {string} The description, bounded to the pivot's limit.
 * @example
 * buildDescription('Vent fort en cours.', 'Un long bulletin...');
 */
function buildDescription(summary, bulletin) {
  const parts = [];
  if (summary) {
    parts.push(summary);
  }
  // Skip the bulletin when it merely repeats the summary.
  if (bulletin && bulletin !== summary) {
    parts.push(bulletin);
  }
  return parts.join('\n\n').substring(0, MAX_DESCRIPTION_LENGTH);
}

/**
 * @description Turn a raw Météo France vigilance payload into pivot CAP alerts.
 * Green (color 1) phenomena are not alerts and are filtered out.
 * @param {object} warningData - The raw warning payload.
 * @param {string} department - The department the warning belongs to.
 * @returns {Array<object>} The pivot alerts.
 * @example
 * buildAlerts(warningData, '06');
 * // -> [{ severity: 'severe', event: 'Vent violent (Alpes-Maritimes)', type: 'wind', ... }]
 */
function buildAlerts(warningData, department) {
  const items = (warningData && warningData.phenomenons_items) || [];
  if (!Array.isArray(items)) {
    return [];
  }
  const summary = parseSummary(warningData);
  const bulletin = parseBulletin(warningData);
  const description = buildDescription(summary, bulletin);
  const area = departmentName(department);
  const start = toIsoDate(warningData && warningData.begin_validity_time);
  const end = toIsoDate(warningData && warningData.end_validity_time);

  return items
    .filter((item) => COLOR_SEVERITIES[item.phenomenon_max_color_id] !== undefined)
    .map((item) => {
      const id = Number(item.phenomenon_id);
      const name = PHENOMENON_NAMES[id] || `Phénomène ${item.phenomenon_id}`;
      const alert = {
        severity: COLOR_SEVERITIES[item.phenomenon_max_color_id],
        // The department is folded into `event`: the pivot has no area field.
        event: `${name} (${area})`.substring(0, MAX_EVENT_LENGTH),
      };
      const type = PHENOMENON_TYPES[id];
      if (type !== undefined) {
        alert.type = type;
      }
      if (description) {
        alert.description = description;
      }
      if (start !== null) {
        alert.start = start;
      }
      if (end !== null) {
        alert.end = end;
      }
      return alert;
    });
}

/**
 * @description Convert a UNIX timestamp (seconds) to an ISO date.
 * @param {any} timestamp - The timestamp in seconds.
 * @returns {string|null} The ISO date, or null when unusable.
 * @example
 * toIsoDate(1754300000);
 */
function toIsoDate(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp * 1000).toISOString();
}

/**
 * @description Highest vigilance color of a raw warning payload, used by the
 * upstream poll to detect a change worth nudging the core about.
 * @param {object} warningData - The raw warning payload.
 * @returns {number} The color 1..4, defaulting to 1 (green).
 * @example
 * readMaxColor(warningData); // -> 3
 */
function readMaxColor(warningData) {
  const color = warningData && warningData.color_max;
  return typeof color === 'number' && Number.isFinite(color) ? color : 1;
}

export {
  buildAlerts,
  parseSummary,
  parseBulletin,
  buildDescription,
  departmentName,
  readMaxColor,
  PHENOMENON_NAMES,
  PHENOMENON_TYPES,
  COLOR_SEVERITIES,
  DEPARTMENT_NAMES,
};
