import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createAvalancheWatcher } from '../src/avalanche-watcher.js';

const silentLogger = { info() {}, warn() {}, debug() {} };

const XML = readFileSync(new URL('./fixtures/avalanche-mont-blanc.xml', import.meta.url), 'utf8');
const OUT_OF_SEASON = JSON.stringify({ error_message: 'Rendez-vous début novembre.' });

// Chamonix and Les Houches: Mont-Blanc. Paris: no massif.
const CHALET = { id: 'h1', name: 'Chalet', latitude: 45.9237, longitude: 6.8694 };
const STUDIO = { id: 'h2', name: 'Studio', latitude: 45.89, longitude: 6.8 };
const FLAT = { id: 'h3', name: 'Appartement', latitude: 48.85, longitude: 2.35 };

/**
 * @description A bulletin of the fixture at a given danger.
 * @param {number} risk - The danger 1-5.
 * @returns {string} The XML.
 * @example
 * bulletinAt(3);
 */
function bulletinAt(risk) {
  return XML.replace(
    /<RISQUE RISQUE1="[^/]*\/>/,
    `<RISQUE RISQUE1="${risk}" RISQUEMAXI="${risk}" DATE_RISQUE_J2="2026-05-19T00:00:00"/>`,
  );
}

/**
 * @description A watcher over scripted bulletins.
 * @param {Array<string|Error>} answers - The successive bulletins.
 * @param {Array<object>} [houses] - The located houses.
 * @returns {object} The watcher, the published events and the fetched massifs.
 * @example
 * buildWatcher([bulletinAt(2), bulletinAt(3)]);
 */
function buildWatcher(answers, houses = [CHALET]) {
  const published = [];
  const fetched = [];
  let index = 0;
  const watcher = createAvalancheWatcher({
    houses: { list: () => houses },
    fetchBulletin: async (massifId) => {
      fetched.push(massifId);
      const answer = answers[Math.min(index++, answers.length - 1)];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    publish: async (key, data) => {
      published.push({ key, data });
    },
    getPreferences: () => ({ language: 'fr' }),
    logger: silentLogger,
  });
  return { watcher, published, fetched };
}

test('the first reading is a baseline, a rise then fires each level crossed', async () => {
  const { watcher, published } = buildWatcher([bulletinAt(3), bulletinAt(3), bulletinAt(4)]);
  assert.equal(await watcher.poll(), 0);
  assert.equal(await watcher.poll(), 0);
  assert.equal(await watcher.poll(), 1);
  assert.equal(published[0].key, 'avalanche_risk');
  assert.equal(published[0].data.level, 'high');
  assert.equal(published[0].data.risk, 4);
  assert.equal(published[0].data.previous_risk, 3);
  assert.equal(published[0].data.house, 'Chalet');
  assert.equal(published[0].data.massif, 'Mont-Blanc');
});

test('a level re-arms once the danger falls back below it', async () => {
  const { watcher, published } = buildWatcher([
    bulletinAt(2),
    bulletinAt(3),
    bulletinAt(2),
    bulletinAt(3),
  ]);
  for (let i = 0; i < 4; i += 1) {
    await watcher.poll();
  }
  assert.deepEqual(
    published.map(({ data }) => data.level),
    ['considerable', 'considerable'],
  );
});

test('the first bulletin of the season fires, the end of the season does not', async () => {
  const { watcher, published } = buildWatcher([OUT_OF_SEASON, bulletinAt(2), OUT_OF_SEASON]);
  await watcher.poll();
  await watcher.poll();
  await watcher.poll();
  assert.deepEqual(
    published.map(({ data }) => [data.level, data.previous_risk]),
    [['moderate', 0]],
  );
});

test('a failed reading keeps the previous danger', async () => {
  const { watcher, published } = buildWatcher([
    bulletinAt(2),
    new Error('HTTP 503'),
    bulletinAt(3),
  ]);
  await watcher.poll();
  assert.equal(await watcher.poll(), 0);
  assert.equal(await watcher.poll(), 1);
  assert.equal(published[0].data.previous_risk, 2);
});

test('one reading per massif, one event per house, nothing for a house outside the massifs', async () => {
  const { watcher, published, fetched } = buildWatcher(
    [bulletinAt(2), bulletinAt(3)],
    [CHALET, STUDIO, FLAT],
  );
  await watcher.poll();
  await watcher.poll();
  assert.deepEqual(fetched, ['03', '03']);
  assert.deepEqual(
    published.map(({ data }) => data.house),
    ['Chalet', 'Studio'],
  );
});

test('a refused event does not stop the others', async () => {
  const published = [];
  let index = 0;
  const answers = [bulletinAt(1), bulletinAt(3)];
  const watcher = createAvalancheWatcher({
    houses: { list: () => [CHALET] },
    fetchBulletin: async () => answers[Math.min(index++, 1)],
    publish: async (key, data) => {
      published.push(data.level);
      throw new Error('core too old');
    },
    getPreferences: () => ({ language: 'en' }),
    logger: silentLogger,
  });
  await watcher.poll();
  assert.equal(await watcher.poll(), 2);
  assert.deepEqual(published, ['moderate', 'considerable']);
});
