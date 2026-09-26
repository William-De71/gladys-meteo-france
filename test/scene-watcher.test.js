import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSceneWatcher, RAIN_COOLDOWN_MS } from '../src/scene-watcher.js';

const silentLogger = { info() {}, warn() {}, debug() {} };

const HOUSE = { id: 'h1', name: 'Maison', selector: 'maison', latitude: 48.85, longitude: 2.35 };

/**
 * @description Build a raw nowcast payload whose slots start at `nowMs`.
 * @param {Array<number>} levels - The MF rain levels.
 * @param {number} nowMs - The current time in ms.
 * @param {number} [available] - `rain_product_available`.
 * @returns {object} A raw nowcast payload.
 * @example
 * rainPayload([1, 2], Date.now());
 */
function rainPayload(levels, nowMs, available = 1) {
  const now = Math.floor(nowMs / 1000);
  return {
    position: { rain_product_available: available },
    forecast: levels.map((rain, index) => ({ dt: now + index * 300, rain })),
  };
}

/**
 * @description Build a raw forecast payload with one hour at a temperature.
 * @param {number} temperature - The temperature in °C.
 * @param {number} nowMs - The current time in ms.
 * @returns {object} A raw forecast payload.
 * @example
 * forecastPayload(-2, Date.now());
 */
function forecastPayload(temperature, nowMs) {
  const now = Math.floor(nowMs / 1000);
  return {
    position: { timezone: 'Europe/Paris' },
    forecast: [{ dt: now + 3600, T: { value: temperature }, wind: { gust: 10 } }],
  };
}

/**
 * @description Build a watcher over scripted upstream answers.
 * @param {object} script - { rain: Array, forecast: Array } of payload builders.
 * @returns {object} The watcher, the published events and the clock.
 * @example
 * buildWatcher({ rain: [[1], [2]] });
 */
function buildWatcher({ rain = [], forecast = [], houses = [HOUSE] } = {}) {
  const clock = { now: 1785866400000 };
  const published = [];
  const calls = { rain: 0, forecast: 0 };
  const watcher = createSceneWatcher({
    houses: { list: () => houses, refresh: async () => houses },
    fetchRain: async () => {
      const entry = rain[Math.min(calls.rain++, rain.length - 1)];
      if (entry instanceof Error) {
        throw entry;
      }
      return rainPayload(entry.levels, clock.now, entry.available);
    },
    fetchForecast: async () =>
      forecastPayload(forecast[Math.min(calls.forecast++, forecast.length - 1)], clock.now),
    publish: async (key, data) => published.push({ key, data }),
    getPreferences: () => ({ language: 'fr', units: 'metric' }),
    logger: silentLogger,
    now: () => clock.now,
  });
  return { watcher, published, clock, calls };
}

test('publishes rain_expected when the hour turns rainy, not on the baseline', async () => {
  const { watcher, published, clock } = buildWatcher({
    rain: [{ levels: [1, 1, 1] }, { levels: [1, 1, 3] }],
  });
  await watcher.pollRain();
  assert.equal(published.length, 0);
  clock.now += 5 * 60 * 1000;
  await watcher.pollRain();
  assert.equal(published.length, 1);
  assert.equal(published[0].key, 'rain_expected');
  assert.equal(published[0].data.house, 'Maison');
  assert.equal(published[0].data.intensity, 'moderate');
  assert.equal(published[0].data.minutes_until_rain, 10);
});

test('does not publish the same rain trigger twice within the cooldown', async () => {
  const { watcher, published, clock } = buildWatcher({
    rain: [{ levels: [1] }, { levels: [1, 2] }, { levels: [1] }, { levels: [1, 2] }],
  });
  for (let poll = 0; poll < 4; poll += 1) {
    await watcher.pollRain();
    clock.now += 5 * 60 * 1000;
  }
  assert.deepEqual(
    published.map((event) => event.key),
    ['rain_expected'],
  );
});

test('publishes a new shower once the cooldown is over', async () => {
  const { watcher, published, clock } = buildWatcher({
    rain: [{ levels: [1] }, { levels: [1, 2] }, { levels: [1] }, { levels: [1, 2] }],
  });
  await watcher.pollRain();
  await watcher.pollRain();
  await watcher.pollRain();
  clock.now += RAIN_COOLDOWN_MS;
  await watcher.pollRain();
  assert.deepEqual(
    published.map((event) => event.key),
    ['rain_expected', 'rain_expected'],
  );
});

test('keeps the previous nowcast across an upstream failure', async () => {
  const { watcher, published } = buildWatcher({
    rain: [{ levels: [1] }, new Error('timeout'), { levels: [2] }],
  });
  await watcher.pollRain();
  await watcher.pollRain();
  await watcher.pollRain();
  assert.deepEqual(
    published.map((event) => event.key),
    ['rain_expected'],
  );
});

test('stops asking for the nowcast of a house outside its coverage', async () => {
  const { watcher, calls } = buildWatcher({ rain: [{ levels: [], available: 0 }] });
  await watcher.pollRain();
  await watcher.pollRain();
  assert.equal(calls.rain, 1);
});

test('publishes a forecast level once reached, not on the baseline', async () => {
  const { watcher, published } = buildWatcher({ forecast: [5, -1, -1] });
  await watcher.pollForecast();
  await watcher.pollForecast();
  await watcher.pollForecast();
  assert.deepEqual(
    published.map((event) => `${event.key}:${event.data.level}:${event.data.threshold}`),
    [
      'frost_forecast:custom:4',
      'frost_forecast:custom:3',
      'frost_forecast:custom:2',
      'frost_forecast:custom:1',
      'frost_forecast:frost:0',
      'frost_forecast:custom:0',
      'frost_forecast:custom:-1',
    ],
  );
  assert.equal(published[0].data.temperature_min, -1);
});

test('keeps polling when the core refuses an event', async () => {
  let levels = [1];
  const watcher = createSceneWatcher({
    houses: { list: () => [HOUSE], refresh: async () => [HOUSE] },
    fetchRain: async () => rainPayload(levels, Date.now()),
    fetchForecast: async () => forecastPayload(5, Date.now()),
    publish: async () => {
      throw new Error('SCENE_TRIGGER_NOT_DECLARED');
    },
    getPreferences: () => ({ language: 'fr', units: 'metric' }),
    logger: silentLogger,
  });
  await watcher.pollRain();
  levels = [2];
  // The refused event neither throws out of the poll nor stops the watcher.
  assert.equal(await watcher.pollRain(), 1);
  levels = [1];
  assert.equal(await watcher.pollRain(), 1); // rain_stopped
});
