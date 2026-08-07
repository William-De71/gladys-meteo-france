import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createForecastCache } from '../src/forecast-cache.js';

const OPTIONS = { latitude: 48.8566, longitude: 2.3522, language: 'fr', units: 'metric' };
const VALUE = { weather: { temperature: 21 }, department: '75' };

test('misses on an empty cache', () => {
  const cache = createForecastCache();
  assert.equal(cache.get(OPTIONS), null);
  assert.equal(cache.size, 0);
});

test('serves a stored value while it is fresh', () => {
  const cache = createForecastCache();
  cache.set(OPTIONS, VALUE, 600, 1000);
  assert.deepEqual(cache.get(OPTIONS, 1000 + 599 * 1000), VALUE);
});

test('drops a value once it expired', () => {
  const cache = createForecastCache();
  cache.set(OPTIONS, VALUE, 600, 1000);
  // Exactly at the expiry: already stale.
  assert.equal(cache.get(OPTIONS, 1000 + 600 * 1000), null);
  // …and the expired entry is evicted rather than left to rot.
  assert.equal(cache.size, 0);
});

test('stores nothing when the cache is disabled', () => {
  const cache = createForecastCache();
  cache.set(OPTIONS, VALUE, 0, 1000);
  assert.equal(cache.get(OPTIONS, 1000), null);
  assert.equal(cache.size, 0);
});

test('separates the unit systems, the languages and the locations', () => {
  const cache = createForecastCache();
  cache.set(OPTIONS, VALUE, 600, 1000);

  // A `us` user must never be served the metric answer.
  assert.equal(cache.get({ ...OPTIONS, units: 'us' }, 1000), null);
  // The textual descriptions depend on the language.
  assert.equal(cache.get({ ...OPTIONS, language: 'en' }, 1000), null);
  // Another town, another forecast.
  assert.equal(cache.get({ ...OPTIONS, latitude: 43.7 }, 1000), null);
});

test('rounds the coordinates so the dashboard and the chat share one entry', () => {
  const cache = createForecastCache();
  cache.set(OPTIONS, VALUE, 600, 1000);
  // Same house, a different float tail below the 4-decimal precision (~11 m).
  assert.deepEqual(cache.get({ ...OPTIONS, latitude: 48.85660001 }, 1000), VALUE);
});

test('ignores unusable coordinates instead of caching them under a broken key', () => {
  const cache = createForecastCache();
  cache.set({ ...OPTIONS, latitude: NaN }, VALUE, 600, 1000);
  assert.equal(cache.size, 0);
  assert.equal(cache.get({ ...OPTIONS, latitude: NaN }, 1000), null);
});

test('clears everything, as the vigilance watcher and a config change ask', () => {
  const cache = createForecastCache();
  cache.set(OPTIONS, VALUE, 600, 1000);
  cache.set({ ...OPTIONS, units: 'us' }, VALUE, 600, 1000);
  assert.equal(cache.size, 2);

  cache.clear();

  assert.equal(cache.size, 0);
  assert.equal(cache.get(OPTIONS, 1000), null);
});
