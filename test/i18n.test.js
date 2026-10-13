import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LANGUAGES,
  CONDITION_LABELS,
  INTENSITY_LABELS,
  VIGILANCE_LABELS,
  FROST_LABELS,
  ICE_LABELS,
  PHENOMENON_LABELS,
  textLanguage,
  uvLabel,
  compassPoint,
  formatNumber,
  formatDayName,
  percent,
  inSentence,
} from '../src/scene-text.js';
import { PHENOMENON_NAMES } from '../src/vigilance.js';
import { triggerSamples, actionSamples } from './helpers/samples.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../gladys-assistant-integration.json'));

/**
 * @description Every multi-language object of the manifest, with its path.
 * @param {unknown} node - A manifest node.
 * @param {string} path - Its path.
 * @returns {Array<[string, object]>} The texts.
 */
function texts(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => texts(child, `${path}[${i}]`));
  }
  if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      return [[path, node]];
    }
    return Object.entries(node).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [];
}

test('every manifest text exists in English, French, German and Spanish', () => {
  const found = texts(manifest);
  assert.ok(found.length > 300);
  for (const [path, entry] of found) {
    assert.deepEqual(Object.keys(entry), LANGUAGES, path);
    for (const language of LANGUAGES) {
      assert.ok(entry[language]?.trim(), `${path}.${language} is missing`);
    }
  }
});

test('catalog description: 10 to 100 characters per language', () => {
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length}`);
  }
});

test('the manifest stays under the 100 KB of the store', () => {
  // 97 KB with the four languages: a long new text may not fit anymore.
  assert.ok(Buffer.byteLength(read('../gladys-assistant-integration.json')) < 100 * 1024);
});

test('every runtime label exists in the four languages', () => {
  const tables = {
    CONDITION_LABELS,
    INTENSITY_LABELS,
    VIGILANCE_LABELS,
    FROST_LABELS,
    ICE_LABELS,
    PHENOMENON_LABELS,
  };
  for (const [name, table] of Object.entries(tables)) {
    assert.deepEqual(Object.keys(table).sort(), [...LANGUAGES].sort(), name);
    const keys = Object.keys(table.en);
    for (const language of LANGUAGES) {
      assert.deepEqual(Object.keys(table[language]), keys, `${name}.${language}`);
      for (const key of keys) {
        assert.ok(table[language][key]?.trim(), `${name}.${language}.${key}`);
      }
    }
  }
  // The French names are the official ones the dashboard alerts keep.
  assert.deepEqual(PHENOMENON_LABELS.fr, PHENOMENON_NAMES);
});

test('reads the language of the instance, English by default', () => {
  assert.equal(textLanguage('de-DE'), 'de');
  assert.equal(textLanguage('es'), 'es');
  assert.equal(textLanguage('FR-fr'), 'fr');
  assert.equal(textLanguage('it'), 'en');
  assert.equal(textLanguage(undefined), 'en');
});

test('numbers, percentages, days, directions and labels follow each language', () => {
  assert.equal(formatNumber(4.2, 'de'), '4,2');
  assert.equal(formatNumber(4.2, 'es'), '4,2');
  assert.equal(formatNumber(4.2, 'en'), '4.2');
  assert.equal(percent(60, 'en'), '60%');
  assert.equal(percent(60, 'de'), '60 %');
  assert.equal(formatDayName('2026-09-26', 'de'), 'Samstag, 26. September');
  assert.equal(formatDayName('2026-09-26', 'es'), 'sábado 26');
  assert.equal(compassPoint(225, 'de'), 'Südwest');
  assert.equal(compassPoint(225, 'es'), 'suroeste');
  assert.equal(uvLabel(8, 'de'), 'sehr hoch');
  assert.equal(uvLabel(11, 'es'), 'extremo');
  // German nouns keep their capital inside a sentence.
  assert.equal(inSentence('Regen', 'de'), 'Regen');
  assert.equal(inSentence('Lluvia', 'es'), 'lluvia');
});

test('every scene summary and label is written in the language of the instance', () => {
  const english = { ...triggerSamples('en'), ...actionSamples('en') };
  for (const language of ['fr', 'de', 'es']) {
    const samples = { ...triggerSamples(language), ...actionSamples(language) };
    for (const [key, data] of Object.entries(samples)) {
      assert.ok(data.summary?.trim(), `${key}.summary in ${language}`);
      assert.notEqual(data.summary, english[key].summary, `${key}.summary in ${language}`);
      for (const label of ['intensity_label', 'level_label', 'condition_label', 'uv_label']) {
        if (label in data && !['orange'].includes(data[label])) {
          assert.notEqual(data[label], english[key][label], `${key}.${label} in ${language}`);
        }
      }
    }
  }
});

test('the scene sentences read naturally in German and Spanish', () => {
  const de = { ...triggerSamples('de'), ...actionSamples('de') };
  const es = { ...triggerSamples('es'), ...actionSamples('es') };
  assert.equal(de.frost_forecast.summary, 'Frost angekündigt: -2 °C morgen um 06:00 erwartet.');
  assert.equal(
    de.get_forecast.summary,
    'Morgen: Regen, 14 bis 21 °C, 4,2 mm Regen (80 %), Böen bis 55 km/h.',
  );
  assert.equal(
    de.get_vigilance.summary,
    'Warnstufe orange in Gironde: Gewitter (orange), Sturm (gelb).',
  );
  assert.equal(es.storm_forecast.summary, 'Granizo previsto hoy a las 19:00.');
  assert.equal(
    es.get_hour_forecast.summary,
    'Mañana a las 08:00: parcialmente nublado, 8 °C (sensación de 6 °C), viento del suroeste a 14 km/h, rachas de hasta 40 km/h, 1,2 mm de lluvia.',
  );
  assert.equal(
    es.snow_forecast.summary,
    'Nieve prevista mañana a las 06:00 (probabilidad del 60 %). Cota de nieve a 800 m.',
  );
});

test('French and English sentences are unchanged by the two new languages', () => {
  const fr = { ...triggerSamples('fr'), ...actionSamples('fr') };
  const en = { ...triggerSamples('en'), ...actionSamples('en') };
  assert.equal(
    fr.wind_forecast.summary,
    "Vent fort annoncé : rafales à 85 km/h prévues aujourd'hui à 19:00.",
  );
  assert.equal(fr.get_rain_next_hour.summary, 'Pluie faible en cours, fin prévue dans 20 min.');
  assert.equal(
    en.snow_forecast.summary,
    'Snow expected tomorrow at 06:00 (60% chance). Rain-snow limit at 800 m.',
  );
  assert.equal(
    en.get_forecast.summary,
    'Tomorrow: rain, 14 to 21 °C, 4.2 mm of rain (80%), gusts up to 55 km/h.',
  );
});
