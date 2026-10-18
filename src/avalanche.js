// -----------------------------------------------------------------------------
// Avalanche bulletins (BRA) of Météo France: reading, scene action outputs and
// the avalanche_risk trigger.
//
// One bulletin per massif (see massifs.js), written every day around 16:00
// from early November to late May, valid until 18:00 the next day. The danger
// follows the European scale, 1 (low) to 5 (very high), possibly split at an
// altitude ("1 below 2400 m, 2 above") and rising during the day; RISQUEMAXI
// is the highest of them, the figure the trigger and the summary use.
//
// The bulletin is XML, documented by Météo France ("Descriptif technique des
// informations du bulletin avalanche"). Only a handful of attributes and texts
// are read, from a flat machine format: a small reader is enough, no XML
// library. Out of season the webservice answers a JSON `error_message`, and
// for Andorra an XML `<message>`: both mean "no bulletin", with their text.
//
// avalanche_risk fires when the danger of a massif RISES to a level: once per
// level crossed, re-armed when the danger falls back below it. The end of the
// season counts as 0, so the first bulletin of November fires too; the first
// reading after a start is a baseline. Every function here is pure.
// -----------------------------------------------------------------------------

import {
  AVALANCHE_LABELS,
  textLanguage,
  pick,
  colon,
  formatDayName,
  capitalize,
} from './scene-text.js';

// Values of the `level` field of avalanche_risk. Published values: never renamed.
const AVALANCHE_LEVELS = [
  { level: 'moderate', threshold: 2 },
  { level: 'considerable', threshold: 3 },
  { level: 'high', threshold: 4 },
  { level: 'very_high', threshold: 5 },
];

// Longest text handed to a scene.
const MAX_TEXT_LENGTH = 2000;

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * @description Decode the XML entities of a text.
 * @param {string} text - The raw text.
 * @returns {string} The decoded text.
 * @example
 * decodeEntities('Risque limit&#233; &gt; 2200 m'); // -> 'Risque limité > 2200 m'
 */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * @description The attributes of the first `<tag ...>` of an XML text.
 * @param {string} xml - The XML.
 * @param {string} tag - The tag name.
 * @returns {object|null} Attribute name -> decoded value, or null when absent.
 * @example
 * readAttributes('<RISQUE RISQUE1="2"/>', 'RISQUE'); // -> { RISQUE1: '2' }
 */
function readAttributes(xml, tag) {
  const match = new RegExp(`<${tag}(\\s[^>]*?)?\\s*/?>`).exec(xml);
  if (match === null) {
    return null;
  }
  const attributes = {};
  for (const [, name, value] of (match[1] || '').matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[name] = decodeEntities(value);
  }
  return attributes;
}

/**
 * @description The raw content of the first `<tag>…</tag>` of an XML text,
 * entities left as they are.
 * @param {string} xml - The XML.
 * @param {string} tag - The tag name.
 * @returns {string|null} The content, or null when absent.
 * @example
 * readBlock('<A><B/></A>', 'A'); // -> '<B/>'
 */
function readBlock(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match === null ? null : match[1];
}

/**
 * @description The text content of the first `<tag>…</tag>` of an XML text,
 * CDATA or escaped.
 * @param {string} xml - The XML.
 * @param {string} tag - The tag name.
 * @returns {string} The trimmed text, '' when absent or empty.
 * @example
 * readText('<RESUME><![CDATA[Neige humide]]></RESUME>', 'RESUME'); // -> 'Neige humide'
 */
function readText(xml, tag) {
  const content = readBlock(xml, tag);
  if (content === null) {
    return '';
  }
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(content);
  return (cdata ? cdata[1] : decodeEntities(content)).trim();
}

/**
 * @description A danger level 1-5 from an attribute, or null.
 * @param {string|undefined} value - The attribute value.
 * @returns {number|null} The level.
 * @example
 * readLevel('3'); // -> 3
 */
function readLevel(value) {
  const level = Number.parseInt(value, 10);
  return level >= 1 && level <= 5 ? level : null;
}

/**
 * @description The highest danger level among attributes, or null.
 * @param {...(string|undefined)} values - The attribute values.
 * @returns {number|null} The level.
 * @example
 * highest('2', '3'); // -> 3
 */
function highest(...values) {
  const levels = values.map(readLevel).filter((level) => level !== null);
  return levels.length > 0 ? Math.max(...levels) : null;
}

/**
 * @description A positive whole number from an attribute, or null.
 * @param {string|undefined} value - The attribute value.
 * @returns {number|null} The number.
 * @example
 * readPositive('2400'); // -> 2400
 */
function readPositive(value) {
  const number = Number.parseInt(value, 10);
  return number > 0 ? number : null;
}

