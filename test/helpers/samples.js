// -----------------------------------------------------------------------------
// One realistic sample of every scene event and every scene action output, in
// a given language, built with the real code.
//
// Shared by test/structure.test.js (the keys the scenes read must survive an
// update) and test/i18n.test.js (every text exists in every language).
// -----------------------------------------------------------------------------

import { buildRainEventData, buildForecastEventData } from '../../src/scene-triggers.js';
import { buildHazardEventData } from '../../src/hazard-triggers.js';
import {
  buildForecastOutputs,
  buildRainHoursOutputs,
  buildRainNowcastOutputs,
  buildVigilanceOutputs,
  buildFrostRiskOutputs,
  buildIceRiskOutputs,
  buildHourForecastOutputs,
} from '../../src/scene-actions.js';

// 2026-08-04T16:00:00Z, 18:00 in Paris.
const EVENING = 1785859200;
const TIMEZONE = 'Europe/Paris';
const HOUSE = 'Maison';

/**
 * @description A raw MF forecast of 30 hourly entries from the evening.
 * @param {object} [overrides] - Hour offset -> entry fields to override.
 * @returns {object} The raw payload.
 * @example
 * rawForecast({ 12: { T: { value: 0.4 } } });
 */
function rawForecast(overrides = {}) {
  const forecast = [];
  for (let offset = -6; offset < 30; offset += 1) {
    forecast.push({
      dt: EVENING + offset * 3600,
      T: { value: 8, windchill: 6 },
      humidity: 95,
      clouds: 10,
      rain: { '1h': 0 },
      wind: { speed: 4, gust: 11, direction: 225 },
      weather: { icon: 'p2j', desc: 'Eclaircies' },
      ...overrides[offset],
    });
  }
  return {
    forecast,
    probability_forecast: [
      { dt: EVENING + 9 * 3600, freezing: 40 },
      { dt: EVENING + 13 * 3600, rain: { '3h': 60 } },
    ],
  };
}

/**
 * @description A pivot weather payload of two days and six hours.
 * @returns {object} The pivot weather.
 * @example
 * pivotWeather();
 */
function pivotWeather() {
  const hours = [0, 0, 0.3, 1.2, 0, 0.1].map((amount, index) => ({
    temperature: 20,
    weather: amount ? 'rain' : 'clear',
    datetime: new Date((EVENING + index * 3600) * 1000).toISOString(),
    precipitation_probability: amount ? 70 : 10,
    precipitation: amount,
  }));
  return {
    temperature: 24,
    weather: 'clear',
    datetime: new Date(EVENING * 1000).toISOString(),
    hours,
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
        wind_speed: 6.1,
        wind_gust: 15.3,
        humidity: 70,
        uv_index: 3,
        sunrise: '2026-08-05T04:31:00.000Z',
        sunset: '2026-08-05T19:18:00.000Z',
      },
    ],
  };
}

const RAIN_SOON = {
  available: true,
  raining: false,
  rainExpected: true,
  level: 3,
  intensity: 'moderate',
  minutesUntilRain: 20,
  minutesUntilDry: null,
  minutesUntilNextRain: 20,
};
const RAINING = {
  available: true,
  raining: true,
  rainExpected: true,
  level: 2,
  intensity: 'light',
  minutesUntilRain: 0,
  minutesUntilDry: 20,
  minutesUntilNextRain: null,
};

const VIGILANCE = {
  color_max: 3,
  phenomenons_items: [
    { phenomenon_id: 1, phenomenon_max_color_id: 2 },
    { phenomenon_id: 3, phenomenon_max_color_id: 3 },
  ],
  comments: { text: ['Orages violents attendus.'] },
  text: { text_bloc_items: [{ text: ['Orages localement violents en soirée.'] }] },
};

/**
 * @description The data of one event of every scene trigger.
 * @param {string} language - The language of the instance.
 * @param {string} [units] - 'metric' or 'us'.
 * @returns {object} Trigger key -> event data.
 * @example
 * triggerSamples('de').frost_forecast.summary;
 */
function triggerSamples(language, units = 'metric') {
  const context = { timezone: TIMEZONE, units, language, nowSeconds: EVENING };
  const forecast = (event) => buildForecastEventData(event, HOUSE, context);
  const hazard = (event) => buildHazardEventData(event, HOUSE, context);
  return {
    rain_expected: buildRainEventData('rain_expected', HOUSE, RAIN_SOON, language),
    rain_stopped: buildRainEventData('rain_stopped', HOUSE, RAIN_SOON, language),
    frost_forecast: forecast({
      trigger: 'frost_forecast',
      level: 'frost',
      threshold: 0,
      value: -2.2,
      dt: EVENING + 12 * 3600,
    }),
    heat_forecast: forecast({
      trigger: 'heat_forecast',
      level: 'heat_35',
      threshold: 35,
      value: 36.2,
      dt: EVENING + 20 * 3600,
    }),
    wind_forecast: forecast({
      trigger: 'wind_forecast',
      level: 'gust_80',
      threshold: 80,
      value: 85,
      dt: EVENING + 3600,
    }),
    ice_forecast: hazard({
      trigger: 'ice_forecast',
      level: 'likely',
      iceLevel: 2,
      hour: { dt: EVENING + 12 * 3600, temperature: -1.4, freezingRain: false, recentRain: 2.4 },
    }),
    snow_forecast: hazard({
      trigger: 'snow_forecast',
      dt: EVENING + 12 * 3600,
      condition: 'snow',
      probability: 60,
      limit: 800,
    }),
    storm_forecast: hazard({ trigger: 'storm_forecast', dt: EVENING + 3600, condition: 'hail' }),
    uv_forecast: hazard({
      trigger: 'uv_forecast',
      level: 'uv_8',
      threshold: 8,
      uv: 8,
      date: '2026-08-05',
      today: false,
    }),
  };
}

/**
 * @description The outputs of one run of every scene action.
 * @param {string} language - The language of the instance.
 * @param {string} [units] - 'metric' or 'us'.
 * @returns {object} Action key -> outputs.
 * @example
 * actionSamples('es').get_vigilance.summary;
 */
function actionSamples(language, units = 'metric') {
  const common = { timezone: TIMEZONE, units, language, nowSeconds: EVENING };
  return {
    get_forecast: buildForecastOutputs({ weather: pivotWeather(), ...common, day: '1' }),
    get_rain_next_hours: buildRainHoursOutputs({ weather: pivotWeather(), ...common, hours: 6 }),
    get_rain_next_hour: buildRainNowcastOutputs(RAINING, language),
    get_vigilance: buildVigilanceOutputs(VIGILANCE, '33', language),
    get_frost_risk: buildFrostRiskOutputs({
      data: rawForecast({ 12: { T: { value: 0.4 }, wind: { speed: 1, gust: 0 } } }),
      ...common,
    }),
    get_ice_risk: buildIceRiskOutputs({
      data: rawForecast({
        10: { T: { value: 1 }, rain: { '1h': 2.4 } },
        12: { T: { value: -1.5 } },
      }),
      ...common,
    }),
    get_hour_forecast: buildHourForecastOutputs({
      data: rawForecast({ 14: { rain: { '1h': 1.2 } } }),
      ...common,
      day: '1',
      hour: 8,
    }),
  };
}

export { triggerSamples, actionSamples, EVENING, TIMEZONE, HOUSE };
