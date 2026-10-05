import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectRainTriggers,
  buildRainEventData,
  readForecastExtremes,
  evaluateForecastLevels,
  buildForecastEventData,
  forecastThresholds,
  CUSTOM_LEVEL,
  FORECAST_LEVELS,
} from '../src/scene-triggers.js';

// 2026-08-04T18:00:00Z, 20:00 in Paris.
const NOW = 1785866400;

/**
 * @description Build a readNowcast() summary.
 * @param {object} [overrides] - Fields to override.
 * @returns {object} The summary.
 * @example
 * nowcast({ rainExpected: true });
 */
function nowcast(overrides = {}) {
  return {
    available: true,
    raining: false,
    rainExpected: false,
    level: 1,
    intensity: 'none',
    minutesUntilRain: null,
    minutesUntilDry: null,
    minutesUntilNextRain: null,
    ...overrides,
  };
}

const RAIN_SOON = nowcast({
  rainExpected: true,
  level: 3,
  intensity: 'moderate',
  minutesUntilRain: 20,
  minutesUntilNextRain: 20,
});
const RAINING = nowcast({ raining: true, rainExpected: true, level: 2, intensity: 'light' });

/**
 * @description Build extremes as readForecastExtremes() returns them: tonight
 * (06:00 tomorrow) for the frost, tomorrow afternoon for the heat.
 * @param {number} min - Lowest temperature.
 * @param {number} max - Highest temperature.
 * @param {number} gust - Strongest gust.
 * @returns {object} The extremes.
 * @example
 * extremes(5, 20, 30);
 */
function extremes(min, max, gust) {
  return {
    temperature_min: [{ day: '2026-08-04', value: min, dt: NOW + 10 * 3600 }],
    temperature_max: [{ day: '2026-08-05', value: max, dt: NOW + 20 * 3600 }],
    wind_gust: { value: gust, dt: NOW + 3600 },
  };
}

/**
 * @description Build extremes carrying only a heat figure.
 * @param {string} day - The local day.
 * @param {number} max - Highest temperature of that day.
 * @returns {object} The extremes.
 * @example
 * heatOn('2026-08-05', 25);
 */
function heatOn(day, max) {
  return {
    temperature_min: [],
    temperature_max: [{ day, value: max, dt: NOW + 20 * 3600 }],
    wind_gust: null,
  };
}

/**
 * @description "trigger:level:threshold" of each event.
 * @param {Array<object>} events - evaluateForecastLevels() events.
 * @returns {Array<string>} The labels.
 * @example
 * labels(fired); // -> ['heat_forecast:custom:20']
 */
function labels(events) {
  return events.map((event) => `${event.trigger}:${event.level}:${event.threshold}`);
}

test('fires nothing on the first nowcast, which is a baseline', () => {
  assert.deepEqual(detectRainTriggers(null, RAIN_SOON), []);
});

test('fires rain_expected when a dry hour turns rainy', () => {
  assert.deepEqual(detectRainTriggers(nowcast(), RAIN_SOON), ['rain_expected']);
});

test('does not fire rain_expected again while the rain is still announced', () => {
  assert.deepEqual(detectRainTriggers(RAIN_SOON, RAINING), []);
});

test('fires rain_stopped when the rain under way stops', () => {
  assert.deepEqual(detectRainTriggers(RAINING, nowcast()), ['rain_stopped']);
});

test('fires nothing across an unavailable nowcast', () => {
  assert.deepEqual(detectRainTriggers(nowcast(), nowcast({ available: false })), []);
});

test('builds the data of rain_expected', () => {
  const data = buildRainEventData('rain_expected', 'Maison', RAIN_SOON, 'fr');
  assert.deepEqual(data, {
    house: 'Maison',
    intensity: 'moderate',
    intensity_label: 'Pluie modérée',
    minutes_until_rain: 20,
    summary: 'Pluie modérée prévue dans 20 min.',
  });
});

test('builds the data of rain_stopped, saying whether more is coming', () => {
  const dry = buildRainEventData('rain_stopped', 'Maison', nowcast(), 'fr');
  assert.equal(dry.dry_for_hour, true);
  assert.equal(dry.minutes_until_next_rain, null);
  const more = buildRainEventData('rain_stopped', 'Maison', RAIN_SOON, 'en');
  assert.equal(more.dry_for_hour, false);
  assert.equal(more.summary, 'The rain has stopped, more expected in 20 min.');
});

