import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AVALANCHE_LEVELS,
  parseAvalancheBulletin,
  buildAvalancheOutputs,
  buildAvalancheEventData,
  detectAvalancheRise,
  readTriggerRisk,
  decodeEntities,
} from '../src/avalanche.js';
import { findMassif, findMassifByName, MASSIFS } from '../src/massifs.js';

// A real bulletin of Météo France (Mont-Blanc, 18 May 2026), trimmed.
const XML = readFileSync(new URL('./fixtures/avalanche-mont-blanc.xml', import.meta.url), 'utf8');
const MASSIF = { id: '03', name: 'Mont-Blanc' };

/**
 * @description The fixture with its danger attributes replaced.
 * @param {string} attributes - The attributes of the RISQUE element.
 * @returns {string} The XML.
 * @example
 * withDanger('RISQUE1="3" RISQUEMAXI="3"');
 */
function withDanger(attributes) {
  return XML.replace(/<RISQUE RISQUE1="[^/]*\/>/, `<RISQUE ${attributes}/>`);
}

test('reads the danger of a real bulletin, not the history of the past days', () => {
  const bulletin = parseAvalancheBulletin(XML);
  assert.equal(bulletin.available, true);
  assert.equal(bulletin.massifId, '03');
  assert.equal(bulletin.massif, 'Mont-Blanc');
  assert.equal(bulletin.issuedAt, '2026-05-17T16:00:00');
  assert.equal(bulletin.date, '2026-05-18');
  // The past days of the BSH block are at 3: the bulletin itself says 2.
  assert.equal(bulletin.risk, 2);
  assert.equal(bulletin.riskBelow, 1);
  assert.equal(bulletin.riskAbove, 2);
  assert.equal(bulletin.altitude, 2400);
  assert.equal(bulletin.nextDayRisk, 2);
  assert.equal(bulletin.nextDayDate, '2026-05-19');
  assert.equal(
    bulletin.comment,
    'Au-dessus de 2400m indice de risque limité, plus bas indice faible.',
  );
  assert.match(bulletin.details, /^Départs spontanés : Neige humide/);
  assert.match(bulletin.details, /\nDéclenchements skieurs : /);
});

test('takes each altitude band at its worst of the day', () => {
  const bulletin = parseAvalancheBulletin(
    withDanger(
      'RISQUE1="1" EVOLURISQUE1="2" LOC1="&lt;2200" ALTITUDE="2200" RISQUE2="2" EVOLURISQUE2="3" LOC2="&gt;2200" RISQUEMAXI="3" COMMENTAIRE="Risque limit&#233;"',
    ),
  );
  assert.equal(bulletin.risk, 3);
  assert.equal(bulletin.riskBelow, 2);
  assert.equal(bulletin.riskAbove, 3);
  assert.equal(bulletin.comment, 'Risque limité');
});

test('a bulletin without altitude split has no second level nor altitude', () => {
  const bulletin = parseAvalancheBulletin(
    withDanger(
      'RISQUE1="1" EVOLURISQUE1="" LOC1="" ALTITUDE="" RISQUE2="" EVOLURISQUE2="" LOC2="" RISQUEMAXI="1" COMMENTAIRE="Indice de risque faible." RISQUEMAXIJ2="1" DATE_RISQUE_J2="2026-05-19T00:00:00"',
    ),
  );
  assert.equal(bulletin.risk, 1);
  assert.equal(bulletin.riskAbove, null);
  assert.equal(bulletin.altitude, null);
  const outputs = buildAvalancheOutputs(bulletin, MASSIF, 'en');
  assert.equal(outputs.risk_above, undefined);
  assert.equal(outputs.altitude, undefined);
  assert.equal(outputs.summary, 'Mont-Blanc massif: low avalanche danger (1 of 5) for Monday 18.');
});

test('out of season and for Andorra, no bulletin but the message of Météo France', () => {
  const closed = parseAvalancheBulletin(
    JSON.stringify({ error_message: 'Dernier bulletin neige et avalanche de la saison.' }),
  );
  assert.deepEqual(closed, {
    available: false,
    message: 'Dernier bulletin neige et avalanche de la saison.',
  });
  const andorra = parseAvalancheBulletin(
    '<?xml version="1.0"?>\n<message><![CDATA[Consultez le service météorologique d\'Andorre.]]></message>',
  );
  assert.equal(andorra.available, false);
  assert.equal(andorra.message, "Consultez le service météorologique d'Andorre.");
  assert.deepEqual(parseAvalancheBulletin('garbage'), { available: false, message: '' });
  assert.deepEqual(parseAvalancheBulletin(undefined), { available: false, message: '' });
});

test('decodes named and numeric entities', () => {
  assert.equal(
    decodeEntities('&lt;2200 &amp; &#233;t&#xE9; &quot;x&quot; &unknown;'),
    '<2200 & été "x" &unknown;',
  );
});

test('the action outputs of a bulletin, in the four languages', () => {
  const bulletin = parseAvalancheBulletin(XML);
  const outputs = buildAvalancheOutputs(bulletin, MASSIF, 'fr');
  assert.deepEqual(outputs, {
    massif: 'Mont-Blanc',
    has_bulletin: true,
    risk: 2,
    risk_label: 'limité',
    summary:
      'Massif Mont-Blanc : risque d’avalanche limité (2 sur 5) pour lundi 18, 2 au-dessus de 2400 m et 1 en dessous.',
    date: '2026-05-18',
    risk_below: 1,
    risk_above: 2,
    altitude: 2400,
    risk_next_day: 2,
    comment: bulletin.comment,
    details: bulletin.details,
  });
  assert.equal(
    buildAvalancheOutputs(bulletin, MASSIF, 'en').summary,
    'Mont-Blanc massif: moderate avalanche danger (2 of 5) for Monday 18, 2 above 2400 m and 1 below.',
  );
  assert.equal(
    buildAvalancheOutputs(bulletin, MASSIF, 'de').summary,
    'Massiv Mont-Blanc: Lawinengefahr mäßig (Stufe 2 von 5) für Montag, 18. Mai, 2 oberhalb von 2400 m und 1 darunter.',
  );
  assert.equal(
    buildAvalancheOutputs(bulletin, MASSIF, 'es').summary,
    'Macizo Mont-Blanc: peligro de aludes limitado (2 de 5) para el lunes 18, 2 por encima de 2400 m y 1 por debajo.',
  );
});

test('the action without bulletin says so, with the message of Météo France', () => {
  const outputs = buildAvalancheOutputs(
    { available: false, message: 'Rendez-vous début novembre.' },
    MASSIF,
    'fr',
  );
  assert.deepEqual(outputs, {
    massif: 'Mont-Blanc',
    has_bulletin: false,
    summary:
      'Pas de bulletin d’avalanche pour le massif Mont-Blanc en ce moment (saison de novembre à mai).',
    comment: 'Rendez-vous début novembre.',
  });
  // Never a 0 that would read as "no danger".
  assert.equal('risk' in outputs, false);
});

test('fires each level the danger rises to, never on the first reading', () => {
  const levels = (previous, risk) => detectAvalancheRise(previous, risk).map(({ level }) => level);
  assert.deepEqual(levels(undefined, 4), []);
  assert.deepEqual(levels(1, 2), ['moderate']);
  assert.deepEqual(levels(2, 4), ['considerable', 'high']);
  assert.deepEqual(levels(3, 3), []);
  assert.deepEqual(levels(4, 2), []);
  assert.deepEqual(levels(0, 5), ['moderate', 'considerable', 'high', 'very_high']);
  assert.equal(readTriggerRisk({ available: false }), 0);
  assert.equal(readTriggerRisk(parseAvalancheBulletin(XML)), 2);
});

test('the levels of the trigger follow the European scale', () => {
  assert.deepEqual(
    AVALANCHE_LEVELS.map(({ level, threshold }) => [level, threshold]),
    [
      ['moderate', 2],
      ['considerable', 3],
      ['high', 4],
      ['very_high', 5],
    ],
  );
});

test('the event data of avalanche_risk', () => {
  const data = buildAvalancheEventData({
    level: AVALANCHE_LEVELS[0],
    bulletin: parseAvalancheBulletin(XML),
    massif: MASSIF,
    house: 'Chalet',
    previousRisk: 1,
    language: 'fr',
  });
  assert.deepEqual(data, {
    house: 'Chalet',
    massif: 'Mont-Blanc',
    level: 'moderate',
    risk: 2,
    risk_label: 'limité',
    previous_risk: 1,
    summary:
      'Massif Mont-Blanc : risque d’avalanche limité (2 sur 5) pour lundi 18, 2 au-dessus de 2400 m et 1 en dessous.',
    date: '2026-05-18',
  });
});

test('the 36 massifs of Météo France, numbered on two digits', () => {
  assert.equal(MASSIFS.length, 36);
  for (const massif of MASSIFS) {
    assert.match(massif.id, /^\d{2}$/);
    assert.ok(massif.rings.length > 0, massif.name);
  }
});

test('a house belongs to the massif around it, or to the nearest one close by', () => {
  // Chamonix, Val d'Isère, Luchon: inside.
  assert.deepEqual(findMassif(45.9237, 6.8694), { id: '03', name: 'Mont-Blanc' });
  assert.deepEqual(findMassif(45.448, 6.98), { id: '06', name: 'Haute-Tarentaise' });
  assert.deepEqual(findMassif(42.79, 0.593), { id: '68', name: 'Luchonnais' });
  // Annecy and Lourdes: a few kilometres outside.
  assert.deepEqual(findMassif(45.899, 6.129), { id: '02', name: 'Aravis' });
  assert.deepEqual(findMassif(43.095, -0.046), { id: '66', name: 'Haute-Bigorre' });
  // Paris and Ajaccio: none.
  assert.equal(findMassif(48.85, 2.35), null);
  assert.equal(findMassif(41.92, 8.74), null);
  assert.equal(findMassif(undefined, 6.87), null);
});

test('a massif by its number or its name, leniently', () => {
  assert.deepEqual(findMassifByName('3'), { id: '03', name: 'Mont-Blanc' });
  assert.deepEqual(findMassifByName('03'), { id: '03', name: 'Mont-Blanc' });
  assert.deepEqual(findMassifByName(' mont blanc '), { id: '03', name: 'Mont-Blanc' });
  assert.deepEqual(findMassifByName('Haute-Ariège'), { id: '70', name: 'Haute-Ariege' });
  assert.deepEqual(findMassifByName(74), { id: '74', name: 'Cerdagne Canigou' });
  assert.equal(findMassifByName('Jura'), null);
  assert.equal(findMassifByName(''), null);
  assert.equal(findMassifByName('99'), null);
});
