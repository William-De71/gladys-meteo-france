import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeather,
  readDepartment,
  convertTemperature,
  convertWindSpeed,
} from '../src/forecast.js';
import { buildForecastFixture, NOON } from './helpers/fixtures.js';

test('builds the required pivot fields from the first upcoming hour', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  assert.equal(weather.temperature, 24.3);
  assert.equal(weather.weather, 'partly-cloudy');
  assert.equal(weather.datetime, new Date(NOON * 1000).toISOString());
  assert.equal(weather.is_day, true);
});

test('drops the past hours of the current day', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  // The fixture opens at midnight; only the entries from NOON on remain.
  assert.equal(weather.hours.length, 4);
  assert.equal(weather.hours[0].datetime, new Date(NOON * 1000).toISOString());
});

test('promotes heavy rain to pouring, which has no MF icon code', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  const heavyHour = weather.hours[1];
  assert.equal(heavyHour.precipitation, 9.2);
  assert.equal(heavyHour.weather, 'pouring');
});

test('drops the variable wind direction MF encodes as -1', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  assert.equal(weather.hours[0].wind_direction, 220);
  assert.equal(weather.hours[1].wind_direction, undefined);
});

test('drops a zero wind gust rather than reporting a still gust', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  assert.equal(weather.hours[0].wind_gust, 8);
  assert.equal(weather.hours[1].wind_gust, undefined);
});

test('carries the precipitation probability of the covering slice', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  assert.equal(weather.hours[0].precipitation_probability, 40);
});

test('falls back to the midday hour when weather12H is null', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  const tomorrow = weather.days[1];
  // The fixture has no hourly entry for tomorrow, so no condition can be
  // derived — but the day itself must survive with its temperatures.
  assert.equal(tomorrow.temperature_min, 15);
  assert.equal(tomorrow.temperature_max, 28);
  assert.equal(tomorrow.weather, undefined);
});

test('exposes the daily UV index and sun times of today', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  assert.equal(weather.uv_index, 7);
  assert.ok(weather.sunrise);
  assert.ok(weather.sunset);
  assert.equal(weather.days[0].precipitation, 3.4);
});

test('converts every measure to the us unit system', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON, units: 'us' });
  // 24.3 °C -> 75.7 °F
  assert.equal(weather.temperature, 75.7);
  // 3.5 m/s -> 7.8 mph
  assert.equal(weather.wind_speed, 7.8);
  // 9.2 mm -> 0.36 in
  assert.equal(weather.hours[1].precipitation, 0.36);
  assert.equal(weather.days[0].temperature_max, 78.8);
});

test('keeps metric values untouched', () => {
  assert.equal(convertTemperature(20, 'metric'), 20);
  assert.equal(convertWindSpeed(10, 'metric'), 10);
});

test('reads the department out of the forecast payload', () => {
  assert.equal(readDepartment(buildForecastFixture()), '75');
  assert.equal(readDepartment({}), null);
  assert.equal(readDepartment({ position: {} }), null);
});

test('throws when no usable forecast entry remains', () => {
  // A payload whose entries are all in the past leaves nothing to report: the
  // provider loop of the core must fall through to the next provider.
  assert.throws(
    () => buildWeather(buildForecastFixture(), { nowSeconds: NOON + 100 * 3600 }),
    /no usable forecast entry/,
  );
});

test('survives an empty payload without crashing on missing arrays', () => {
  assert.throws(() => buildWeather({}, { nowSeconds: NOON }), /no usable forecast entry/);
});
