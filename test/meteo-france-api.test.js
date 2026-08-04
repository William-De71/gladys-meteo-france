import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getForecast,
  getVigilance,
  getVigilanceMap,
  PUBLIC_TOKEN,
} from '../src/meteo-france-api.js';

/**
 * @description Build a fetch stub recording the URLs it was called with.
 * @param {Array<object>} responses - The successive responses to return.
 * @returns {Function} The stub, carrying a `calls` array.
 * @example
 * const fetchImpl = buildFetch([{ ok: true, json: async () => ({}) }]);
 */
function buildFetch(responses) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const response = responses[Math.min(index++, responses.length - 1)];
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('calls the forecast endpoint with the public token', async () => {
  const fetchImpl = buildFetch([{ ok: true, json: async () => ({ position: {} }) }]);
  await getForecast(48.85, 2.35, { fetchImpl });
  const { url } = fetchImpl.calls[0];
  assert.ok(url.includes('/forecast'));
  assert.ok(url.includes('lat=48.85'));
  assert.ok(url.includes('lon=2.35'));
  assert.ok(url.includes(encodeURIComponent(PUBLIC_TOKEN)));
});

test('retries the forecast once, the API failing on a cold cache', async () => {
  const fetchImpl = buildFetch([
    new Error('cold cache'),
    { ok: true, json: async () => ({ position: { dept: '75' } }) },
  ]);
  const data = await getForecast(48.85, 2.35, { fetchImpl });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(data.position.dept, '75');
});

test('surfaces a forecast failure when the retry fails too', async () => {
  const fetchImpl = buildFetch([new Error('down'), new Error('still down')]);
  await assert.rejects(() => getForecast(48.85, 2.35, { fetchImpl }), /still down/);
});

test('calls the vigilance endpoint with the department as domain', async () => {
  const fetchImpl = buildFetch([{ ok: true, json: async () => ({ color_max: 1 }) }]);
  await getVigilance('06', { fetchImpl });
  assert.ok(fetchImpl.calls[0].url.includes('domain=06'));
  assert.ok(fetchImpl.calls[0].url.includes('/v3/warning/full'));
});

test('turns an HTTP error into a readable message', async () => {
  const fetchImpl = buildFetch([{ ok: false, status: 503 }]);
  await assert.rejects(() => getVigilance('06', { fetchImpl }), /HTTP 503/);
});

test('returns the vigilance map as raw base64, without a data URI prefix', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const fetchImpl = buildFetch([{ ok: true, arrayBuffer: async () => png }]);
  const image = await getVigilanceMap('my-key', 'J', { fetchImpl });
  assert.equal(image, png.toString('base64'));
  assert.ok(!image.startsWith('data:'));
  // The map is the only call authenticated with the personal API key.
  assert.equal(fetchImpl.calls[0].options.headers.apikey, 'my-key');
  assert.ok(fetchImpl.calls[0].url.includes('vignettenationale-J'));
});

test('refuses to fetch the map without an API key', async () => {
  await assert.rejects(() => getVigilanceMap('', 'J'), /API key is required/);
});
