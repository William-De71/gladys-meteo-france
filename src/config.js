// -----------------------------------------------------------------------------
// Configuration of the Météo France integration.
//
// Unlike a credentials-based integration, this one works with NO configuration:
// forecast and vigilance go through the public token of the Météo France mobile
// app. The only config field is the OPTIONAL personal API key, which unlocks the
// national vigilance map image (`public-api.meteofrance.fr` requires it).
//
// The key is integration-scoped (manifest `config_schema`), not per user: the
// map is a national image, identical for everyone.
//
// The second field is the cache duration: how long a weather answer is reused
// before calling Météo France again (see forecast-cache.js).
// -----------------------------------------------------------------------------

// Bounds of the cache, mirrored from the `cache_duration` field of the manifest.
const MIN_CACHE_DURATION = 0;
const MAX_CACHE_DURATION = 3600;

// Default cache duration, in seconds. It MUST stay consistent with the
// `default` declared in the manifest `config_schema`.
const DEFAULT_CACHE_DURATION = 600;

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config_schema values.
 * @returns {{ apiKey: string, cacheDuration: number }} The normalized config.
 * @example
 * normalizeConfig({ api_key: ' abcd ' }); // -> { apiKey: 'abcd', cacheDuration: 600 }
 */
function normalizeConfig(rawConfig = {}) {
  // The generated form can send the number back as a string.
  const cacheDuration = Number(rawConfig.cache_duration ?? DEFAULT_CACHE_DURATION);
  return {
    apiKey: typeof rawConfig.api_key === 'string' ? rawConfig.api_key.trim() : '',
    cacheDuration: Number.isFinite(cacheDuration)
      ? Math.min(MAX_CACHE_DURATION, Math.max(MIN_CACHE_DURATION, cacheDuration))
      : DEFAULT_CACHE_DURATION,
  };
}

/**
 * @description Whether the optional API key is present, i.e. whether the
 * vigilance map can be served.
 * @param {{ apiKey: string }} config - The normalized configuration.
 * @returns {boolean} True when the vigilance map is available.
 * @example
 * hasVigilanceMap({ apiKey: 'abcd' }); // -> true
 */
function hasVigilanceMap(config) {
  return Boolean(config && config.apiKey);
}

export {
  normalizeConfig,
  hasVigilanceMap,
  DEFAULT_CACHE_DURATION,
  MIN_CACHE_DURATION,
  MAX_CACHE_DURATION,
};
