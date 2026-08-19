import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseWeather, conditionFromDescription } from '../src/conditions.js';

test('maps a documented day icon code to its pivot condition', () => {
  assert.deepEqual(parseWeather({ icon: 'p1j', desc: 'Ensoleillé' }), {
    condition: 'clear',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p13j', desc: 'Pluie et neige' }), {
    condition: 'sleet',
    isDay: true,
  });
});

test('trusts the description over a code table the API contradicts', () => {
  // Real Besançon payload: MF answers p14j/"Pluie" on a 22.6 °C day, and the
  // published legend maps code 14 to snow. Reporting a snowflake there was the
  // bug this rule fixes.
  assert.deepEqual(parseWeather({ icon: 'p14j', desc: 'Pluie' }), {
    condition: 'rain',
    isDay: true,
  });
  // Same disagreement on code 12, which the legend maps to thunderstorm.
  assert.deepEqual(parseWeather({ icon: 'p12j', desc: 'Pluie faible' }), {
    condition: 'rain',
    isDay: true,
  });
  // p29 appears in no documentation at all: the description carries it alone.
  assert.deepEqual(parseWeather({ icon: 'p29n', desc: 'Orages' }), {
    condition: 'thunderstorm',
    isDay: false,
  });
});

test('falls back on the code table when the description says nothing', () => {
  assert.deepEqual(parseWeather({ icon: 'p5j', desc: 'Phénomène inédit' }), {
    condition: 'cloud',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p5j' }), { condition: 'cloud', isDay: true });
  // Neither signal is usable: never invent a condition.
  assert.deepEqual(parseWeather({ icon: 'p23j', desc: 'Phénomène inédit' }), {
    condition: 'unknown',
    isDay: true,
  });
});

test('reads a composite phenomenon as sleet, not snow', () => {
  // 'neige' alone would swallow these: the composite keywords come first.
  assert.equal(conditionFromDescription('Pluie et neige'), 'sleet');
  assert.equal(conditionFromDescription('Averses de pluie et neige'), 'sleet');
  assert.equal(conditionFromDescription('Pluie et neige mêlées'), 'sleet');
  // A genuine snow description is untouched by that rule.
  assert.equal(conditionFromDescription('Averses de neige'), 'snow');
});

test('matches the unaccented spellings the API actually sends', () => {
  // MF returns "Eclaircies" without its accent; both spellings must land on
  // partly-cloudy — broken clouds are not a clear sky.
  assert.equal(conditionFromDescription('Eclaircies'), 'partly-cloudy');
  assert.equal(conditionFromDescription('Éclaircies'), 'partly-cloudy');
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
  // p14bis is "Averses" while its base code is "Neige": a bis code must never
  // reach the table, even for a description no keyword matches.
  assert.deepEqual(parseWeather({ icon: 'p14bisj', desc: 'Averses' }), {
    condition: 'rain',
    isDay: true,
  });
  // A `bis` code whose wording matches nothing now degrades to the family of
  // its base code instead of to 'unknown': the dashboard paints 'unknown' as a
  // red thermometer labelled "Indisponible", which is worse than a rough sky.
  assert.deepEqual(parseWeather({ icon: 'p14bisj', desc: 'Phénomène inédit' }), {
    condition: 'snow',
    isDay: true,
  });
  // The base code still reports snow when the description agrees.
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

test('reads the "Variable" sky the p2bis code answers', () => {
  // The red-thermometer bug reported on the forum: MF answers p2bis/"Variable"
  // on an ordinary mixed sky, no keyword matched it, and 'unknown' rendered as
  // a thermometer labelled "Indisponible" on the dashboard.
  assert.deepEqual(parseWeather({ icon: 'p2bisj', desc: 'Variable' }), {
    condition: 'partly-cloudy',
    isDay: true,
  });
  assert.deepEqual(parseWeather({ icon: 'p2bisn', desc: 'Variable' }), {
    condition: 'partly-cloudy',
    isDay: false,
  });
});

test('reads the English labels the API returns despite lang=fr', () => {
  // Observed mid-payload on real locations, next to French entries.
  assert.equal(conditionFromDescription('Cloudy'), 'cloud');
  assert.equal(conditionFromDescription('Clear sky'), 'clear');
  assert.equal(conditionFromDescription('Storms'), 'thunderstorm');
  assert.equal(conditionFromDescription('Slight showers'), 'rain');
  assert.equal(conditionFromDescription('Overcast'), 'cloud');
  assert.equal(conditionFromDescription('Light snow'), 'snow');
});

test('reports hail rather than a plain thunderstorm when both are named', () => {
  // p25bis arrives as "Orage avec grêle": the pivot has a hail condition, and
  // the keyword order must prefer it over the 'orage' that follows.
  assert.deepEqual(parseWeather({ icon: 'p25bisj', desc: 'Orage avec grêle' }), {
    condition: 'hail',
    isDay: true,
  });
});

test('separates a covered sky from a merely broken one', () => {
  // MF renders "Nuageux" and "Très nuageux" as a full cloud, so reporting
  // partly-cloudy put a sun on a covered sky. Only the skies MF itself draws
  // with a sun behind the cloud stay partly-cloudy.
  assert.equal(conditionFromDescription('Très nuageux'), 'cloud');
  assert.equal(conditionFromDescription('Nuageux'), 'cloud');
  assert.equal(conditionFromDescription('Couvert'), 'cloud');
  // "Peu nuageux" is mostly clear: the bare 'nuageux' above must not catch it.
  assert.equal(conditionFromDescription('Peu nuageux'), 'partly-cloudy');
  assert.equal(conditionFromDescription('Eclaircies'), 'partly-cloudy');
  // No pivot condition for a veiled sky: partly-cloudy is the closest family.
  assert.equal(conditionFromDescription('Ciel voilé'), 'partly-cloudy');
});
