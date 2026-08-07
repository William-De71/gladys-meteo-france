// -----------------------------------------------------------------------------
// Short in-memory cache in front of Météo France.
//
// The dashboard widget and the chat assistant both ask for the weather, and
// every `onWeatherGet` costs TWO upstream calls (forecast + vigilance) on an
// endpoint that can take ~20 s on a cold cache (see meteo-france-api.js).
// Re-reading a two-minute-old forecast buys nothing and keeps the widget
// waiting, so a recent answer is reused. The duration is the user's
// `cache_duration` setting (0 disables the cache entirely).
//
// The cache is invalidated from two sides:
//   - `clear()` on every configuration change (a new API key must not keep
//     serving answers built without the vigilance map);
//   - `clear()` when the vigilance watcher detects an upstream change — the
//     freshness nudge asks the core to re-pull NOW, and it must not land back
//     on the cached answer carrying the previous alerts. This is the one
//     difference with a forecast-only provider: our payload embeds alerts.
// -----------------------------------------------------------------------------

// Coordinates are rounded before they enter the cache key: the dashboard and
// the chat send the same house, sometimes with a different float tail.
const COORDINATE_PRECISION = 4;

/**
 * @description Create a weather cache keyed by location, language and units.
 * The cached value is opaque to the cache: the caller stores whatever it needs
 * to answer without a round trip (here `{ weather, department }`).
 * @returns {object} The cache ({ get, set, clear, size }).
 * @example
 * const cache = createForecastCache();
 * cache.set({ latitude: 48.85, longitude: 2.35, language: 'fr', units: 'metric' }, entry, 600);
 */
function createForecastCache() {
  // key -> { value, expiresAt }
  const entries = new Map();

  /**
   * @description Build the cache key of a request. The answer depends on the
   * place, the language of the textual descriptions AND the unit system.
   * @param {object} options - The request options.
   * @returns {string|null} The key, or null when the coordinates are unusable.
   * @example
   * buildKey({ latitude: 48.85, longitude: 2.35, language: 'fr', units: 'metric' });
   */
  function buildKey({ latitude, longitude, language, units }) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    return [
      latitude.toFixed(COORDINATE_PRECISION),
      longitude.toFixed(COORDINATE_PRECISION),
      language,
      units,
    ].join('|');
  }

  /**
   * @description Read a still-valid cached value.
   * @param {object} options - The request options.
   * @param {number} [now] - Current time in ms (injectable for the tests).
   * @returns {object|null} The cached value, or null on a miss.
   * @example
   * const entry = cache.get(options);
   */
  function get(options, now = Date.now()) {
    const key = buildKey(options);
    if (key === null) {
      return null;
    }
    const entry = entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt <= now) {
      // Expired: drop it rather than leaving it to rot in the map.
      entries.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * @description Store a value for `durationSeconds`. A duration of 0 (or
   * less) disables the cache: nothing is stored.
   * @param {object} options - The request options.
   * @param {object} value - The value to cache.
   * @param {number} durationSeconds - The cache duration in seconds.
   * @param {number} [now] - Current time in ms (injectable for the tests).
   * @example
   * cache.set(options, { weather, department }, 600);
   */
  function set(options, value, durationSeconds, now = Date.now()) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return;
    }
    const key = buildKey(options);
    if (key === null) {
      return;
    }
    entries.set(key, { value, expiresAt: now + durationSeconds * 1000 });
  }

  /**
   * @description Drop every cached answer.
   * @example
   * cache.clear();
   */
  function clear() {
    entries.clear();
  }

  return {
    get,
    set,
    clear,
    get size() {
      return entries.size;
    },
  };
}

export { createForecastCache, COORDINATE_PRECISION };
