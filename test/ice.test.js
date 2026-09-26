import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ICE_LEVELS,
  readRainAmount,
  classifyIce,
  evaluateIceHours,
  pickIceHour,
  readFreezingProbability,
} from '../src/ice.js';
import { buildIceRiskOutputs } from '../src/scene-actions.js';

// 2026-08-04T16:00:00Z, 18:00 in Paris.
const EVENING = 1785859200;
const TIMEZONE = 'Europe/Paris';

/**
 * @description A raw forecast of 30 hourly entries from 6 hours before the
 * evening, dry and mild except the ones given.
 * @param {object} [overrides] - Hour offset from EVENING -> { temperature, rain, desc }.
 * @returns {object} The raw payload.
 * @example
 * payload({ 12: { temperature: -1 } });
 */
function payload(overrides = {}) {
  const forecast = [];
  for (let offset = -6; offset < 24; offset += 1) {
    const { temperature = 8, rain = 0, desc = 'Ciel clair' } = overrides[offset] || {};
    forecast.push({
      dt: EVENING + offset * 3600,
      T: { value: temperature },
      rain: { '1h': rain },
      weather: { icon: 'p1n', desc },
    });
  }
  return { forecast, probability_forecast: [{ dt: EVENING + 9 * 3600, freezing: 40 }] };
}

test('reads the rain amount whatever its step', () => {
  assert.equal(readRainAmount({ rain: { '1h': 1.2 } }), 1.2);
  assert.equal(readRainAmount({ rain: { '3h': 2 } }), 2);
  assert.equal(readRainAmount({ rain: { '6h': 3 } }), 3);
  assert.equal(readRainAmount({}), 0);
});

test('classifies an hour with the ice rules', () => {
  const hour = (overrides) => ({
    temperature: 5,
    freezingRain: false,
    raining: false,
    wet: false,
    ...overrides,
  });
  assert.equal(classifyIce(hour({ freezingRain: true })), ICE_LEVELS.LIKELY);
  assert.equal(classifyIce(hour({ raining: true, wet: true, temperature: 0 })), ICE_LEVELS.LIKELY);
  assert.equal(classifyIce(hour({ wet: true, temperature: -1 })), ICE_LEVELS.LIKELY);
  assert.equal(classifyIce(hour({ wet: true, temperature: 0.5 })), ICE_LEVELS.RISK);
  assert.equal(classifyIce(hour({ wet: true, temperature: 1.5 })), ICE_LEVELS.NONE);
  // Cold but dry: frost maybe, not black ice.
  assert.equal(classifyIce(hour({ temperature: -5 })), ICE_LEVELS.NONE);
});

test('keeps a surface wet for 6 hours after the rain, past hours included', () => {
  // Rain 2 hours before the evening, then a freeze at 03:00 (offset 9).
  const data = payload({ '-2': { rain: 1.5 }, 3: { temperature: 0.5 }, 9: { temperature: -2 } });
  const hours = evaluateIceHours(data.forecast, (dt) => dt >= EVENING);
  const at = (offset) => hours.find((hour) => hour.dt === EVENING + offset * 3600);
  assert.equal(at(3).wet, true);
  assert.equal(at(3).recentRain, 1.5);
  assert.equal(at(3).level, ICE_LEVELS.RISK);
  // 11 hours after the rain: dry again.
  assert.equal(at(9).wet, false);
  assert.equal(at(9).level, ICE_LEVELS.NONE);
});

test('picks the hour the ice sets in, or the coldest hour', () => {
  const data = payload({ 5: { rain: 0.4 }, 7: { temperature: -1.5 }, 8: { temperature: -3 } });
  const hours = evaluateIceHours(data.forecast, (dt) => dt >= EVENING);
  assert.equal(pickIceHour(hours).dt, EVENING + 7 * 3600);
  const dry = evaluateIceHours(payload({ 10: { temperature: 2 } }).forecast, () => true);
  assert.equal(pickIceHour(dry).temperature, 2);
  assert.equal(pickIceHour([]), null);
});

test('reads the freezing probability of the window', () => {
  const data = payload();
  assert.equal(
    readFreezingProbability(data.probability_forecast, () => true),
    40,
  );
  assert.equal(
    readFreezingProbability(data.probability_forecast, () => false),
    null,
  );
});

test('gives the ice risk outputs of tomorrow morning, with a summary', () => {
  const data = payload({ 10: { rain: 2.4, temperature: 1 }, 12: { temperature: -1.5 } });
  const outputs = buildIceRiskOutputs({
    data,
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    nowSeconds: EVENING,
  });
  assert.equal(outputs.level, 2);
  assert.equal(outputs.level_label, 'Verglas probable');
  assert.equal(outputs.date, '2026-08-05');
  assert.equal(outputs.time, '06:00');
  assert.equal(outputs.temperature, -1.5);
  assert.equal(outputs.recent_rain, 2.4);
  assert.equal(outputs.freezing_probability, 40);
  assert.equal(
    outputs.summary,
    'Verglas probable demain matin vers 06:00 : -1,5 °C, après 2,4 mm de pluie.',
  );
});

test('says freezing rain, and no ice when dry', () => {
  const freezing = buildIceRiskOutputs({
    data: payload({ 11: { temperature: 0.5, desc: 'Pluie verglaçante', rain: 0.5 } }),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'en',
    nowSeconds: EVENING,
  });
  assert.equal(freezing.freezing_rain, true);
  assert.match(freezing.summary, /freezing rain forecast\.$/);
  const dry = buildIceRiskOutputs({
    data: payload({ 11: { temperature: -4 } }),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    nowSeconds: EVENING,
  });
  assert.equal(dry.level, 0);
  assert.equal(dry.summary, 'Pas de verglas attendu demain matin : minimum -4 °C vers 05:00.');
});
