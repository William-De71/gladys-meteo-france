// -----------------------------------------------------------------------------
// Entry point of the Météo France external integration.
//
// Météo France is a WEATHER integration (manifest `type: "weather"`, contract
// B.18): no devices, no discovery screens — a dedicated provider API. Gladys
// asks for the weather of a location, we answer in the pivot format, and the
// core feeds the dashboard widget, the chat assistant and the weather-alert
// scene triggers with it.
//
// Three SDK hooks, and that is the whole integration:
//   - onWeatherGet(options)    the pivot payload: current conditions, hours,
//                              days, vigilance alerts, image metadata;
//   - onWeatherGetImage(key)   the raw base64 of the national vigilance map
//                              (the only feature needing the optional API key);
//   - requestWeatherRefresh()  the freshness nudge: we poll the vigilance
//                              upstream and tell the core to re-pull when it
//                              changed, so an alert scene fires in seconds
//                              instead of within the 30-minute floor.
//
// Zero configuration is required: forecast and vigilance go through the public
// token of the Météo France mobile app. The personal API key is optional and
// only unlocks the vigilance map image.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, hasVigilanceMap } from './src/config.js';
import { getForecast, getVigilance, getVigilanceMap } from './src/meteo-france-api.js';
import { buildWeather, readDepartment } from './src/forecast.js';
import { buildAlerts, readMaxColor } from './src/vigilance.js';
import { createVigilanceWatcher } from './src/vigilance-watcher.js';

const gladys = new GladysIntegration();

// The image keys we declare in the pivot payload. They must match the
// `^[a-z0-9][a-z0-9-]{0,31}$` pattern the core validates.
const MAP_KEYS = {
  'vigilance-map-today': 'J',
  'vigilance-map-tomorrow': 'J1',
};

// Integration-scoped config, refreshed by the supervisor on every change.
let config = normalizeConfig();

// Upstream vigilance watcher: it only ever polls departments the core asked
// about, and nudges when a color changed.
const vigilanceWatcher = createVigilanceWatcher({
  fetchVigilance: (department) => getVigilance(department),
  readMaxColor,
  onChange: () => gladys.requestWeatherRefresh(),
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

// --- Weather request: Gladys asks us for the weather of a location -----------
// This is the whole point of the integration: the dashboard widget, the chat
// assistant and the weather-alert scene triggers all come through here.
gladys.onWeatherGet(async ({ latitude, longitude, language, units }) => {
  logger.info(`onWeatherGet -> forecast for (${latitude}, ${longitude}) in ${units}`);
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

// --- Configuration -----------------------------------------------------------
// The API key is optional: an empty configuration is perfectly valid, it just
// means the vigilance map is unavailable.
gladys.onConfigUpdated((rawConfig) => {
  config = normalizeConfig(rawConfig);
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
    await gladys.setConnectionStatus(true);
    vigilanceWatcher.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  vigilanceWatcher.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Météo France integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