test('reads the extremes of the next 24 hours only, the temperatures by day', () => {
  const data = {
    forecast: [
      { dt: NOW - 7200, T: { value: -10 }, wind: { gust: 40 } }, // past
      { dt: NOW + 18 * 3600, T: { value: 24 }, wind: { gust: 12 } }, // 14:00 tomorrow
      { dt: NOW, T: { value: 12 }, wind: { gust: 5 } }, // 20:00 today
      { dt: NOW + 6 * 3600, T: { value: -1.5 }, wind: { gust: 0 } }, // 02:00 tomorrow
      { dt: NOW + 30 * 3600, T: { value: 40 }, wind: { gust: 33 } }, // too far
      { dt: NOW + 3600, T: {} },
    ],
  };
  const result = readForecastExtremes(data, NOW, 'Europe/Paris');
  // A night of frost runs from noon to noon: 20:00 and 02:00 are tonight.
  assert.deepEqual(result.temperature_min, [
    { day: '2026-08-04', value: -1.5, dt: NOW + 6 * 3600 },
    { day: '2026-08-05', value: 24, dt: NOW + 18 * 3600 },
  ]);
  // A day of heat runs from midnight to midnight: 02:00 is tomorrow.
  assert.deepEqual(result.temperature_max, [
    { day: '2026-08-04', value: 12, dt: NOW },
    { day: '2026-08-05', value: 24, dt: NOW + 18 * 3600 },
  ]);
  // MF gives the gusts in m/s, the thresholds are in km/h: 12 m/s is 43.2 km/h.
  assert.equal(Math.round(result.wind_gust.value * 10) / 10, 43.2);
  assert.equal(result.wind_gust.dt, NOW + 18 * 3600);
});

test('fires no forecast level on the first run, which is a baseline', () => {
  const states = new Map();
  assert.deepEqual(evaluateForecastLevels(states, extremes(-6, 36, 110)), []);
});

test('fires each fixed level once when the forecast reaches it', () => {
  const states = new Map();
  evaluateForecastLevels(states, extremes(5, 20, 30));
  const fired = evaluateForecastLevels(states, extremes(-6, 20, 85));
  assert.deepEqual(
    fired
      .filter((event) => event.level !== CUSTOM_LEVEL)
      .map((event) => `${event.trigger}:${event.level}:${event.threshold}`),
    [
      'frost_forecast:frost:0',
      'frost_forecast:hard_frost:-5',
      'wind_forecast:gust_60:60',
      'wind_forecast:gust_80:80',
    ],
  );
  // Still reached on the next run: nothing new.
  assert.deepEqual(evaluateForecastLevels(states, extremes(-4, 20, 70)), []);
});

test('fires a custom event for every threshold crossed, mildest first', () => {
  const states = new Map();
  evaluateForecastLevels(states, extremes(5, 20, 30));
  const fired = evaluateForecastLevels(states, extremes(-2.5, 20, 52));
  const custom = (trigger) =>
    fired
      .filter((event) => event.trigger === trigger && event.level === CUSTOM_LEVEL)
      .map((event) => event.threshold);
  // -2.5 °C reaches -2 but not -3; 52 km/h reaches 50 but not 55.
  assert.deepEqual(custom('frost_forecast'), [4, 3, 2, 1, 0, -1, -2]);
  assert.deepEqual(custom('wind_forecast'), [35, 40, 45, 50]);
  // The fixed level comes right before the custom event of its threshold.
  const zero = fired.filter((event) => event.threshold === 0).map((event) => event.level);
  assert.deepEqual(zero, ['frost', CUSTOM_LEVEL]);
  fired.forEach((event) =>
    assert.equal(event.dt, NOW + (event.trigger === 'wind_forecast' ? 3600 : 36000)),
  );
});

test('watches every degree and every 5 km/h, the fixed levels on the ladder', () => {
  Object.values(FORECAST_LEVELS).forEach((config) => {
    const ladder = forecastThresholds(config);
    const { min, max, step } = config.thresholds;
    assert.equal(ladder.length, (max - min) / step + 1);
    assert.deepEqual(ladder[0], config.below ? max : min);
    config.levels.forEach(({ threshold }) => assert.ok(ladder.includes(threshold)));
  });
  assert.equal(FORECAST_LEVELS.wind_forecast.thresholds.step, 5);
});

test('re-arms a wind threshold only once the forecast is clear of it by the margin', () => {
  const states = new Map();
  const gustAt60 = (fired) =>
    fired.filter((event) => event.trigger === 'wind_forecast' && event.threshold === 60).length;
  evaluateForecastLevels(states, extremes(5, 20, 30));
  assert.equal(gustAt60(evaluateForecastLevels(states, extremes(5, 20, 61))), 2);
  // Hovering around 60 km/h: not clear by 15 km/h, so no second event.
  evaluateForecastLevels(states, extremes(5, 20, 50));
  assert.equal(gustAt60(evaluateForecastLevels(states, extremes(5, 20, 62))), 0);
  // Back well below 60 km/h, then strong gusts again: a new episode.
  evaluateForecastLevels(states, extremes(5, 20, 40));
  assert.equal(gustAt60(evaluateForecastLevels(states, extremes(5, 20, 61))), 2);
});

