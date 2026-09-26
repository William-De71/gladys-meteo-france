import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildForecastOutputs,
  buildRainHoursOutputs,
  buildRainNowcastOutputs,
  buildVigilanceOutputs,
  readDayOffset,
  readRainHours,
  addDays,
} from '../src/scene-actions.js';

// 2026-08-04T10:00:00Z, noon in Paris.
const NOW = 1785837600;
const TIMEZONE = 'Europe/Paris';

/**
 * @description Build a pivot weather payload.
 * @param {object} [overrides] - Fields to override.
 * @returns {object} A pivot weather payload.
 * @example
 * buildWeather({ hours: [] });
 */
function buildWeather(overrides = {}) {
  return {
    temperature: 24,
    weather: 'clear',
    datetime: '2026-08-04T10:00:00.000Z',
    hours: [],
    days: [
      {
        datetime: '2026-08-04T00:00:00.000Z',
        temperature_min: 16,
        temperature_max: 29,
        weather: 'clear',
        precipitation: 0,
        precipitation_probability: 0,
        uv_index: 7,
        sunrise: '2026-08-04T04:30:00.000Z',
        sunset: '2026-08-04T19:20:00.000Z',
      },
      {
        datetime: '2026-08-05T00:00:00.000Z',
        temperature_min: 14,
        temperature_max: 21,
        weather: 'rain',
        precipitation: 4.2,
        precipitation_probability: 80,
        // The pivot wind is in m/s for metric: 15.3 m/s is 55 km/h.
        wind_gust: 15.3,
      },
    ],
    ...overrides,
  };
}

/**
 * @description Build pivot hours from a list of hourly amounts, starting now.
 * @param {Array<number|null>} amounts - The hourly precipitation, null for none.
 * @returns {Array<object>} The pivot hours.
 * @example
 * buildHours([0, 0.4]);
 */
function buildHours(amounts) {
  return amounts.map((amount, index) => {
    const hour = {
      temperature: 20,
      weather: amount ? 'rain' : 'clear',
      datetime: new Date((NOW + index * 3600) * 1000).toISOString(),
      precipitation_probability: amount ? 70 : 10,
    };
    if (amount !== null) {
      hour.precipitation = amount;
    }
    return hour;
  });
}

test('reads the day field, falling back to today', () => {
  assert.equal(readDayOffset('1'), 1);
  assert.equal(readDayOffset(7), 7);
  assert.equal(readDayOffset('8'), 0);
  assert.equal(readDayOffset(null), 0);
});

test('clamps the hours field to the pivot range', () => {
  assert.equal(readRainHours(48), 24);
  assert.equal(readRainHours(0), 1);
  assert.equal(readRainHours('6'), 6);
  assert.equal(readRainHours(undefined), 12);
});

test('shifts a date across a month', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
});

test('gives the forecast of tomorrow, with a summary', () => {
  const outputs = buildForecastOutputs({
    weather: buildWeather(),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    day: '1',
    nowSeconds: NOW,
  });
  assert.equal(outputs.date, '2026-08-05');
  assert.equal(outputs.condition, 'rain');
  assert.equal(outputs.condition_label, 'Pluie');
  assert.equal(outputs.precipitation, 4.2);
  assert.equal(outputs.wind_gust, 55);
  assert.equal(
    outputs.summary,
    'Demain : pluie, 14 à 21 °C, 4,2 mm de pluie (80 %), rafales à 55 km/h.',
  );
});

test('gives the forecast of today, with local sun times', () => {
  const outputs = buildForecastOutputs({
    weather: buildWeather(),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'en',
    day: '0',
    nowSeconds: NOW,
  });
  assert.equal(outputs.sunrise, '06:30');
  assert.equal(outputs.sunset, '21:20');
  assert.equal(outputs.uv_index, 7);
  // No rain, no notable gust: neither is mentioned.
  assert.equal(outputs.summary, 'Today: sunny, 16 to 29 °C.');
});

test('leaves out a figure the forecast does not carry', () => {
  const outputs = buildForecastOutputs({
    weather: buildWeather(),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    day: '1',
    nowSeconds: NOW,
  });
  assert.equal('uv_index' in outputs, false);
  assert.equal('sunrise' in outputs, false);
});

