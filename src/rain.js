// -----------------------------------------------------------------------------
// "Rain within the hour" nowcast (the `/rain` endpoint of the mobile
// webservice).
//
// The payload carries:
//   - `position`   { lat, lon, dept, timezone, rain_product_available: 0|1 }
//   - `forecast[]` ~9 slots over the next hour, 5 then 10 minutes wide:
//                  { dt, rain: 1..4, desc: 'Temps sec' }
//
// The level is Météo France's own scale: 1 dry, 2 light, 3 moderate, 4 heavy.
// The first slot is the one under way, so it says whether it rains NOW.
// The nowcast is radar-based and only covers part of the territory:
// `rain_product_available: 0` means "no nowcast here", never "dry".
// -----------------------------------------------------------------------------

// MF rain level -> intensity key, shared by the scene triggers and actions.
const RAIN_INTENSITIES = {
  1: 'none',
  2: 'light',
  3: 'moderate',
  4: 'heavy',
};

/**
 * @description Read the usable slots of a nowcast payload, oldest first.
 * @param {object} data - The raw nowcast payload.
 * @returns {Array<{dt: number, level: number}>} The slots.
 * @example
 * readSlots(rawRain); // -> [{ dt: 1790370900, level: 1 }, ...]
 */
function readSlots(data) {
  const forecast = Array.isArray(data && data.forecast) ? data.forecast : [];
  return forecast
    .filter(
      (slot) =>
        slot &&
        Number.isFinite(slot.dt) &&
        Number.isInteger(slot.rain) &&
        RAIN_INTENSITIES[slot.rain] !== undefined,
    )
    .map((slot) => ({ dt: slot.dt, level: slot.rain }))
    .sort((a, b) => a.dt - b.dt);
}

/**
 * @description Minutes from now to a slot, never negative (the slot under way
 * is "now").
 * @param {number} dt - The slot start, in seconds.
 * @param {number} nowSeconds - The current time, in seconds.
 * @returns {number} The whole minutes.
 * @example
 * minutesUntil(1790371200, 1790370900); // -> 5
 */
function minutesUntil(dt, nowSeconds) {
  return Math.max(0, Math.round((dt - nowSeconds) / 60));
}

/**
 * @description Summarise a nowcast payload.
 * @param {object} data - The raw nowcast payload.
 * @param {number} [nowSeconds] - The current time in seconds (for tests).
 * @returns {{available: boolean, raining: boolean, rainExpected: boolean,
 *   level: number, intensity: string, minutesUntilRain: number|null,
 *   minutesUntilDry: number|null, minutesUntilNextRain: number|null}} The
 *   summary: `level`/`intensity` are the HIGHEST of the hour,
 *   `minutesUntilDry` is set while it rains and the rain ends within the hour,
 *   `minutesUntilNextRain` is the first rain AFTER a dry spell (after the
 *   current rain, if any).
 * @example
 * readNowcast(rawRain); // -> { available: true, raining: false, rainExpected: true, ... }
 */
function readNowcast(data, nowSeconds = Math.floor(Date.now() / 1000)) {
  const position = (data && data.position) || {};
  const slots = readSlots(data);
  const summary = {
    available: position.rain_product_available !== 0 && slots.length > 0,
    raining: false,
    rainExpected: false,
    level: 1,
    intensity: RAIN_INTENSITIES[1],
    minutesUntilRain: null,
    minutesUntilDry: null,
    minutesUntilNextRain: null,
  };
  if (!summary.available) {
    return summary;
  }

  summary.raining = slots[0].level > 1;
  summary.level = Math.max(...slots.map((slot) => slot.level));
  summary.intensity = RAIN_INTENSITIES[summary.level];
  summary.rainExpected = summary.level > 1;

  const firstRain = slots.find((slot) => slot.level > 1);
  if (firstRain !== undefined) {
    summary.minutesUntilRain = minutesUntil(firstRain.dt, nowSeconds);
  }

  // The first dry slot after the rain under way, then the first rain after it.
  const firstDryIndex = slots.findIndex((slot) => slot.level === 1);
  if (summary.raining && firstDryIndex !== -1) {
    summary.minutesUntilDry = minutesUntil(slots[firstDryIndex].dt, nowSeconds);
  }
  if (firstDryIndex !== -1) {
    const nextRain = slots.slice(firstDryIndex).find((slot) => slot.level > 1);
    if (nextRain !== undefined) {
      summary.minutesUntilNextRain = minutesUntil(nextRain.dt, nowSeconds);
    }
  }
  return summary;
}

export { readNowcast, RAIN_INTENSITIES };
