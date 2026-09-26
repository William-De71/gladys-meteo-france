// -----------------------------------------------------------------------------
// Entry point of the Météo France external integration.
//
// Météo France is a WEATHER integration (manifest `type: "weather"`, contract
// B.18): no devices, no discovery screens — a dedicated provider API. Gladys
// asks for the weather of a location, we answer in the pivot format, and the
// core feeds the dashboard widget, the chat assistant and the weather-alert
// scene triggers with it.
//
// Three SDK hooks make the weather provider:
//   - onWeatherGet(options)    the pivot payload: current conditions, hours,
//                              days, vigilance alerts, image metadata;
//   - onWeatherGetImage(key)   the raw base64 of the national vigilance map
//                              (the only feature needing the optional API key);
//   - requestWeatherRefresh()  the freshness nudge: we poll the vigilance
//                              upstream and tell the core to re-pull when it
//                              changed, so an alert scene fires in seconds
//                              instead of within the 30-minute floor.
//
// And the scene editor gets Météo France's own cards (Gladys 5.1):
//   - onSceneAction(key)       read-only actions: the forecast of a day or of
//                              an hour, the rain over the next hours, the rain
//                              within the hour, the vigilance, the frost and
//                              black ice risks of the coming morning (see
//                              scene-actions.js, frost.js, ice.js);
//   - publishSceneEvent(key)   triggers: rain expected / stopped from the radar
//                              nowcast, frost / heat / wind, black ice, snow,
//                              storm and UV forecast (see scene-triggers.js,
//                              hazard-triggers.js and scene-watcher.js).
//   The triggers watch the weather on their own, so they need the houses:
//   hence `location: true` and getHouses() (see houses.js).
//
// Zero configuration is required: forecast and vigilance go through the public
// token of the Météo France mobile app. The personal API key is optional and
// only unlocks the vigilance map image; the cache duration is optional too.
//
// A short in-memory cache sits in front of the provider (see forecast-cache.js):
// every request costs two upstream calls, and the forecast endpoint can take
// ~20 s on a cold cache.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, hasVigilanceMap } from './src/config.js';
import { getForecast, getRain, getVigilance, getVigilanceMap } from './src/meteo-france-api.js';
import { buildWeather, readDepartment, readTimezone } from './src/forecast.js';
import { buildAlerts, readMaxColor } from './src/vigilance.js';
import { createVigilanceWatcher } from './src/vigilance-watcher.js';
import { createForecastCache } from './src/forecast-cache.js';
import { createHouseRegistry } from './src/houses.js';
import { readNowcast } from './src/rain.js';
import {
  SCENE_ACTIONS,
  buildForecastOutputs,
  buildRainHoursOutputs,
  buildRainNowcastOutputs,
  buildVigilanceOutputs,
  buildFrostRiskOutputs,
  buildIceRiskOutputs,
  buildHourForecastOutputs,
} from './src/scene-actions.js';
import { createSceneWatcher } from './src/scene-watcher.js';

const gladys = new GladysIntegration();

// The image keys we declare in the pivot payload. They must match the
// `^[a-z0-9][a-z0-9-]{0,31}$` pattern the core validates.
const MAP_KEYS = {
  'vigilance-map-today': 'J',
  'vigilance-map-tomorrow': 'J1',
};

// Integration-scoped config, refreshed by the supervisor on every change.
let config = normalizeConfig();

// Language and unit system of the instance, as the core sent them in its last
// weather request. The scene actions and triggers have no request to read
// them from, so their texts and figures follow the last one.
let preferences = { language: 'fr', units: 'metric' };

// Short in-memory cache in front of Météo France: two upstream calls per
// request, on an endpoint that can take ~20 s cold.
const forecastCache = createForecastCache();

// Upstream vigilance watcher: it only ever polls departments the core asked
// about, and nudges when a color changed.
// Houses of the instance: the scene triggers and actions need them (the
// weather path gets its coordinates from the core).
const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses(), logger });

// Scene triggers: rain within the hour, frost, heat, wind, black ice, snow,
// storm and UV forecast.
const sceneWatcher = createSceneWatcher({
  houses,
  fetchRain: (latitude, longitude) =>
    getRain(latitude, longitude, { language: preferences.language }),
  fetchForecast: (latitude, longitude) =>
    getForecast(latitude, longitude, { language: preferences.language }),
  publish: (key, data) => gladys.publishSceneEvent(key, data),
  getPreferences: () => preferences,
  logger,
});

const vigilanceWatcher = createVigilanceWatcher({
  fetchVigilance: (department) => getVigilance(department),
  readMaxColor,
  onChange: () => {
    // The cached payloads carry the PREVIOUS alerts: drop them before nudging,
    // otherwise the re-pull we are asking for would be served from the cache
    // and the alert scene would never fire.
    forecastCache.clear();
    gladys.requestWeatherRefresh();
  },
  logger,
});

