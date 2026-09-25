import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SCENE_ACTIONS,
  MAX_DAY_OFFSET,
  MIN_RAIN_HOURS,
  MAX_RAIN_HOURS,
  DEFAULT_RAIN_HOURS,
} from '../src/scene-actions.js';
import { SCENE_TRIGGERS, FORECAST_LEVELS } from '../src/scene-triggers.js';
import { RAIN_INTENSITIES } from '../src/rain.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));

test('declares exactly the scene actions the code handles', () => {
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
});

test('declares exactly the scene triggers the code publishes', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('offers exactly the forecast levels the code evaluates', () => {
  const triggers = byKey(manifest.scene_triggers);
  Object.entries(FORECAST_LEVELS).forEach(([key, { levels }]) => {
    const field = triggers.get(key).fields.find((candidate) => candidate.key === 'level');
    assert.deepEqual(
      field.options.map((option) => option.value),
      levels.map(({ level }) => level),
    );
    // Required with a default: an empty level would fire every level at once.
    assert.equal(field.required, true);
  });
});

test('offers the rain intensities the nowcast produces', () => {
  const field = byKey(manifest.scene_triggers)
    .get(SCENE_TRIGGERS.RAIN_EXPECTED)
    .fields.find((candidate) => candidate.key === 'intensity');
  const produced = Object.values(RAIN_INTENSITIES).filter((intensity) => intensity !== 'none');
  assert.deepEqual(
    field.options.map((option) => option.value),
    produced,
  );
});

test('mirrors the bounds of the action fields', () => {
  const actions = byKey(manifest.scene_actions);
  const day = actions.get(SCENE_ACTIONS.GET_FORECAST).fields.find((field) => field.key === 'day');
  assert.equal(day.options.length, MAX_DAY_OFFSET + 1);
  const hours = actions
    .get(SCENE_ACTIONS.GET_RAIN_NEXT_HOURS)
    .fields.find((field) => field.key === 'hours');
  assert.equal(hours.min, MIN_RAIN_HOURS);
  assert.equal(hours.max, MAX_RAIN_HOURS);
  assert.equal(hours.default, DEFAULT_RAIN_HOURS);
});

test('asks for the house location the triggers need', () => {
  assert.equal(manifest.location, true);
});
