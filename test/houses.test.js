import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHouseRegistry } from '../src/houses.js';

const silentLogger = { info() {}, warn() {}, debug() {} };

const HOUSES = [
  { id: 'a', name: 'Chalet', selector: 'chalet', latitude: 45.9, longitude: 6.12 },
  { id: 'b', name: 'Résidence principale', selector: 'main', latitude: 48.85, longitude: 2.35 },
  { id: 'c', name: 'Garage', selector: 'garage', latitude: null, longitude: null },
];

test('keeps only the located houses', async () => {
  const houses = createHouseRegistry({ fetchHouses: async () => HOUSES, logger: silentLogger });
  await houses.refresh();
  assert.deepEqual(
    houses.list().map((house) => house.id),
    ['a', 'b'],
  );
});

test('resolves an empty field to the first located house', async () => {
  const houses = createHouseRegistry({ fetchHouses: async () => HOUSES, logger: silentLogger });
  await houses.refresh();
  assert.equal(houses.resolve('').id, 'a');
  assert.equal(houses.resolve(null).id, 'a');
});

test('resolves a house by name or selector, ignoring case and accents', async () => {
  const houses = createHouseRegistry({ fetchHouses: async () => HOUSES, logger: silentLogger });
  await houses.refresh();
  assert.equal(houses.resolve('residence PRINCIPALE').id, 'b');
  assert.equal(houses.resolve('main').id, 'b');
});

test('refuses an unknown house, and an instance with no located house', async () => {
  const houses = createHouseRegistry({ fetchHouses: async () => HOUSES, logger: silentLogger });
  assert.throws(() => houses.resolve(''), /No house of Gladys has a location/);
  await houses.refresh();
  assert.throws(() => houses.resolve('Garage'), /No located house named "Garage"/);
});

test('keeps the previous list when Gladys cannot be read', async () => {
  let fail = false;
  const houses = createHouseRegistry({
    fetchHouses: async () => {
      if (fail) {
        throw new Error('403');
      }
      return HOUSES;
    },
    logger: silentLogger,
  });
  await houses.refresh();
  fail = true;
  await houses.refresh();
  assert.equal(houses.list().length, 2);
});
