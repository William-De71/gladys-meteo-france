// -----------------------------------------------------------------------------
// Météo France API client.
//
// Two distinct APIs are used, with very different access rules:
//
//   1. The MOBILE WEBSERVICE (https://webservice.meteofrance.com) — forecast and
//      vigilance. It is the backend of the official Météo France mobile app and
//      answers with a PUBLIC token embedded in that app, so forecast and
//      vigilance need NO configuration at all.
//   2. The PUBLIC API (https://public-api.meteofrance.fr) — the national
//      vigilance map thumbnail. This one DOES require a personal API key, which
//      is why the key is an OPTIONAL config field: without it everything works
//      except the map image.
//
// This module holds only HTTP calls (no SDK, no Gladys concept) so it stays
// trivially unit-testable.
// -----------------------------------------------------------------------------

const WEBSERVICE_URL = 'https://webservice.meteofrance.com';
const PUBLIC_API_URL = 'https://public-api.meteofrance.fr/public/DPVigilance/v1';

// Public token of the Météo France mobile app: this is what makes the
// integration work with zero configuration.
const PUBLIC_TOKEN = '__Wj7dVSTjV9YGu1guveLyDq0g7S7TfTjaHBTPTpO0kj8__';

// The forecast endpoint can take ~20 s on a cold cache, then answers in ~50 ms.
const FORECAST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

/**
 * @description Run a GET request with a timeout, returning the parsed JSON.
 * @param {string|URL} url - The URL to fetch.
 * @param {object} [options] - Options.
 * @param {number} [options.timeoutMs] - Abort delay in milliseconds.
 * @param {object} [options.headers] - Additional request headers.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (for tests).
 * @returns {Promise<any>} Resolves with the parsed JSON body.
 * @example
 * await getJson('https://webservice.meteofrance.com/forecast?lat=48.85&lon=2.35');
 */
async function getJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Météo France API returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Météo France API timed out', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @description Get the raw forecast payload for a location. Retries once: the
 * API can fail or answer without a department on a cold cache.
 * @param {number} latitude - Latitude.
 * @param {number} longitude - Longitude.
 * @param {object} [options] - Options.
 * @param {string} [options.language] - Language of the textual descriptions.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (for tests).
 * @returns {Promise<any>} Resolves with the raw forecast payload.
 * @example
 * const forecast = await getForecast(48.85, 2.35);
 */
async function getForecast(latitude, longitude, { language = 'fr', fetchImpl = fetch } = {}) {
  const url = new URL(`${WEBSERVICE_URL}/forecast`);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('lang', language);
  url.searchParams.set('token', PUBLIC_TOKEN);

  try {
    return await getJson(url, { timeoutMs: FORECAST_TIMEOUT_MS, fetchImpl });
  } catch {
    // Single retry: a cold cache surfaces as a transient failure.
    return getJson(url, { timeoutMs: FORECAST_TIMEOUT_MS, fetchImpl });
  }
}

/**
 * @description Get the raw vigilance payload of a French department.
 * @param {string} department - Department number (e.g. '06', '75', '2A').
 * @param {object} [options] - Options.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (for tests).
 * @returns {Promise<any>} Resolves with the raw warning payload.
 * @example
 * const warning = await getVigilance('06');
 */
async function getVigilance(department, { fetchImpl = fetch } = {}) {
  const url = new URL(`${WEBSERVICE_URL}/v3/warning/full`);
  url.searchParams.set('domain', department);
  url.searchParams.set('token', PUBLIC_TOKEN);
  return getJson(url, { fetchImpl });
}

/**
 * @description Get the national vigilance map thumbnail as raw base64. This is
 * the ONLY call requiring the optional personal API key.
 * @param {string} apiKey - The personal Météo France API key.
 * @param {'J'|'J1'} day - 'J' for today, 'J1' for tomorrow.
 * @param {object} [options] - Options.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (for tests).
 * @returns {Promise<string>} Resolves with the RAW base64 (no data: prefix).
 * @example
 * const base64 = await getVigilanceMap('my-api-key', 'J');
 */
async function getVigilanceMap(apiKey, day, { fetchImpl = fetch } = {}) {
  if (!apiKey) {
    throw new Error('A Météo France API key is required to fetch the vigilance map');
  }
  const url = `${PUBLIC_API_URL}/vignettenationale-${day}/encours`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { apikey: apiKey },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Météo France vigilance map returned HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    // The SDK contract wants RAW base64: the core adds the data URI itself.
    return Buffer.from(buffer).toString('base64');
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Météo France vigilance map timed out', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export { getForecast, getVigilance, getVigilanceMap, WEBSERVICE_URL, PUBLIC_API_URL, PUBLIC_TOKEN };