/**
 * @description Build the `images` metadata of the pivot payload. Only metadata
 * travels here: the bytes are fetched on demand through onWeatherGetImage.
 * @returns {Array<object>} The declared images (empty without an API key).
 * @example
 * buildImages(); // -> [{ key: 'vigilance-map-today', label: { fr: '...' } }]
 */
function buildImages() {
  if (!hasVigilanceMap(config)) {
    // No API key: declaring an image we cannot serve would only produce a
    // broken tile in the widget.
    return [];
  }
  return [
    {
      key: 'vigilance-map-today',
      label: {
        fr: 'Carte de vigilance – aujourd’hui',
        en: 'Vigilance map – today',
      },
    },
    {
      key: 'vigilance-map-tomorrow',
      label: {
        fr: 'Carte de vigilance – demain',
        en: 'Vigilance map – tomorrow',
      },
    },
  ];
}

/**
 * @description Fetch the vigilance alerts of a department, tolerating failure:
 * a vigilance outage must never cost the user their forecast.
 * @param {string|null} department - The department number.
 * @returns {Promise<Array<object>>} The pivot alerts (empty on failure).
 * @example
 * const alerts = await fetchAlerts('06');
 */
async function fetchAlerts(department) {
  if (department === null) {
    return [];
  }
  try {
    const warningData = await getVigilance(department);
    return buildAlerts(warningData, department);
  } catch (err) {
    logger.warn(`Vigilance fetch failed for department ${department}: ${err.message}`);
    return [];
  }
}

/**
 * @description Get the weather of a location, through the cache: the payload
 * of onWeatherGet, plus what the scene actions need beside it.
 * @param {object} options - { latitude, longitude, language, units }.
 * @returns {Promise<{weather: object, department: string|null, timezone: string|null}>}
 * The pivot weather, the department and the timezone of the place.
 * @example
 * const { weather } = await loadWeather({ latitude: 48.85, longitude: 2.35, language: 'fr', units: 'metric' });
 */
async function loadWeather({ latitude, longitude, language, units }) {
  const cacheKey = { latitude, longitude, language, units };
  const cached = forecastCache.get(cacheKey);
  if (cached !== null) {
    logger.debug(`Weather of (${latitude}, ${longitude}) served from the cache`);
    // Refresh the TTL of the department even on a cache hit: the core is still
    // asking about this location, so the watcher must keep polling it.
    if (cached.department !== null) {
      vigilanceWatcher.track(cached.department);
    }
    return cached;
  }

  logger.info(`Fetching the forecast of (${latitude}, ${longitude}) in ${units}`);
  const data = await getForecast(latitude, longitude, { language });
  const weather = buildWeather(data, { units });

  // Météo France returns the department alongside the forecast, so the
  // vigilance costs no extra geocoding.
  const department = readDepartment(data);
  if (department !== null) {
    // Teach the watcher which departments matter, so the upstream poll stays
    // limited to the locations the core actually uses.
    vigilanceWatcher.track(department);
    const alerts = await fetchAlerts(department);
    if (alerts.length > 0) {
      weather.alerts = alerts;
    }
  }

  const images = buildImages();
  if (images.length > 0) {
    weather.images = images;
  }

  // The department travels with the payload so a cache hit can still refresh
  // the watcher TTL without re-reading the forecast; the timezone lets the
  // scene actions print local times; the raw payload keeps the MF figures the
  // pivot rounds, for the frost risk.
  const entry = { weather, department, timezone: readTimezone(data), forecast: data };
  forecastCache.set(cacheKey, entry, config.cacheDuration);
  return entry;
}

// --- Weather request: Gladys asks us for the weather of a location -----------
// This is the whole point of the integration: the dashboard widget, the chat
// assistant and the weather-alert scene triggers all come through here.
gladys.onWeatherGet(async ({ latitude, longitude, language, units }) => {
  preferences = { language: language || preferences.language, units: units || preferences.units };
  logger.debug(`onWeatherGet -> (${latitude}, ${longitude}) in ${units}`);
  const { weather } = await loadWeather({ latitude, longitude, language, units });
  return weather;
});

// --- Provider image: Gladys asks for a declared image ------------------------
// Only ever called for a key we declared. The bytes are returned as RAW base64:
// the core validates the magic numbers and the size, then serves the image to
// the browser from its own origin.
gladys.onWeatherGetImage(async (key) => {
  const day = MAP_KEYS[key];
  if (day === undefined) {
    throw new Error(`Unknown Météo France image key: ${key}`);
  }
  if (!hasVigilanceMap(config)) {
    throw new Error('The vigilance map requires a Météo France API key');
  }
  logger.info(`onWeatherGetImage -> vigilance map ${key}`);
  return getVigilanceMap(config.apiKey, day);
});

