import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FROST_LEVELS,
  dewPoint,
  frostPoint,
  classifyFrost,
  evaluateHour,
  evaluateFrostRisk,
} from '../src/frost.js';
import { buildFrostRiskOutputs } from '../src/scene-actions.js';

// 2026-08-04T16:00:00Z, 18:00 in Paris.
const EVENING = 1785859200;
// 2026-08-05T04:00:00Z, 06:00 in Paris.
const DAWN = EVENING + 12 * 3600;
const TIMEZONE = 'Europe/Paris';

/**
 * @description Build a raw MF hourly entry.
 * @param {number} dt - The moment, in seconds.
 * @param {number} temperature - The temperature, in °C.
 * @param {object} [overrides] - humidity, clouds, wind speed.
 * @returns {object} The entry.
 * @example
 * hour(DAWN, 0.5, { humidity: 95 });
 */
function hour(dt, temperature, { humidity = 95, clouds = 10, wind = 5 } = {}) {
  return { dt, T: { value: temperature }, humidity, clouds, wind: { speed: wind, gust: 0 } };
}

/**
 * @description A raw forecast of 30 hourly entries from the evening, mild
 * except the ones given.
 * @param {object} [cold] - Hour offset from EVENING -> entry overrides.
 * @returns {object} The raw payload.
 * @example
 * payload({ 12: { temperature: 0.5 } });
 */
function payload(cold = {}) {
  const forecast = [];
  for (let offset = 0; offset < 30; offset += 1) {
    const { temperature = 12, ...rest } = cold[offset] || {};
    forecast.push(hour(EVENING + offset * 3600, temperature, rest));
  }
  return { forecast };
}

const round2 = (value) => Math.round(value * 100) / 100;

test('computes the dew point and the frost point', () => {
  assert.equal(round2(dewPoint(1, 90)), -0.46);
  assert.equal(round2(dewPoint(5, 100)), 5);
  assert.equal(round2(frostPoint(dewPoint(1, 90), 1)), -0.57);
  assert.equal(round2(frostPoint(dewPoint(2, 70), 2)), -3.14);
});

test('classifies an hour with the frost rules', () => {
  assert.equal(classifyFrost(1, 0), FROST_LEVELS.LIKELY);
  assert.equal(classifyFrost(0, -2), FROST_LEVELS.LIKELY);
  assert.equal(classifyFrost(1.5, -0.5), FROST_LEVELS.RISK);
  assert.equal(classifyFrost(3, 0), FROST_LEVELS.RISK);
  assert.equal(classifyFrost(3.5, -1), FROST_LEVELS.NONE);
  assert.equal(classifyFrost(2, 0.5), FROST_LEVELS.NONE);
});

test('lowers the level by one under an overcast sky or a steady wind', () => {
  const clear = evaluateHour(hour(DAWN, 0.5));
  assert.equal(clear.level, FROST_LEVELS.LIKELY);
  assert.equal(clear.reduced, false);
  const overcast = evaluateHour(hour(DAWN, 0.5, { clouds: 90 }));
  assert.equal(overcast.level, FROST_LEVELS.RISK);
  assert.deepEqual([overcast.reduced, overcast.overcast, overcast.windy], [true, true, false]);
  const both = evaluateHour(hour(DAWN, 0.5, { clouds: 90, wind: 25 }));
  // One step down, not two.
  assert.equal(both.level, FROST_LEVELS.RISK);
  assert.deepEqual([both.overcast, both.windy], [true, true]);
  // Nothing to lower on a mild hour.
  assert.equal(evaluateHour(hour(DAWN, 12, { clouds: 90 })).reduced, false);
});

test('skips an hour without temperature or humidity', () => {
  assert.equal(evaluateHour({ dt: DAWN, T: {}, humidity: 90 }), null);
  assert.equal(evaluateHour({ dt: DAWN, T: { value: 1 } }), null);
});

test('reads tomorrow morning in the evening, until 10:00 excluded', () => {
  // 12 h after 18:00 is 06:00; 16 h is 10:00, past the morning.
  const data = payload({ 12: { temperature: 2.5, humidity: 70 }, 16: { temperature: -3 } });
  const { date, today, worst } = evaluateFrostRisk(data, TIMEZONE, EVENING);
  assert.equal(date, '2026-08-05');
  assert.equal(today, false);
  assert.equal(worst.dt, DAWN);
  assert.equal(worst.level, FROST_LEVELS.RISK);
});

test('reads this morning before 10:00', () => {
  const data = payload({ 13: { temperature: 0 }, 15: { temperature: 3 } });
  const { date, today, worst } = evaluateFrostRisk(data, TIMEZONE, DAWN);
  assert.equal(date, '2026-08-05');
  assert.equal(today, true);
  assert.equal(worst.dt, DAWN + 3600);
});

test('keeps the worst level, then the coldest hour', () => {
  const data = payload({
    10: { temperature: -1, clouds: 95 }, // likely, lowered to risk
    11: { temperature: 0.8 }, // likely
    13: { temperature: 0.2 }, // likely, colder
  });
  const { worst } = evaluateFrostRisk(data, TIMEZONE, EVENING);
  assert.equal(worst.level, FROST_LEVELS.LIKELY);
  assert.equal(worst.dt, EVENING + 13 * 3600);
});

test('fails when the forecast does not reach the morning', () => {
  assert.throws(() => evaluateFrostRisk({ forecast: [] }, TIMEZONE, EVENING), /no hourly forecast/);
});

test('gives the frost risk outputs, with a summary', () => {
  const data = payload({ 12: { temperature: 0.4, humidity: 95 } });
  const outputs = buildFrostRiskOutputs({
    data,
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    nowSeconds: EVENING,
  });
  assert.equal(outputs.level, 2);
  assert.equal(outputs.level_label, 'Givre probable');
  assert.equal(outputs.date, '2026-08-05');
  assert.equal(outputs.time, '06:00');
  assert.equal(outputs.temperature, 0.4);
  assert.equal(outputs.humidity, 95);
  assert.equal(outputs.cloud_cover, 10);
  assert.equal(outputs.wind_speed, 5);
  assert.equal(outputs.reduced, false);
  assert.equal(
    outputs.summary,
    `Givre probable demain matin : 0,4 °C vers 06:00, point de givre ${outputs.frost_point.toLocaleString('fr-FR')} °C.`,
  );
});

test('says why the risk was lowered, and converts to the US units', () => {
  const data = payload({ 12: { temperature: 0.4, clouds: 90, wind: 30 } });
  const outputs = buildFrostRiskOutputs({
    data,
    timezone: TIMEZONE,
    units: 'us',
    language: 'en',
    nowSeconds: EVENING,
  });
  assert.equal(outputs.level, 1);
  assert.equal(outputs.reduced, true);
  assert.equal(outputs.temperature, 32.7);
  assert.match(outputs.summary, /^Frost risk tomorrow morning: 32\.7 °F around 06:00/);
  assert.match(outputs.summary, /Risk lowered by the overcast sky and the wind\.$/);
});

test('says no frost with the low of the morning', () => {
  const outputs = buildFrostRiskOutputs({
    data: payload({ 11: { temperature: 7.5 } }),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    nowSeconds: EVENING,
  });
  assert.equal(outputs.level, 0);
  assert.equal(outputs.summary, 'Pas de givre attendu demain matin : minimum 7,5 °C vers 05:00.');
});
