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
  // 24.3 °C is reported as 24: the widget truncates decimals, so the pivot
  // rounds to the nearest degree rather than letting it read 24 for 24.9.
  assert.equal(weather.temperature, 24);
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
  assert.equal(weather.days[0].wind_speed, 4);
});

test('carries the cloud cover MF publishes as `clouds`', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  // The pivot wants a 0-100 percentage, which is already what MF sends.
  assert.equal(weather.hours[0].cloud_cover, 40);
  assert.equal(weather.hours[1].cloud_cover, 100);
  // The current conditions carry the field of the running hour.
  assert.equal(weather.cloud_cover, 40);
  // An hour without the field simply omits it: the row is per-hour optional.
  assert.equal(weather.hours[2].cloud_cover, undefined);
});

test('drops a cloud cover outside the 0-100 range', () => {
  const fixture = buildForecastFixture();
  // Not a percentage we understand: dropped rather than clamped to a guess.
  fixture.forecast[1].clouds = 120;
  fixture.forecast[2].clouds = -1;
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.hours[0].cloud_cover, undefined);
  assert.equal(weather.hours[1].cloud_cover, undefined);
  assert.equal(weather.cloud_cover, undefined);
});

test('aggregates the daily wind from the hourly entries of each day', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  // The day's wind is its peak SUSTAINED speed (4 then 5), never its peak gust:
  // MF's own forecast prints the mean wind, and reporting the gust here showed
  // 14 km/h where meteofrance.com showed 10. The gust keeps its own field.
  assert.equal(weather.days[0].wind_speed, 4);
  assert.equal(weather.days[1].wind_speed, 5);
  assert.equal(weather.days[0].wind_gust, 8);
  assert.equal(weather.days[1].wind_gust, 12);
});

test('reports a calm day as a zero gust rather than as a hole', () => {
  const fixture = buildForecastFixture();
  // A calm day: MF reports a 0 gust, which is a real measurement, not a hole.
  fixture.forecast.forEach((entry) => {
    if (entry.wind) {
      entry.wind.gust = 0;
    }
  });
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  // The sustained speed is unaffected by the missing gust.
  assert.equal(weather.days[0].wind_speed, 4);
  assert.equal(weather.days[1].wind_speed, 5);
  // Sending the 0 is what keeps the row filled: nulling it would hide the
  // gusts of every day as soon as a single one is calm.
  assert.equal(weather.days[0].wind_gust, 0);
  assert.equal(weather.days[1].wind_gust, 0);
});

test('keeps the gusts of the windy days when only some days are calm', () => {
  // The regression this guards: one calm day used to empty the whole row.
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  assert.equal(weather.days[0].wind_gust, 8);
  assert.equal(weather.days[1].wind_gust, 12);
});

test('drops the daily gust rather than filling only some days', () => {
  const fixture = buildForecastFixture();
  // Tomorrow keeps an entry, but without any wind at all: a genuine hole, which
  // must still empty the row rather than be read as a calm day.
  fixture.forecast = fixture.forecast.map((entry) =>
    entry.dt >= NOON + 24 * 3600 ? { ...entry, wind: undefined } : entry,
  );
  const weather = buildWeather(fixture, { nowSeconds: NOON });
  assert.equal(weather.days[0].wind_gust, undefined);
  assert.equal(weather.days[1].wind_gust, undefined);
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
  assert.equal(weather.days[0].wind_speed, 4);
  assert.equal(weather.days[1].wind_speed, 5);
});

test('falls back to the midday hour when weather12H is null', () => {
  const weather = buildWeather(buildForecastFixture(), { nowSeconds: NOON });
  const tomorrow = weather.days[1];
  assert.equal(tomorrow.temperature_min, 15);
  assert.equal(tomorrow.temperature_max, 28);
  // weather12H is null tomorrow: the condition comes from the hourly entry
  // closest to midday ("Ciel voilé" -> partly-cloudy).
  assert.equal(tomorrow.weather, 'partly-cloudy');
});