test('fires a heat threshold already reached at the baseline on the next day', () => {
  const states = new Map();
  evaluateForecastLevels(states, heatOn('2026-08-05', 25));
  assert.deepEqual(evaluateForecastLevels(states, heatOn('2026-08-05', 25)), []);
  // Still above 20 °C the next day: a new day, so it fires again.
  assert.deepEqual(labels(evaluateForecastLevels(states, heatOn('2026-08-06', 22))), [
    'heat_forecast:custom:20',
    'heat_forecast:custom:21',
    'heat_forecast:custom:22',
  ]);
  // The past day is forgotten.
  assert.ok([...states.keys()].every((key) => !key.includes('2026-08-05')));
});

test('fires a daily threshold once a day, even on a hesitating forecast', () => {
  const states = new Map();
  evaluateForecastLevels(states, heatOn('2026-08-05', 29));
  assert.deepEqual(labels(evaluateForecastLevels(states, heatOn('2026-08-05', 30.4))), [
    'heat_forecast:heat_30:30',
    'heat_forecast:custom:30',
  ]);
  assert.deepEqual(evaluateForecastLevels(states, heatOn('2026-08-05', 29)), []);
  assert.deepEqual(evaluateForecastLevels(states, heatOn('2026-08-05', 30.2)), []);
  // A hotter revision only fires the thresholds it newly reaches.
  assert.deepEqual(labels(evaluateForecastLevels(states, heatOn('2026-08-05', 31))), [
    'heat_forecast:custom:31',
  ]);
});

test('builds the data of a frost event in the unit system of the instance', () => {
  const event = {
    trigger: 'frost_forecast',
    level: 'frost',
    threshold: 0,
    value: -2.4,
    dt: NOW + 10 * 3600,
  };
  const context = { timezone: 'Europe/Paris', units: 'metric', language: 'fr', nowSeconds: NOW };
  assert.deepEqual(buildForecastEventData(event, 'Maison', context), {
    house: 'Maison',
    level: 'frost',
    threshold: 0,
    time: '06:00',
    hours_until: 10,
    temperature_min: -2,
    summary: 'Gel annoncé : -2 °C prévus demain à 06:00.',
  });
  const us = buildForecastEventData(event, 'Maison', { ...context, units: 'us', language: 'en' });
  assert.equal(us.temperature_min, 28);
  assert.equal(us.summary, 'Frost forecast: 28 °F expected tomorrow at 06:00.');
});

test('builds the data of heat and wind events', () => {
  const context = { timezone: 'Europe/Paris', units: 'metric', language: 'fr', nowSeconds: NOW };
  const heat = buildForecastEventData(
    { trigger: 'heat_forecast', level: 'heat_35', threshold: 35, value: 36.2, dt: NOW + 3600 },
    'Maison',
    context,
  );
  assert.equal(heat.temperature_max, 36);
  assert.equal(heat.summary, "Forte chaleur annoncée : 36 °C prévus aujourd'hui à 21:00.");
  const wind = buildForecastEventData(
    { trigger: 'wind_forecast', level: 'gust_80', threshold: 80, value: 85, dt: NOW + 3600 },
    'Maison',
    context,
  );
  assert.equal(wind.wind_gust, 85);
  assert.equal(wind.summary, "Vent fort annoncé : rafales à 85 km/h prévues aujourd'hui à 21:00.");
});

test('builds the data of a custom threshold event', () => {
  const context = { timezone: 'Europe/Paris', units: 'metric', language: 'fr', nowSeconds: NOW };
  const mild = buildForecastEventData(
    {
      trigger: 'frost_forecast',
      level: CUSTOM_LEVEL,
      threshold: -3,
      value: -3.2,
      dt: NOW + 10 * 3600,
    },
    'Maison',
    context,
  );
  assert.equal(mild.level, 'custom');
  assert.equal(mild.threshold, -3);
  assert.equal(mild.summary, 'Gel annoncé : -3 °C prévus demain à 06:00.');
  // As low as the hard frost level: worded like it.
  const hard = buildForecastEventData(
    {
      trigger: 'frost_forecast',
      level: CUSTOM_LEVEL,
      threshold: -10,
      value: -10.4,
      dt: NOW + 10 * 3600,
    },
    'Maison',
    context,
  );
  assert.equal(hard.summary, 'Gel fort annoncé : -10 °C prévus demain à 06:00.');
  // The threshold stays metric (the filter is), the figures follow the instance.
  const us = buildForecastEventData(
    { trigger: 'wind_forecast', level: CUSTOM_LEVEL, threshold: 40, value: 42, dt: NOW + 3600 },
    'Maison',
    { ...context, units: 'us' },
  );
  assert.equal(us.threshold, 40);
  assert.notEqual(us.wind_gust, 42);
});
