import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig, hasVigilanceMap } from '../src/config.js';

test('normalizes an absent configuration, which is perfectly valid here', () => {
  // Forecast and vigilance need no configuration at all.
  assert.deepEqual(normalizeConfig(), { apiKey: '' });
  assert.deepEqual(normalizeConfig({}), { apiKey: '' });
});

test('trims the API key', () => {
  assert.deepEqual(normalizeConfig({ api_key: '  abcd  ' }), { apiKey: 'abcd' });
});

test('ignores a non-string API key', () => {
  assert.deepEqual(normalizeConfig({ api_key: 42 }), { apiKey: '' });
  assert.deepEqual(normalizeConfig({ api_key: null }), { apiKey: '' });
});

test('gates the vigilance map on the API key alone', () => {
  assert.equal(hasVigilanceMap({ apiKey: 'abcd' }), true);
  assert.equal(hasVigilanceMap({ apiKey: '' }), false);
  assert.equal(hasVigilanceMap(undefined), false);
});