// --- Scene actions -----------------------------------------------------------
// Read-only actions. Each targets a house of Gladys (the first located
// one when the "House" field is empty) and returns scalars for the following
// actions of the scene. Throwing fails the action only: the scene carries on.

/**
 * @description Find the house a scene action targets, reading the houses once
 * more when none is known yet (the action may run before the first poll).
 * @param {string|null|undefined} name - The "House" field.
 * @returns {Promise<object>} The house.
 * @example
 * const house = await resolveHouse('Maison');
 */
async function resolveHouse(name) {
  if (houses.list().length === 0) {
    await houses.refresh();
  }
  return houses.resolve(name);
}

/**
 * @description Load the weather of a house, in the preferences of the instance.
 * @param {object} house - The house.
 * @returns {Promise<object>} The loadWeather() entry.
 * @example
 * const { weather, timezone } = await loadHouseWeather(house);
 */
function loadHouseWeather(house) {
  return loadWeather({
    latitude: house.latitude,
    longitude: house.longitude,
    language: preferences.language,
    units: preferences.units,
  });
}

gladys.onSceneAction(SCENE_ACTIONS.GET_FORECAST, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { weather, timezone } = await loadHouseWeather(house);
  return buildForecastOutputs({ weather, timezone, ...preferences, day: fields.day });
});

gladys.onSceneAction(SCENE_ACTIONS.GET_RAIN_NEXT_HOURS, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { weather, timezone } = await loadHouseWeather(house);
  return buildRainHoursOutputs({ weather, timezone, ...preferences, hours: fields.hours });
});

gladys.onSceneAction(SCENE_ACTIONS.GET_RAIN_NEXT_HOUR, async (fields) => {
  const house = await resolveHouse(fields.house);
  // Never cached: the nowcast is refreshed every 5 minutes upstream, and a
  // scene asking "does it rain within the hour?" wants the latest one.
  const data = await getRain(house.latitude, house.longitude, {
    language: preferences.language,
  });
  return buildRainNowcastOutputs(readNowcast(data), preferences.language);
});

gladys.onSceneAction(SCENE_ACTIONS.GET_VIGILANCE, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { department } = await loadHouseWeather(house);
  if (department === null) {
    throw new Error(`Météo France publishes no vigilance for house "${house.name}"`);
  }
  // Fresh, not the alerts of the cached payload: a scene reading the
  // vigilance right after a change must not get the previous one.
  const warningData = await getVigilance(department);
  return buildVigilanceOutputs(warningData, department, preferences.language);
});

gladys.onSceneAction(SCENE_ACTIONS.GET_FROST_RISK, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { forecast, timezone } = await loadHouseWeather(house);
  return buildFrostRiskOutputs({ data: forecast, timezone, ...preferences });
});

gladys.onSceneAction(SCENE_ACTIONS.GET_ICE_RISK, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { forecast, timezone } = await loadHouseWeather(house);
  return buildIceRiskOutputs({ data: forecast, timezone, ...preferences });
});

gladys.onSceneAction(SCENE_ACTIONS.GET_HOUR_FORECAST, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { forecast, timezone } = await loadHouseWeather(house);
  return buildHourForecastOutputs({
    data: forecast,
    timezone,
    ...preferences,
    day: fields.day,
    hour: fields.hour,
  });
});

// --- Configuration -----------------------------------------------------------
// The API key is optional: an empty configuration is perfectly valid, it just
// means the vigilance map is unavailable.
gladys.onConfigUpdated((rawConfig) => {
  config = normalizeConfig(rawConfig);
  // A new API key changes the `images` metadata of the payload, and a shorter
  // cache duration must take effect now: the previous answers are stale.
  forecastCache.clear();
  logger.info(
    hasVigilanceMap(config)
      ? 'Météo France API key configured: the vigilance map is available'
      : 'No Météo France API key: forecast and vigilance work, the map is disabled',
  );
});

// --- Connection lifecycle ----------------------------------------------------
// There is no persistent connection to Météo France (plain HTTPS calls) and no
// mandatory configuration to validate, so the integration is "connected" as
// soon as it is up.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    // The config may have changed while we were disconnected.
    forecastCache.clear();
    await gladys.setConnectionStatus(true);
    vigilanceWatcher.start();
    // The houses may have changed while we were disconnected. The first start
    // sets the baselines of the scene triggers in the background: a cold
    // forecast can take 20 s per house, the connection must not wait for it.
    await houses.refresh();
    sceneWatcher.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  vigilanceWatcher.stop();
  sceneWatcher.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Météo France integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