test('fails the action when the forecast does not reach the day', () => {
  assert.throws(
    () =>
      buildForecastOutputs({
        weather: buildWeather(),
        timezone: TIMEZONE,
        units: 'metric',
        language: 'fr',
        day: '5',
        nowSeconds: NOW,
      }),
    /no forecast for 2026-08-09/,
  );
});

test('says dry when no hour of the window carries rain', () => {
  const outputs = buildRainHoursOutputs({
    weather: buildWeather({ hours: buildHours([0, null, 0, 3]) }),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    hours: 3,
  });
  assert.equal(outputs.dry, true);
  assert.equal(outputs.precipitation, 0);
  assert.equal(outputs.hours, 3);
  assert.equal('hours_until_rain' in outputs, false);
  assert.equal(outputs.summary, 'Pas de pluie prévue dans les 3 prochaines heures.');
});

test('sums the rain of the window and times the first rainy hour', () => {
  const outputs = buildRainHoursOutputs({
    weather: buildWeather({ hours: buildHours([0, 0, 0.3, 1.2, 0, 0.1]) }),
    timezone: TIMEZONE,
    units: 'metric',
    language: 'fr',
    hours: 6,
  });
  assert.equal(outputs.dry, false);
  assert.equal(outputs.precipitation, 1.6);
  assert.equal(outputs.rainy_hours, 3);
  assert.equal(outputs.hours_until_rain, 2);
  assert.equal(outputs.first_rain_time, '14:00');
  assert.equal(outputs.max_probability, 70);
  assert.equal(
    outputs.summary,
    'Pluie prévue à partir de 14:00 dans les 6 prochaines heures : 1,6 mm sur 3 h.',
  );
});

test('describes the nowcast of an approaching shower', () => {
  const outputs = buildRainNowcastOutputs(
    {
      available: true,
      raining: false,
      rainExpected: true,
      level: 2,
      intensity: 'light',
      minutesUntilRain: 15,
      minutesUntilDry: null,
      minutesUntilNextRain: 15,
    },
    'fr',
  );
  assert.equal(outputs.rain_expected, true);
  assert.equal(outputs.minutes_until_rain, 15);
  assert.equal('minutes_until_dry' in outputs, false);
  assert.equal(outputs.summary, 'Pluie faible prévue dans 15 min.');
});

test('describes the nowcast of the rain under way', () => {
  const outputs = buildRainNowcastOutputs(
    {
      available: true,
      raining: true,
      rainExpected: true,
      level: 3,
      intensity: 'moderate',
      minutesUntilRain: 0,
      minutesUntilDry: 20,
      minutesUntilNextRain: null,
    },
    'en',
  );
  assert.equal(outputs.summary, 'Moderate rain now, ending in 20 min.');
});

test('summarises the vigilance with its phenomena, strongest first', () => {
  const outputs = buildVigilanceOutputs(
    {
      color_max: 3,
      phenomenons_items: [
        { phenomenon_id: 1, phenomenon_max_color_id: 2 },
        { phenomenon_id: 3, phenomenon_max_color_id: 3 },
        { phenomenon_id: 6, phenomenon_max_color_id: 1 },
      ],
      comments: { text: ['Orages violents attendus.'] },
    },
    '33',
    'fr',
  );
  assert.equal(outputs.color, 3);
  assert.equal(outputs.level, 'orange');
  assert.equal(outputs.has_alert, true);
  assert.equal(outputs.department_name, 'Gironde');
  assert.equal(outputs.phenomena, 'Orages (orange), Vent violent (jaune)');
  assert.equal(
    outputs.summary,
    'Vigilance orange en Gironde : Orages (orange), Vent violent (jaune).',
  );
  assert.equal(outputs.comment, 'Orages violents attendus.');
});

test('says so when no vigilance is in force', () => {
  const outputs = buildVigilanceOutputs({ color_max: 1, phenomenons_items: [] }, '75', 'en');
  assert.equal(outputs.has_alert, false);
  assert.equal(outputs.level, 'green');
  assert.equal('phenomena' in outputs, false);
  assert.equal(outputs.summary, 'No particular warning in Paris.');
});
