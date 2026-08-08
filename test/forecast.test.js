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
  assert.equal(weather.hours.length, 5);
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
  // Same 3h slice: the value spans every hour it covers.
  assert.equal(weather.hours[2].precipitation_probability, 40);
  // Next slice publishes only the 6h step, which must still be read.
  assert.equal(weather.hours[3].precipitation_probability, 20);
});

test('fills the precipitation probability on every hour, the widget needs it all', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  const filled = weather.hours.filter((hour) => typeof hour.precipitation_probability === 'number');
  assert.equal(filled.length, weather.hours.length);
});

test('backfills the running hour, whose slice MF no longer rates', () => {
  // The slice covering NOON is left unrated, as MF does for the current one.
  const fixture = buildForecastFixture();
  fixture.probability_forecast[1].rain = { '3h': null, '6h': null };
  fixture.probability_forecast[1].snow = { '3h': null, '6h': null };
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  // The first known value (20) is carried back rather than losing the row.
  assert.equal(weather.hours[0].precipitation_probability, 20);
  assert.equal(weather.hours[3].precipitation_probability, 20);
});

test('drops the hourly probability entirely when a later hour has none', () => {
  const fixture = buildForecastFixture();
  // Keep only the first slices: the later hours end up uncovered.
  fixture.probability_forecast = fixture.probability_forecast.slice(0, 2);
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  const filled = weather.hours.filter((hour) => typeof hour.precipitation_probability === 'number');
  assert.equal(filled.length, 0);
});

test('omits the probability when MF publishes none, as overseas', () => {
  const fixture = buildForecastFixture();
  delete fixture.probability_forecast;
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.hours[0].precipitation_probability, undefined);
  assert.equal(weather.days[0].precipitation_probability, undefined);
  // The wind aggregation does not depend on it and must still be there.
  assert.equal(weather.days[0].wind_speed, 8);
});

test('aggregates the daily wind from the hourly entries of each day', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  // Day 1 peaks at gust 8, day 2 at gust 12: every day carries its own value.
  assert.equal(weather.days[0].wind_speed, 8);
  assert.equal(weather.days[1].wind_speed, 12);
  assert.equal(weather.days[0].wind_gust, 8);
  assert.equal(weather.days[1].wind_gust, 12);
});

test('falls back to the peak speed on a day MF reports no gust', () => {
  const fixture = buildForecastFixture();
  // A calm day: MF reports a 0 gust, which is not a missing value.
  fixture.forecast.forEach((entry) => {
    if (entry.wind) {
      entry.wind.gust = 0;
    }
  });
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.days[0].wind_speed, 4);
  assert.equal(weather.days[1].wind_speed, 5);
  // A zero gust is never reported as a gust.
  assert.equal(weather.days[0].wind_gust, undefined);
});

test('drops the daily wind rather than filling only some days', () => {
  const fixture = buildForecastFixture();
  // Tomorrow keeps an entry, but without any wind: the row must not be half
  // filled, as the widget hides it as soon as one day misses the value.
  fixture.forecast = fixture.forecast.map((entry) =>
    entry.dt >= NOON + 24 * 3600 ? { ...entry, wind: undefined } : entry,
  );
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.days.length, 2);
  assert.equal(weather.days[0].wind_speed, undefined);
  assert.equal(weather.days[1].wind_speed, undefined);
});

test('aggregates the daily precipitation probability on every day', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  // Day 1 peaks at 40, day 2 at 60.
  assert.equal(weather.days[0].precipitation_probability, 40);
  assert.equal(weather.days[1].precipitation_probability, 60);
});

test('groups the days on local time, not on UTC slices', () => {
  // Guadeloupe is UTC-4: `daily_forecast[].dt` at 00:00 UTC lands on the
  // PREVIOUS local day, so a naive local grouping would shift every day.
  const fixture = buildForecastFixture({
    position: { lat: 16.24, lon: -61.53, dept: '971', timezone: 'America/Guadeloupe' },
  });
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.days[0].wind_speed, 8);
  assert.equal(weather.days[1].wind_speed, 12);
});

test('falls back to the midday hour when weather12H is null', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  const tomorrow = weather.days[1];
  assert.equal(tomorrow.temperature_min, 15);
  assert.equal(tomorrow.temperature_max, 28);
  // weather12H is null tomorrow: the condition comes from the hourly entry
  // closest to midday ('p3j' -> partly-cloudy).
  assert.equal(tomorrow.weather, 'partly-cloudy');
});

test('keeps a day without any hourly entry, minus the aggregated fields', () => {
  const fixture = buildForecastFixture();
  // Drop tomorrow's only hourly entry: the day must survive on its own data.
  fixture.forecast = fixture.forecast.filter((entry) => entry.dt < NOON + 24 * 3600);
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.days.length, 2);
  assert.equal(weather.days[1].temperature_max, 28);
  assert.equal(weather.days[1].weather, undefined);
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
