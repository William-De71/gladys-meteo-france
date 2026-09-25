import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readNowcast } from '../src/rain.js';

const NOW = 1790370900;

/**
 * @description Build a raw nowcast payload from a list of rain levels, one per
 * 5-minute slot starting now.
 * @param {Array<number>} levels - The MF rain levels (1 dry to 4 heavy).
 * @param {object} [position] - Fields of the position block.
 * @returns {object} A raw nowcast payload.
 * @example
 * buildNowcast([1, 1, 2]);
 */
function buildNowcast(levels, position = {}) {
  return {
    position: { dept: '75', timezone: 'Europe/Paris', rain_product_available: 1, ...position },
    forecast: levels.map((rain, index) => ({ dt: NOW + index * 300, rain, desc: '' })),
  };
}

test('reads a dry hour', () => {
  const nowcast = readNowcast(buildNowcast([1, 1, 1, 1]), NOW);
  assert.equal(nowcast.available, true);
  assert.equal(nowcast.raining, false);
  assert.equal(nowcast.rainExpected, false);
  assert.equal(nowcast.intensity, 'none');
  assert.equal(nowcast.minutesUntilRain, null);
});

test('reads rain arriving later in the hour, with its strongest intensity', () => {
  const nowcast = readNowcast(buildNowcast([1, 1, 1, 2, 3, 2]), NOW);
  assert.equal(nowcast.raining, false);
  assert.equal(nowcast.rainExpected, true);
  assert.equal(nowcast.minutesUntilRain, 15);
  assert.equal(nowcast.intensity, 'moderate');
  assert.equal(nowcast.minutesUntilDry, null);
});

test('reads the rain under way and when it stops', () => {
  const nowcast = readNowcast(buildNowcast([4, 3, 1, 1, 2]), NOW);
  assert.equal(nowcast.raining, true);
  assert.equal(nowcast.minutesUntilRain, 0);
  assert.equal(nowcast.minutesUntilDry, 10);
  assert.equal(nowcast.minutesUntilNextRain, 20);
  assert.equal(nowcast.intensity, 'heavy');
});

test('says unavailable, never dry, outside the nowcast coverage', () => {
  const nowcast = readNowcast(buildNowcast([], { rain_product_available: 0 }), NOW);
  assert.equal(nowcast.available, false);
  assert.equal(nowcast.rainExpected, false);
});

test('ignores slots it cannot read', () => {
  const data = buildNowcast([1, 2]);
  data.forecast.unshift({ dt: NOW - 300, rain: 9 }, null, { dt: 'x', rain: 2 });
  const nowcast = readNowcast(data, NOW);
  assert.equal(nowcast.raining, false);
  assert.equal(nowcast.minutesUntilRain, 5);
});