test('summarises a day from its hours, not from the midday snapshot', () => {
  // MF answered `p1j`/"Ensoleillé" as weather12H on a day its own hourly
  // entries carried "Pluie" — and its precipitation.24h said 2.6 mm. Printing
  // that snapshot verbatim put a sun on a rainy day while meteofrance.com,
  // which summarises the whole day, showed showers.
  const fixture = buildForecastFixture();
  const tomorrowStart = NOON + 24 * 3600;
  fixture.daily_forecast[1].weather12H = { icon: 'p1j', desc: 'Ensoleillé' };
  fixture.forecast = fixture.forecast.filter((entry) => entry.dt < tomorrowStart);
  fixture.forecast.push(
    { dt: tomorrowStart, T: { value: 21 }, weather: { icon: 'p1j', desc: 'Ensoleillé' } },
    { dt: tomorrowStart + 3600, T: { value: 22 }, weather: { icon: 'p14j', desc: 'Pluie' } },
  );
  assert.equal(buildWeather(fixture, { nowSeconds: NOON }).days[1].weather, 'rain');
});

test('keeps the most notable condition, whatever the hour it falls on', () => {
  // The scale is about what describes a day, not about severity: a thunderstorm
  // at any hour outranks the clear spells around it.
  const fixture = buildForecastFixture();
  const tomorrowStart = NOON + 24 * 3600;
  fixture.forecast = fixture.forecast.filter((entry) => entry.dt < tomorrowStart);
  fixture.forecast.push(
    { dt: tomorrowStart, T: { value: 20 }, weather: { icon: 'p1j', desc: 'Ensoleillé' } },
    { dt: tomorrowStart + 3600, T: { value: 24 }, weather: { icon: 'p28j', desc: 'Orages' } },
    { dt: tomorrowStart + 7200, T: { value: 23 }, weather: { icon: 'p2j', desc: 'Eclaircies' } },
  );
  assert.equal(buildWeather(fixture, { nowSeconds: NOON }).days[1].weather, 'thunderstorm');
});

test('falls back on weather12H past the hourly window', () => {
  // `forecast` runs ~4 days while `daily_forecast` runs 8: the far days have no
  // hours to summarise, and the midday snapshot is all that is left.
  const fixture = buildForecastFixture();
  fixture.forecast = fixture.forecast.filter((entry) => entry.dt < NOON + 24 * 3600);
  fixture.daily_forecast[1].weather12H = { icon: 'p28j', desc: 'Orages' };
  assert.equal(buildWeather(fixture, { nowSeconds: NOON }).days[1].weather, 'thunderstorm');
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
  // 24.3 °C -> 75.74 °F, rounded to 76
  assert.equal(weather.temperature, 76);
  // MF answers in km/h, not m/s: 3.5 km/h -> 2.2 mph
  assert.equal(weather.wind_speed, 2.2);
  // 9.2 mm -> 0.36 in
  assert.equal(weather.hours[1].precipitation, 0.36);
  // 26 °C -> 78.8 °F, rounded to 79
  assert.equal(weather.days[0].temperature_max, 79);
});

test('keeps metric values untouched', () => {
  assert.equal(convertTemperature(20, 'metric'), 20);
  assert.equal(convertWindSpeed(10, 'metric'), 10);
});

test('rounds temperatures to the nearest degree', () => {
  // The widget truncates: sending 27.9 made it print 27° where meteofrance.com
  // printed 28°. Rounding here is what puts the two back in agreement.
  assert.equal(convertTemperature(27.9, 'metric'), 28);
  assert.equal(convertTemperature(29.6, 'metric'), 30);
  assert.equal(convertTemperature(15.1, 'metric'), 15);
  // Half degrees go up, negatives included (-2.5 -> -2, JS rounds towards +∞).
  assert.equal(convertTemperature(21.5, 'metric'), 22);
  assert.equal(convertTemperature(-3.2, 'metric'), -3);
  // Fahrenheit is rounded on the converted value, not before.
  assert.equal(convertTemperature(0, 'us'), 32);
  assert.equal(convertTemperature(-17.8, 'us'), 0);
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
