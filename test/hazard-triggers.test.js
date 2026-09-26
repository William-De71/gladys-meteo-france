import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UV_LEVELS,
  uvThresholds,
  isSnowy,
  detectUvLevels,
  detectForecastHazards,
  buildHazardEventData,
} from '../src/hazard-triggers.js';

// 2026-08-04T16:00:00Z, 18:00 in Paris.
const EVENING = 1785859200;
// 2026-08-05T08:00:00Z, 10:00 in Paris.
const MORNING = EVENING + 16 * 3600;
const TIMEZONE = 'Europe/Paris';
const CONTEXT = { timezone: TIMEZONE, nowSeconds: EVENING };

/**
 * @description A raw forecast of 30 hourly entries from the evening, dry and
 * mild except the ones given.
 * @param {object} [overrides] - Hour offset -> { temperature, rain, desc, snow }.
 * @param {number} [uvTomorrow] - UV index of 2026-08-05.
 * @returns {object} The raw payload.
 * @example
 * payload({ 3: { desc: 'Orages' } });
 */
function payload(overrides = {}, uvTomorrow = 3) {
  const forecast = [];
  for (let offset = 0; offset < 30; offset += 1) {
    const { temperature = 8, rain = 0, desc = 'Ciel clair', snow = 0 } = overrides[offset] || {};
    forecast.push({
      dt: EVENING + offset * 3600,
      T: { value: temperature },
      rain: { '1h': rain },
      snow: { '1h': snow },
      weather: { icon: 'p1j', desc },
      'rain snow limit': 'Non pertinent',
    });
  }
  return {
    forecast,
    daily_forecast: [
      { dt: 1785801600, uv: 5 }, // 2026-08-04
      { dt: 1785888000, uv: uvTomorrow }, // 2026-08-05
    ],
    probability_forecast: [{ dt: EVENING, snow: { '3h': 60, '6h': 60 } }],
  };
}

const keysOf = (events) => events.map((event) => `${event.trigger}:${event.level || ''}`);

test('detects snow by its sky or its amount', () => {
  assert.equal(isSnowy({ weather: { desc: 'Neige' } }), true);
  assert.equal(isSnowy({ weather: { desc: 'Ciel clair' }, snow: { '3h': 0.4 } }), true);
  assert.equal(isSnowy({ weather: { desc: 'Pluie' }, snow: { '1h': 0 } }), false);
});

test('fires nothing on the first poll, a baseline', () => {
  const states = new Map();
  const events = detectForecastHazards(
    states,
    payload({ 3: { desc: 'Orages' }, 10: { desc: 'Neige' } }, 9),
    CONTEXT,
  );
  assert.deepEqual(events, []);
});

test('fires snow and storm once when they enter the window, and re-arms', () => {
  const states = new Map();
  detectForecastHazards(states, payload(), CONTEXT);
  const storm = payload({ 3: { desc: 'Orages' }, 20: { desc: 'Neige' } });
  assert.deepEqual(keysOf(detectForecastHazards(states, storm, CONTEXT)), [
    'snow_forecast:',
    'storm_forecast:',
  ]);
  // Still there: nothing new.
  assert.deepEqual(detectForecastHazards(states, storm, CONTEXT), []);
  // Gone, then back: a new episode.
  detectForecastHazards(states, payload(), CONTEXT);
  assert.deepEqual(keysOf(detectForecastHazards(states, storm, CONTEXT)), [
    'snow_forecast:',
    'storm_forecast:',
  ]);
});

test('watches a storm over 12 hours only', () => {
  const states = new Map();
  detectForecastHazards(states, payload(), CONTEXT);
  assert.deepEqual(detectForecastHazards(states, payload({ 14: { desc: 'Orages' } }), CONTEXT), []);
});

test('fires each ice level once', () => {
  const states = new Map();
  detectForecastHazards(states, payload(), CONTEXT);
  const risk = payload({ 5: { rain: 1 }, 7: { temperature: 0.5 } });
  assert.deepEqual(keysOf(detectForecastHazards(states, risk, CONTEXT)), ['ice_forecast:risk']);
  const likely = payload({ 5: { rain: 1 }, 7: { temperature: 0.5 }, 9: { temperature: -2 } });
  const events = detectForecastHazards(states, likely, CONTEXT);
  assert.deepEqual(keysOf(events), ['ice_forecast:likely']);
  assert.equal(events[0].hour.dt, EVENING + 9 * 3600);
});

test('fires the UV of tomorrow once per threshold, after noon', () => {
  const states = new Map();
  detectUvLevels(states, payload({}, 3), TIMEZONE, EVENING);
  const events = detectUvLevels(states, payload({}, 7), TIMEZONE, EVENING);
  assert.deepEqual(
    events.map((event) => `${event.level}:${event.threshold}`),
    ['custom:4', 'custom:5', 'uv_6:6', 'custom:6', 'custom:7'],
  );
  assert.equal(events[0].date, '2026-08-05');
  // Same day, same index: nothing new; a higher one fires the rest only.
  assert.deepEqual(detectUvLevels(states, payload({}, 7), TIMEZONE, EVENING), []);
  assert.deepEqual(
    detectUvLevels(states, payload({}, 8), TIMEZONE, EVENING).map((event) => event.level),
    ['uv_8', 'custom'],
  );
});

test('reads the UV of today before noon', () => {
  const states = new Map();
  // 10:00 on 2026-08-05: the coming day is the 5th, already known.
  detectUvLevels(states, payload({}, 3), TIMEZONE, EVENING);
  const events = detectUvLevels(states, payload({}, 6), TIMEZONE, MORNING);
  assert.equal(events[0].date, '2026-08-05');
  assert.equal(events[0].today, true);
});

test('watches the whole UV ladder with its fixed levels on it', () => {
  const ladder = uvThresholds();
  assert.deepEqual(ladder, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  UV_LEVELS.levels.forEach(({ threshold }) => assert.ok(ladder.includes(threshold)));
});

test('builds the data of the hazard events', () => {
  const context = { timezone: TIMEZONE, units: 'metric', language: 'fr', nowSeconds: EVENING };
  const snow = buildHazardEventData(
    {
      trigger: 'snow_forecast',
      dt: EVENING + 12 * 3600,
      condition: 'snow',
      probability: 60,
      limit: 800,
    },
    'Maison',
    context,
  );
  assert.equal(
    snow.summary,
    'Neige annoncée demain à 06:00 (probabilité 60 %). Limite pluie-neige à 800 m.',
  );
  assert.equal(snow.hours_until, 12);
  const hail = buildHazardEventData(
    { trigger: 'storm_forecast', dt: EVENING + 3600, condition: 'hail' },
    'Maison',
    context,
  );
  assert.equal(hail.summary, "Grêle annoncée aujourd'hui à 19:00.");
  const uv = buildHazardEventData(
    {
      trigger: 'uv_forecast',
      level: 'uv_8',
      threshold: 8,
      uv: 8,
      date: '2026-08-05',
      today: false,
    },
    'Maison',
    context,
  );
  assert.equal(uv.summary, 'Indice UV de 8 (très élevé) prévu demain.');
  assert.equal(uv.threshold, 8);
  const ice = buildHazardEventData(
    {
      trigger: 'ice_forecast',
      level: 'likely',
      iceLevel: 2,
      hour: { dt: EVENING + 12 * 3600, temperature: -1.4, freezingRain: false, recentRain: 2.4 },
    },
    'Maison',
    context,
  );
  assert.equal(ice.level_label, 'Verglas probable');
  assert.equal(ice.summary, 'Verglas probable demain à 06:00 : -1 °C, après 2,4 mm de pluie.');
});
