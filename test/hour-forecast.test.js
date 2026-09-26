import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildHourForecastOutputs, readForecastHour } from '../src/scene-actions.js';

// 2026-08-04T16:00:00Z, 18:00 in Paris.
const EVENING = 1785859200;
const TIMEZONE = 'Europe/Paris';

/**
 * @description A raw forecast: hourly entries for 30 hours from the evening,
 * then 3-hour ones.
 * @returns {object} The raw payload.
 * @example
 * payload();
 */
function payload() {
  const forecast = [];
  const entry = (dt, index) => ({
    dt,
    T: { value: 10 + index / 10, windchill: 8 },
    humidity: 80,
    clouds: 40,
    rain: { '1h': index === 14 ? 1.2 : 0 },
    // 4 m/s from the south-west, gusts of 11 m/s.
    wind: { speed: 4, gust: index === 14 ? 11 : 0, direction: 225 },
    weather: { icon: 'p2j', desc: 'Eclaircies' },
  });
  for (let index = 0; index < 30; index += 1) {
    forecast.push(entry(EVENING + index * 3600, index));
  }
  for (let index = 0; index < 8; index += 1) {
    forecast.push(entry(EVENING + (30 + index * 3) * 3600, 100 + index));
  }
  return { forecast, probability_forecast: [{ dt: EVENING + 13 * 3600, rain: { '3h': 60 } }] };
}

const build = (fields, language = 'fr', units = 'metric') =>
  buildHourForecastOutputs({
    data: payload(),
    timezone: TIMEZONE,
    units,
    language,
    nowSeconds: EVENING,
    ...fields,
  });

test('reads the hour field, 8 by default', () => {
  assert.equal(readForecastHour('7'), 7);
  assert.equal(readForecastHour(30), 23);
  assert.equal(readForecastHour(null), 8);
  assert.equal(readForecastHour('abc'), 8);
});

test('gives the forecast of tomorrow 08:00, with a summary', () => {
  const outputs = build({ day: '1', hour: 8 });
  assert.equal(outputs.date, '2026-08-05');
  assert.equal(outputs.time, '08:00');
  assert.equal(outputs.temperature, 11);
  assert.equal(outputs.apparent_temperature, 8);
  assert.equal(outputs.condition, 'partly-cloudy');
  assert.equal(outputs.precipitation, 1.2);
  assert.equal(outputs.precipitation_probability, 60);
  // 4 m/s is 14 km/h, 11 m/s is 40 km/h.
  assert.equal(outputs.wind_speed, 14);
  assert.equal(outputs.wind_gust, 40);
  assert.equal(outputs.wind_direction, 225);
  assert.equal(outputs.wind_direction_label, 'Sud-ouest');
  assert.equal(
    outputs.summary,
    'Demain à 08:00 : éclaircies, 11 °C (ressenti 8 °C), vent de sud-ouest à 14 km/h, rafales à 40 km/h, 1,2 mm de pluie.',
  );
});

test('takes the 3-hour step covering the hour past the hourly forecast', () => {
  // The day after, 3-hour steps from 00:00 (index 30 = 00:00 on the 6th).
  const outputs = build({ day: '2', hour: 10 }, 'en');
  assert.equal(outputs.date, '2026-08-06');
  assert.equal(outputs.time, '09:00');
  assert.equal(
    outputs.summary,
    'Thursday 6 at 09:00: partly cloudy, 20 °C (feels like 8 °C), south-west wind at 14 km/h, no rain.',
  );
});

test('fails when the forecast does not reach that day', () => {
  assert.throws(
    () =>
      buildHourForecastOutputs({
        data: { forecast: [] },
        timezone: TIMEZONE,
        units: 'metric',
        language: 'fr',
        day: '1',
        hour: 8,
        nowSeconds: EVENING,
      }),
    /no hourly forecast/,
  );
});
