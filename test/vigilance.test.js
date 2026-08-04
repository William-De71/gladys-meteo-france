import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAlerts,
  parseSummary,
  parseBulletin,
  buildDescription,
  departmentName,
  readMaxColor,
} from '../src/vigilance.js';
import { buildVigilanceFixture } from './helpers/fixtures.js';

test('maps the MF colors to the CAP severities', () => {
  const alerts = buildAlerts(buildVigilanceFixture(), '75');
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].severity, 'severe'); // orange
  assert.equal(alerts[1].severity, 'moderate'); // jaune
});

test('drops green phenomena, which are not alerts', () => {
  const alerts = buildAlerts(buildVigilanceFixture(), '75');
  // The fixture carries a green "Neige-verglas" that must not surface.
  assert.ok(alerts.every((alert) => !alert.event.includes('Neige')));
});

test('maps the MF phenomena to the pivot alert types', () => {
  const alerts = buildAlerts(buildVigilanceFixture(), '75');
  assert.equal(alerts[0].type, 'wind');
  assert.equal(alerts[1].type, 'thunderstorm');
});

test('folds the department name into the event, the pivot having no area field', () => {
  const alerts = buildAlerts(buildVigilanceFixture(), '75');
  assert.equal(alerts[0].event, 'Vent violent (Paris)');
});

test('keeps the raw department number when it is unknown', () => {
  assert.equal(departmentName('999'), '999');
  assert.equal(departmentName('2A'), 'Corse-du-Sud');
  assert.equal(departmentName('06'), 'Alpes-Maritimes');
});

test('leads the description with the short official summary', () => {
  const alerts = buildAlerts(buildVigilanceFixture(), '75');
  // A truncating channel (SMS) must still deliver a meaningful first line.
  assert.ok(alerts[0].description.startsWith('Épisode de vent violent en cours.'));
  assert.ok(alerts[0].description.includes('rafales de 100 km/h'));
});

test('does not repeat the summary when the bulletin is identical', () => {
  assert.equal(buildDescription('Same text.', 'Same text.'), 'Same text.');
  assert.equal(buildDescription('Summary.', ''), 'Summary.');
  assert.equal(buildDescription('', 'Bulletin.'), 'Bulletin.');
});

test('bounds the description to the pivot limit', () => {
  const long = 'a'.repeat(9000);
  assert.equal(buildDescription('', long).length, 5000);
});

test('carries the validity window as start and end', () => {
  const alerts = buildAlerts(buildVigilanceFixture(), '75');
  assert.ok(alerts[0].start);
  assert.ok(alerts[0].end);
});

test('names an undocumented phenomenon rather than dropping the alert', () => {
  const warning = buildVigilanceFixture({
    phenomenons_items: [{ phenomenon_id: '42', phenomenon_max_color_id: 4 }],
  });
  const alerts = buildAlerts(warning, '75');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'extreme');
  assert.ok(alerts[0].event.startsWith('Phénomène 42'));
  // An unmappable phenomenon carries no type: the core renders it from `event`.
  assert.equal(alerts[0].type, undefined);
});

test('walks the nested bulletin structure', () => {
  assert.equal(parseSummary(buildVigilanceFixture()), 'Épisode de vent violent en cours.');
  assert.ok(parseBulletin(buildVigilanceFixture()).includes('sud-ouest'));
  assert.equal(parseBulletin({}), '');
  assert.equal(parseSummary({}), '');
});

test('reads the max color, defaulting to green', () => {
  assert.equal(readMaxColor(buildVigilanceFixture()), 3);
  assert.equal(readMaxColor({}), 1);
  assert.equal(readMaxColor(null), 1);
});

test('returns no alert on an empty payload', () => {
  assert.deepEqual(buildAlerts({}, '75'), []);
  assert.deepEqual(buildAlerts({ phenomenons_items: 'nope' }, '75'), []);
});
