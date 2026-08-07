import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeConfig,
  hasVigilanceMap,
  DEFAULT_CACHE_DURATION,
  MAX_CACHE_DURATION,
} from '../src/config.js';

test('normalizes an absent configuration, which is perfectly valid here', () => {
  // Forecast and vigilance need no configuration at all.
  const expected = { apiKey: '', cacheDuration: DEFAULT_CACHE_DURATION };
  assert.deepEqual(normalizeConfig(), expected);
  assert.deepEqual(normalizeConfig({}), expected);
});

test('trims the API key', () => {
  assert.equal(normalizeConfig({ api_key: '  abcd  ' }).apiKey, 'abcd');
});

test('ignores a non-string API key', () => {
  assert.equal(normalizeConfig({ api_key: 42 }).apiKey, '');
  assert.equal(normalizeConfig({ api_key: null }).apiKey, '');
});

test('accepts the cache duration sent as a string by the generated form', () => {
  assert.equal(normalizeConfig({ cache_duration: '120' }).cacheDuration, 120);
});

test('accepts 0 as an explicit "no cache"', () => {
  // 0 is falsy: it must survive the normalization rather than fall back to
  // the default, or the user could never disable the cache.
  assert.equal(normalizeConfig({ cache_duration: 0 }).cacheDuration, 0);
});

test('clamps the cache duration to the manifest bounds', () => {
  assert.equal(normalizeConfig({ cache_duration: -50 }).cacheDuration, 0);
  assert.equal(normalizeConfig({ cache_duration: 99999 }).cacheDuration, MAX_CACHE_DURATION);
});

test('falls back to the default on an unusable cache duration', () => {
  assert.equal(normalizeConfig({ cache_duration: 'abc' }).cacheDuration, DEFAULT_CACHE_DURATION);
  assert.equal(normalizeConfig({ cache_duration: null }).cacheDuration, DEFAULT_CACHE_DURATION);
});

test('gates the vigilance map on the API key alone', () => {
  assert.equal(hasVigilanceMap({ apiKey: 'abcd' }), true);
  assert.equal(hasVigilanceMap({ apiKey: '' }), false);
  assert.equal(hasVigilanceMap(undefined), false);
});
