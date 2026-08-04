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
// -----------------------------------------------------------------------------

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config_schema values.
 * @returns {{ apiKey: string }} The normalized configuration.
 * @example
 * normalizeConfig({ api_key: ' abcd ' }); // -> { apiKey: 'abcd' }
 */
function normalizeConfig(rawConfig = {}) {
  return {
    apiKey: typeof rawConfig.api_key === 'string' ? rawConfig.api_key.trim() : '',
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

export { normalizeConfig, hasVigilanceMap };
