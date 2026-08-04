import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseWeather, conditionFromDescription } from '../src/conditions.js';

test('maps a documented day icon code to its pivot condition', () => {
  assert.deepEqual(parseWeather({ icon: 'p1j', desc: 'Ensoleillé' }), {
    condition: 'clear',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p5j', desc: 'Très nuageux' }), {
    condition: 'cloud',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p13j', desc: 'Pluie et neige' }), {
    condition: 'sleet',
    isDay: true,
  });
});

test('keeps the meteorology at night and only flips is_day', () => {
  // The pivot deprecates the `night` condition: a rainy night stays rain.
  assert.deepEqual(parseWeather({ icon: 'p10n', desc: 'Pluie modérée' }), {
    condition: 'rain',
    isDay: false,
  });
  assert.deepEqual(parseWeather({ icon: 'p1n', desc: 'Ciel clair' }), {
    condition: 'clear',
    isDay: false,
  });
});

test('never looks up a bis code in the base table', () => {
  // p14 is "Neige" but p14bis is "Averses": resolving it through the base table
  // would report snow on a rainy day.
  assert.deepEqual(parseWeather({ icon: 'p14bisj', desc: 'Averses' }), {
    condition: 'rain',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p14j', desc: 'Neige' }), {
    condition: 'snow',
    isDay: true,
  });
});

test('falls back on the description for undocumented codes', () => {
  assert.deepEqual(parseWeather({ icon: 'p23j', desc: "Risque d'orages" }), {
    condition: 'thunderstorm',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p24n', desc: 'Brouillard dense' }), {
    condition: 'fog',
    isDay: false,
  });
});

test('checks the storm keyword before the generic rain keywords', () => {
  assert.equal(conditionFromDescription('Pluies orageuses'), 'thunderstorm');
});

test('returns unknown rather than guessing a clear sky', () => {
  assert.equal(conditionFromDescription('Phénomène inédit'), 'unknown');
  assert.deepEqual(parseWeather({ icon: 'nope', desc: 'Phénomène inédit' }), {
    condition: 'unknown',
    isDay: null,
  });
});

test('survives a missing weather object', () => {
  assert.deepEqual(parseWeather(undefined), { condition: 'unknown', isDay: null });
  assert.deepEqual(parseWeather({}), { condition: 'unknown', isDay: null });
});
