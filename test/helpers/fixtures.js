// -----------------------------------------------------------------------------
// Test fixtures shaped like the real Météo France payloads.
// -----------------------------------------------------------------------------

// 2026-08-04T00:00:00Z, used as the start of "today" in the fixtures.
const DAY_START = 1785801600;
const NOON = DAY_START + 12 * 3600;

/**
 * @description Build a raw forecast payload.
 * @param {object} [overrides] - Fields to override.
 * @returns {object} A raw Météo France forecast payload.
 * @example
 * const forecast = buildForecastFixture();
 */
function buildForecastFixture(overrides = {}) {
  return {
    position: {
      lat: 48.85,
      lon: 2.35,
      dept: '75',
      timezone: 'Europe/Paris',
    },
    forecast: [
      {
        dt: DAY_START, // in the past relative to NOON: must be dropped
        T: { value: 14, windchill: 13 },
        humidity: 70,
        sea_level: 1015,
        wind: { speed: 2, gust: 0, direction: 180 },
        weather: { icon: 'p1j', desc: 'Ensoleillé' },
      },
      {
        dt: NOON,
        T: { value: 24.3, windchill: 25 },
        humidity: 45,
        sea_level: 1013,
        wind: { speed: 3.5, gust: 8, direction: 220 },
        rain: { '1h': 0 },
        clouds: 40,
        weather: { icon: 'p2j', desc: 'Peu nuageux' },
      },
      {
        dt: NOON + 3600,
        T: { value: 25 },
        humidity: 44,
        wind: { speed: 4, gust: 0, direction: -1 }, // variable wind: dropped
        rain: { '1h': 9.2 }, // above the pouring threshold
        clouds: 100,
        weather: { icon: 'p10j', desc: 'Pluie modérée' },
      },
      {
        dt: NOON + 7200,
        T: { value: 22 },
        rain: { '1h': 1.2 },
        weather: { icon: 'p14bisj', desc: 'Averses' }, // bis: keyword fallback
      },
      {
        dt: NOON + 10800,
        T: { value: 18 },
        weather: { icon: 'p1n', desc: 'Ciel clair' }, // night
      },
      {
        // Tomorrow: MF drops to a 3h step on the later days. The daily wind is
        // aggregated from these, so every returned day needs its own entries.
        dt: NOON + 24 * 3600,
        T: { value: 27 },
        wind: { speed: 5, gust: 12, direction: 200 },
        weather: { icon: 'p3j', desc: 'Ciel voilé' },
      },
    ],
    // MF nests the probabilities per phenomenon and per step, and leaves the
    // slice already under way unrated (null steps) — both shapes are covered.
    probability_forecast: [
      { dt: DAY_START, rain: { '3h': null, '6h': null }, snow: { '3h': null, '6h': null } },
      { dt: NOON, rain: { '3h': 40, '6h': 40 }, snow: { '3h': 0, '6h': 0 } },
      { dt: NOON + 3 * 3600, rain: { '3h': null, '6h': 20 }, snow: { '3h': null, '6h': 0 } },
      // Tomorrow, so the daily aggregation has a slice on the second day too.
      { dt: DAY_START + 24 * 3600, rain: { '3h': 60, '6h': 60 }, snow: { '3h': 0, '6h': 0 } },
      // The 6h step MF falls back to on the later days, covering tomorrow noon.
      { dt: NOON + 24 * 3600, rain: { '3h': null, '6h': 30 }, snow: { '3h': null, '6h': 0 } },
    ],
    daily_forecast: [
      {
        dt: DAY_START,
        T: { min: 13, max: 26 },
        humidity: { min: 40, max: 80 },
        precipitation: { '24h': 3.4 },
        uv: 7,
        sun: { rise: DAY_START + 6 * 3600, set: DAY_START + 21 * 3600 },
        weather12H: { icon: 'p2j', desc: 'Peu nuageux' },
      },
      {
        dt: DAY_START + 24 * 3600,
        T: { min: 15, max: 28 },
        precipitation: { '24h': 0 },
        uv: 8,
        weather12H: null, // null on purpose: the midday fallback must kick in
      },
    ],
    ...overrides,
  };
}

/**
 * @description Build a raw vigilance payload.
 * @param {object} [overrides] - Fields to override.
 * @returns {object} A raw Météo France warning payload.
 * @example
 * const warning = buildVigilanceFixture();
 */
function buildVigilanceFixture(overrides = {}) {
  return {
    color_max: 3,
    begin_validity_time: DAY_START,
    end_validity_time: DAY_START + 24 * 3600,
    phenomenons_items: [
      { phenomenon_id: '1', phenomenon_max_color_id: 3 }, // Vent violent, orange
      { phenomenon_id: '3', phenomenon_max_color_id: 2 }, // Orages, jaune
      { phenomenon_id: '5', phenomenon_max_color_id: 1 }, // Neige, vert: dropped
    ],
    comments: {
      text: ['Épisode de vent violent en cours.'],
    },
    text: {
      text_items: [
        {
          text: ['Un vent de sud-ouest souffle avec des rafales de 100 km/h.'],
        },
      ],
    },
    ...overrides,
  };
}

export { buildForecastFixture, buildVigilanceFixture, DAY_START, NOON };