/**
 * @description A text of the bulletin, ready for a scene: Windows line ends
 * removed, trimmed, bounded.
 * @param {string|undefined} text - The text.
 * @returns {string} The clean text.
 * @example
 * cleanText(' a\r\nb '); // -> 'a\nb'
 */
function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .substring(0, MAX_TEXT_LENGTH);
}

/**
 * @description Read the answer of the bulletin endpoint.
 * @param {string} body - The XML bulletin, or the JSON / XML message out of season.
 * @returns {object} `{ available: false, message }`, or `{ available: true,
 * massifId, massif, issuedAt, validUntil, date, risk, riskBelow, riskAbove,
 * altitude, nextDayRisk, nextDayDate, comment, details }`.
 * @example
 * parseAvalancheBulletin(xml).risk; // -> 3
 */
function parseAvalancheBulletin(body) {
  const text = typeof body === 'string' ? body : '';
  const root = readAttributes(text, 'BULLETINS_NEIGE_AVALANCHE');
  if (root === null) {
    let message = readText(text, 'message');
    if (!message) {
      try {
        message = String(JSON.parse(text).error_message || '');
      } catch {
        message = '';
      }
    }
    return { available: false, message: cleanText(message) };
  }
  // Only the head of the bulletin: the history of the past days (BSH) has
  // RISQUE elements of its own.
  const head = readBlock(text, 'CARTOUCHERISQUE') || '';
  const danger = readAttributes(head, 'RISQUE') || {};
  // Each band at its worst of the day: a danger "rising from 2 to 3" is a 3.
  const riskBelow = highest(danger.RISQUE1, danger.EVOLURISQUE1);
  const riskAbove = highest(danger.RISQUE2, danger.EVOLURISQUE2);
  const validUntil = root.DATEVALIDITE || root.DATEECHEANCE || '';
  const nextDayDate = String(danger.DATE_RISQUE_J2 || '').substring(0, 10);
  return {
    available: true,
    massifId: String(root.ID || '').padStart(2, '0'),
    massif: root.MASSIF || '',
    issuedAt: root.DATEBULLETIN || '',
    validUntil,
    // The day the bulletin covers: the one it expires on.
    date: validUntil.substring(0, 10),
    risk: highest(danger.RISQUEMAXI, riskBelow, riskAbove),
    riskBelow,
    // Only a split bulletin has a second level and an altitude.
    riskAbove,
    altitude: riskAbove === null ? null : readPositive(danger.ALTITUDE),
    nextDayRisk: readLevel(danger.RISQUEMAXIJ2),
    nextDayDate: /^\d{4}-\d{2}-\d{2}$/.test(nextDayDate) ? nextDayDate : null,
    comment: cleanText(danger.COMMENTAIRE),
    details: cleanText(readText(head, 'RESUME')),
  };
}

/**
 * @description The sentence of a bulletin, in the language of the instance.
 * @param {object} bulletin - A parsed bulletin.
 * @param {string} massif - The massif name.
 * @param {string} lang - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The sentence.
 * @example
 * describeBulletin(bulletin, 'Mont-Blanc', 'fr');
 * // -> 'Massif Mont-Blanc : risque d’avalanche marqué (3 sur 5) pour mardi 19.'
 */
function describeBulletin(bulletin, massif, lang) {
  const label = AVALANCHE_LABELS[lang][bulletin.risk];
  const day = bulletin.date ? formatDayName(bulletin.date, lang) : '';
  const head = pick(lang, {
    en: `${massif} massif${colon(lang)} ${label} avalanche danger (${bulletin.risk} of 5)`,
    fr: `Massif ${massif}${colon(lang)} risque d’avalanche ${label} (${bulletin.risk} sur 5)`,
    de: `Massiv ${massif}${colon(lang)} Lawinengefahr ${label} (Stufe ${bulletin.risk} von 5)`,
    es: `Macizo ${massif}${colon(lang)} peligro de aludes ${label} (${bulletin.risk} de 5)`,
  });
  const when = day
    ? pick(lang, {
        en: ` for ${day}`,
        fr: ` pour ${day}`,
        de: ` für ${day}`,
        es: ` para el ${day}`,
      })
    : '';
  let split = '';
  if (bulletin.riskAbove !== null && bulletin.riskBelow !== null && bulletin.altitude !== null) {
    const { riskAbove: above, riskBelow: below, altitude } = bulletin;
    split = pick(lang, {
      en: `, ${above} above ${altitude} m and ${below} below`,
      fr: `, ${above} au-dessus de ${altitude} m et ${below} en dessous`,
      de: `, ${above} oberhalb von ${altitude} m und ${below} darunter`,
      es: `, ${above} por encima de ${altitude} m y ${below} por debajo`,
    });
  }
  return `${head}${when}${split}.`;
}

/**
 * @description The sentence when a massif has no bulletin.
 * @param {string} massif - The massif name.
 * @param {string} lang - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The sentence.
 * @example
 * describeNoBulletin('Mont-Blanc', 'en');
 */
