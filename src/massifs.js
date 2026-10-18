// -----------------------------------------------------------------------------
// The 36 avalanche massifs of Météo France, and the massif of a house.
//
// Météo France writes one avalanche bulletin (BRA) per massif of the Alps,
// Corsica and the Pyrenees. massifs.json holds their outlines, from the
// official "Metadata_massif_DP_2024" file of Météo France (Licence Ouverte /
// Etalab 2.0), simplified to ~170 m and rounded to 4 decimals: 29 KB instead
// of 72 KB, far more precise than a house needs.
//
// The massifs tile the mountains but not every valley: a house inside an
// outline belongs to it, a house just outside (Annecy, Lourdes, Gap…) to the
// nearest one within MAX_DISTANCE_KM. Farther, the house has no bulletin.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { normalizeName } from './houses.js';

// `[{ id: '03', name: 'Mont-Blanc', rings: [[[lon, lat], ...]] }]`, ids on two
// digits as the bulletin endpoint wants them.
const MASSIFS = JSON.parse(readFileSync(new URL('./massifs.json', import.meta.url), 'utf8'));

// A house farther than this from every outline has no massif.
const MAX_DISTANCE_KM = 5;

// Kilometres per degree of latitude.
const KM_PER_DEGREE = 110.57;

/**
 * @description Whether a point lies inside a ring (ray casting).
 * @param {number} longitude - Longitude.
 * @param {number} latitude - Latitude.
 * @param {Array<Array<number>>} ring - The closed ring, `[[lon, lat], ...]`.
 * @returns {boolean} True when inside.
 * @example
 * isInside(6.87, 45.92, ring);
 */
function isInside(longitude, latitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if (y1 > latitude !== y2 > latitude) {
      const crossing = ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1;
      if (longitude < crossing) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * @description Distance in km from a point to a ring, on a local flat
 * projection: exact enough over a few kilometres.
 * @param {number} longitude - Longitude.
 * @param {number} latitude - Latitude.
 * @param {Array<Array<number>>} ring - The ring.
 * @returns {number} The distance to its nearest edge, in km.
 * @example
 * distanceToRing(6.13, 45.9, ring); // -> 2.9
 */
function distanceToRing(longitude, latitude, ring) {
  const kmPerLongitude = KM_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = (ring[i][0] - longitude) * kmPerLongitude;
    const ay = (ring[i][1] - latitude) * KM_PER_DEGREE;
    const dx = (ring[i + 1][0] - longitude) * kmPerLongitude - ax;
    const dy = (ring[i + 1][1] - latitude) * KM_PER_DEGREE - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * @description The massif of a location: the one containing it, else the
 * nearest within MAX_DISTANCE_KM.
 * @param {number} latitude - Latitude.
 * @param {number} longitude - Longitude.
 * @returns {{id: string, name: string}|null} The massif, or null.
 * @example
 * findMassif(45.92, 6.87); // -> { id: '03', name: 'Mont-Blanc' }
 */
function findMassif(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const container = MASSIFS.find((massif) =>
    massif.rings.some((ring) => isInside(longitude, latitude, ring)),
  );
  if (container !== undefined) {
    return { id: container.id, name: container.name };
  }
  let nearest = null;
  let nearestDistance = MAX_DISTANCE_KM;
  for (const massif of MASSIFS) {
    for (const ring of massif.rings) {
      const distance = distanceToRing(longitude, latitude, ring);
      if (distance <= nearestDistance) {
        nearest = massif;
        nearestDistance = distance;
      }
    }
  }
  return nearest === null ? null : { id: nearest.id, name: nearest.name };
}

/**
 * @description A massif by its number or its name, ignoring case, accents,
 * dashes and spaces ("3", "03", "mont blanc", "Haute-Ariège").
 * @param {string|number} wanted - The number or the name.
 * @returns {{id: string, name: string}|null} The massif, or null.
 * @example
 * findMassifByName('Mont Blanc'); // -> { id: '03', name: 'Mont-Blanc' }
 */
function findMassifByName(wanted) {
  const value = String(wanted ?? '').trim();
  if (value === '') {
    return null;
  }
  const compact = (text) => normalizeName(text).replace(/[^a-z0-9]/g, '');
  const target = /^\d{1,2}$/.test(value) ? value.padStart(2, '0') : compact(value);
  const massif = MASSIFS.find(
    (candidate) => candidate.id === target || compact(candidate.name) === target,
  );
  return massif === undefined ? null : { id: massif.id, name: massif.name };
}

export { findMassif, findMassifByName, MASSIFS, MAX_DISTANCE_KM };
