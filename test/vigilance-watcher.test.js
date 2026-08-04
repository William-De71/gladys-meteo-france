import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVigilanceWatcher } from '../src/vigilance-watcher.js';

const silentLogger = { info() {}, warn() {}, debug() {} };

/**
 * @description Build a watcher over a scripted sequence of vigilance colors.
 * @param {Array<number>} colors - The colors returned by successive polls.
 * @returns {object} The watcher and the recorded nudges.
 * @example
 * const { watcher, nudges } = buildWatcher([1, 3]);
 */
function buildWatcher(colors) {
  const nudges = [];
  let index = 0;
  const watcher = createVigilanceWatcher({
    fetchVigilance: async () => ({ color_max: colors[Math.min(index++, colors.length - 1)] }),
    readMaxColor: (data) => data.color_max,
    onChange: () => nudges.push(Date.now()),
    logger: silentLogger,
  });
  return { watcher, nudges };
}

test('never nudges on the first poll, which is a baseline', () => {
  const { watcher, nudges } = buildWatcher([3]);
  watcher.track('75');
  return watcher.poll().then(() => {
    // A restart during an ongoing storm must not re-fire every scene.
    assert.equal(nudges.length, 0);
  });
});

test('nudges when the vigilance level raises', async () => {
  const { watcher, nudges } = buildWatcher([1, 3]);
  watcher.track('75');
  await watcher.poll(); // baseline: green
  await watcher.poll(); // orange
  assert.equal(nudges.length, 1);
});

test('nudges when the vigilance level drops, an ending alert being a trigger too', async () => {
  const { watcher, nudges } = buildWatcher([3, 1]);
  watcher.track('75');
  await watcher.poll();
  await watcher.poll();
  assert.equal(nudges.length, 1);
});

test('stays silent while the level is unchanged', async () => {
  const { watcher, nudges } = buildWatcher([3, 3, 3]);
  watcher.track('75');
  await watcher.poll();
  await watcher.poll();
  await watcher.poll();
  assert.equal(nudges.length, 0);
});

test('nudges only once per poll whatever the number of departments', async () => {
  const nudges = [];
  const colors = new Map([
    ['75', [1, 3]],
    ['06', [1, 4]],
  ]);
  const counters = new Map([
    ['75', 0],
    ['06', 0],
  ]);
  const watcher = createVigilanceWatcher({
    fetchVigilance: async (department) => {
      const index = counters.get(department);
      counters.set(department, index + 1);
      return { color_max: colors.get(department)[Math.min(index, 1)] };
    },
    readMaxColor: (data) => data.color_max,
    onChange: () => nudges.push(1),
    logger: silentLogger,
  });
  watcher.track('75');
  watcher.track('06');
  await watcher.poll();
  await watcher.poll();
  // The core re-pulls everything anyway, and the nudge is rate-limited to 1/min.
  assert.equal(nudges.length, 1);
});

test('only tracks the departments the core asked about', () => {
  const { watcher } = buildWatcher([1]);
  assert.equal(watcher.size, 0);
  watcher.track('75');
  watcher.track('75');
  watcher.track('06');
  assert.equal(watcher.size, 2);
  // Garbage input must never grow the watch list.
  watcher.track('');
  watcher.track(undefined);
  assert.equal(watcher.size, 2);
});

test('survives an upstream failure without losing the baseline', async () => {
  const nudges = [];
  let call = 0;
  const watcher = createVigilanceWatcher({
    fetchVigilance: async () => {
      call += 1;
      if (call === 2) {
        throw new Error('upstream down');
      }
      return { color_max: 3 };
    },
    readMaxColor: (data) => data.color_max,
    onChange: () => nudges.push(1),
    logger: silentLogger,
  });
  watcher.track('75');
  await watcher.poll(); // baseline: orange
  await watcher.poll(); // fails: the baseline must survive
  await watcher.poll(); // orange again -> unchanged, no nudge
  assert.equal(nudges.length, 0);
});

test('stop is idempotent and safe before start', () => {
  const { watcher } = buildWatcher([1]);
  watcher.stop();
  watcher.start();
  watcher.start();
  watcher.stop();
  watcher.stop();
});
