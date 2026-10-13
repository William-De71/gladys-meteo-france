// -----------------------------------------------------------------------------
// Non-regression of everything users store: every key of the manifest a scene
// or a saved configuration refers to, and the keys of the scene event data and
// action outputs the scenes read.
//
// test/fixtures/discovery.baseline.json was generated from version 1.4.1,
// before any change. A failure here means existing users would lose a setting,
// a scene filter or a scene variable: never update the baseline without a
// documented migration. (A weather integration has no devices: no external
// ids.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { triggerSamples, actionSamples } from './helpers/samples.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baseline = read('./fixtures/discovery.baseline.json');
const manifest = read('../gladys-assistant-integration.json');

const byKey = (list) => new Map((list ?? []).map((entry) => [entry.key, entry]));
const optionValues = (field) => (field?.options ?? []).map((option) => option.value);

/**
 * @description Check that every stored key keeps its type.
 * @param {object[]} current - The current fields.
 * @param {object[]} stored - The baseline `[{ key, type }]`.
 * @param {string} where - The entry, for the messages.
 */
function assertFieldsKept(current, stored, where) {
  const now = byKey(current);
  for (const { key, type } of stored) {
    assert.equal(now.get(key)?.type, type, `${where}.${key}`);
  }
}

/**
 * @description Check that every stored option value is still offered.
 * @param {object[]} fields - The current fields of a manifest entry.
 * @param {object} options - The baseline `{ fieldKey: [values] }`.
 * @param {string} where - The entry, for the messages.
 */
function assertOptionsKept(fields, options, where) {
  const current = byKey(fields);
  for (const [key, stored] of Object.entries(options ?? {})) {
    const offered = optionValues(current.get(key));
    for (const value of stored) {
      assert.ok(offered.includes(value), `${where}.${key}: ${value}`);
    }
  }
}

test('stays a cloud weather integration reading the house locations', () => {
  assert.equal(manifest.type, baseline.manifest.type);
  assert.deepEqual(manifest.transports, baseline.manifest.transports);
  assert.equal(manifest.location, baseline.manifest.location);
});

test('no configuration key disappears or changes type', () => {
  assertFieldsKept(manifest.config_schema, baseline.manifest.config_schema, 'config_schema');
});

test('scene triggers keep their keys, filters, filter values and variables', () => {
  const current = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = current.get(trigger.key);
    assert.ok(now, `scene_triggers.${trigger.key}`);
    assertFieldsKept(now.fields, trigger.fields, `${trigger.key}.fields`);
    assertOptionsKept(now.fields, trigger.options, trigger.key);
    assertFieldsKept(now.variables, trigger.variables, `${trigger.key}.variables`);
  }
});

test('scene actions keep their keys, fields, field values and outputs', () => {
  const current = byKey(manifest.scene_actions);
  for (const action of baseline.manifest.scene_actions) {
    const now = current.get(action.key);
    assert.ok(now, `scene_actions.${action.key}`);
    assertFieldsKept(now.fields, action.fields, `${action.key}.fields`);
    assertOptionsKept(now.fields, action.options, action.key);
    assertFieldsKept(now.outputs, action.outputs, `${action.key}.outputs`);
  }
});

test('the code still fills every scene variable and action output of 1.4.1', () => {
  const produced = {
    scene_event_data: triggerSamples('fr'),
    scene_action_outputs: actionSamples('fr'),
  };
  for (const [group, entries] of Object.entries(baseline.code)) {
    for (const [key, keys] of Object.entries(entries)) {
      for (const name of keys) {
        assert.ok(name in produced[group][key], `${group}.${key}.${name}`);
      }
    }
  }
});