function describeNoBulletin(massif, lang) {
  return pick(lang, {
    en: `No avalanche bulletin for the ${massif} massif at the moment (season from November to May).`,
    fr: `Pas de bulletin d’avalanche pour le massif ${massif} en ce moment (saison de novembre à mai).`,
    de: `Derzeit kein Lawinenbulletin für das Massiv ${massif} (Saison von November bis Mai).`,
    es: `Sin boletín de aludes para el macizo ${massif} por ahora (temporada de noviembre a mayo).`,
  });
}

/**
 * @description Outputs of get_avalanche_risk.
 * @param {object} bulletin - A parsed bulletin (parseAvalancheBulletin).
 * @param {{id: string, name: string}} massif - The massif asked about.
 * @param {string} language - The language of the instance.
 * @returns {object} The outputs (scalars only).
 * @example
 * buildAvalancheOutputs(bulletin, { id: '03', name: 'Mont-Blanc' }, 'fr');
 */
function buildAvalancheOutputs(bulletin, massif, language) {
  const lang = textLanguage(language);
  if (!bulletin.available || bulletin.risk === null) {
    const outputs = {
      massif: massif.name,
      has_bulletin: false,
      summary: describeNoBulletin(massif.name, lang),
    };
    if (bulletin.message) {
      outputs.comment = bulletin.message;
    }
    return outputs;
  }
  const outputs = {
    massif: massif.name,
    has_bulletin: true,
    risk: bulletin.risk,
    risk_label: AVALANCHE_LABELS[lang][bulletin.risk],
    summary: describeBulletin(bulletin, massif.name, lang),
  };
  // An unknown figure is left out, never sent as 0.
  if (bulletin.date) {
    outputs.date = bulletin.date;
  }
  if (bulletin.riskAbove !== null && bulletin.altitude !== null) {
    outputs.risk_below = bulletin.riskBelow;
    outputs.risk_above = bulletin.riskAbove;
    outputs.altitude = bulletin.altitude;
  }
  if (bulletin.nextDayRisk !== null) {
    outputs.risk_next_day = bulletin.nextDayRisk;
  }
  if (bulletin.comment) {
    outputs.comment = bulletin.comment;
  }
  if (bulletin.details) {
    outputs.details = bulletin.details;
  }
  return outputs;
}

/**
 * @description The danger a bulletin stands for in the trigger: 0 when there
 * is none (out of season), so the first bulletin of the season is a rise.
 * @param {object} bulletin - A parsed bulletin.
 * @returns {number} The danger 0-5.
 * @example
 * readTriggerRisk({ available: false }); // -> 0
 */
function readTriggerRisk(bulletin) {
  return bulletin.available && bulletin.risk !== null ? bulletin.risk : 0;
}

/**
 * @description The levels of avalanche_risk a new bulletin rises to.
 * @param {number|undefined} previousRisk - The danger of the previous reading,
 * undefined on the first one (a baseline: nothing fires).
 * @param {number} risk - The danger now (readTriggerRisk).
 * @returns {Array<object>} The AVALANCHE_LEVELS entries crossed upwards.
 * @example
 * detectAvalancheRise(2, 4); // -> the 'considerable' and 'high' levels
 */
function detectAvalancheRise(previousRisk, risk) {
  if (previousRisk === undefined) {
    return [];
  }
  return AVALANCHE_LEVELS.filter(({ threshold }) => previousRisk < threshold && risk >= threshold);
}

/**
 * @description The event data of avalanche_risk (flat scalars).
 * @param {object} options - Options.
 * @param {object} options.level - The AVALANCHE_LEVELS entry crossed.
 * @param {object} options.bulletin - The parsed bulletin.
 * @param {{id: string, name: string}} options.massif - The massif.
 * @param {string} options.house - The house name.
 * @param {number} options.previousRisk - The danger before.
 * @param {string} options.language - The language of the instance.
 * @returns {object} The event data.
 * @example
 * buildAvalancheEventData({ level, bulletin, massif, house: 'Chalet', previousRisk: 2, language: 'fr' });
 */
function buildAvalancheEventData({ level, bulletin, massif, house, previousRisk, language }) {
  const lang = textLanguage(language);
  const data = {
    house,
    massif: massif.name,
    level: level.level,
    risk: bulletin.risk,
    risk_label: AVALANCHE_LABELS[lang][bulletin.risk],
    previous_risk: previousRisk,
    summary: capitalize(describeBulletin(bulletin, massif.name, lang)),
  };
  if (bulletin.date) {
    data.date = bulletin.date;
  }
  return data;
}

export {
  AVALANCHE_LEVELS,
  parseAvalancheBulletin,
  buildAvalancheOutputs,
  buildAvalancheEventData,
  detectAvalancheRise,
  readTriggerRisk,
  decodeEntities,
};
