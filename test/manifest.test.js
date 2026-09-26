import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SCENE_ACTIONS,
  MAX_DAY_OFFSET,
  MIN_RAIN_HOURS,
  MAX_RAIN_HOURS,
  DEFAULT_RAIN_HOURS,
  MAX_HOUR_DAY_OFFSET,
  DEFAULT_FORECAST_HOUR,
} from '../src/scene-actions.js';
import { SCENE_TRIGGERS, CUSTOM_LEVEL, FORECAST_LEVELS } from '../src/scene-triggers.js';
import { RAIN_INTENSITIES } from '../src/rain.js';
import { ICE_TRIGGER_LEVELS, UV_LEVELS } from '../src/hazard-triggers.js';

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
      [...levels.map(({ level }) => level), CUSTOM_LEVEL],
    );
    // Required with a default: an empty level would fire every level at once.
    assert.equal(field.required, true);
  });
});

test('bounds the custom threshold by the ladder the code watches', () => {
  const triggers = byKey(manifest.scene_triggers);
  Object.entries(FORECAST_LEVELS).forEach(([key, { thresholds }]) => {
    const trigger = triggers.get(key);
    const field = trigger.fields.find((candidate) => candidate.key === 'threshold');
    assert.equal(field.type, 'number');
    assert.equal(field.required, false);
    assert.equal(field.min, thresholds.min);
    assert.equal(field.max, thresholds.max);
    assert.ok(trigger.variables.some((variable) => variable.key === 'threshold'));
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

test('offers exactly the ice and UV levels the code fires', () => {
  const triggers = byKey(manifest.scene_triggers);
  const options = (key) =>
    triggers
      .get(key)
      .fields.find((field) => field.key === 'level')
      .options.map((option) => option.value);
  assert.deepEqual(
    options(SCENE_TRIGGERS.ICE_FORECAST),
    ICE_TRIGGER_LEVELS.map(({ level }) => level),
  );
  assert.deepEqual(options(SCENE_TRIGGERS.UV_FORECAST), [
    ...UV_LEVELS.levels.map(({ level }) => level),
    CUSTOM_LEVEL,
  ]);
  const threshold = triggers
    .get(SCENE_TRIGGERS.UV_FORECAST)
    .fields.find((field) => field.key === 'threshold');
  assert.equal(threshold.min, UV_LEVELS.thresholds.min);
  assert.equal(threshold.max, UV_LEVELS.thresholds.max);
});

test('mirrors the bounds of the hour forecast fields', () => {
  const fields = byKey(manifest.scene_actions).get(SCENE_ACTIONS.GET_HOUR_FORECAST).fields;
  const day = fields.find((field) => field.key === 'day');
  assert.equal(day.options.length, MAX_HOUR_DAY_OFFSET + 1);
  const hour = fields.find((field) => field.key === 'hour');
  assert.deepEqual([hour.min, hour.max, hour.default], [0, 23, DEFAULT_FORECAST_HOUR]);
});

test('asks for the house location the triggers need', () => {
  assert.equal(manifest.location, true);
});
