// -----------------------------------------------------------------------------
// Houses of the Gladys instance, for the scene triggers and actions.
//
// The weather path never needs them: the core passes the coordinates of the
// house in every onWeatherGet call. But the scene triggers must watch the
// weather on their own (rain within the hour, frost, heat, wind), and the core
// only asks for the weather when a dashboard widget, the chat or a
// weather-alert scene needs it — so learning the houses from onWeatherGet would
// leave the triggers blind on an instance with no such scene. Hence
// `location: true` in the manifest and `getHouses()` here.
//
// There is no update event for the houses: they are re-read on every
// connection and on each forecast poll of the scene watcher (a local call).
// -----------------------------------------------------------------------------

/**
 * @description Normalize a house name or selector for a lenient comparison.
 * @param {string} value - The value to normalize.
 * @returns {string} The trimmed, lower-cased, accent-free value.
 * @example
 * normalizeName(' Résidence '); // -> 'residence'
 */
function normalizeName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * @description Create the house registry.
 * @param {object} options - Options.
 * @param {Function} options.fetchHouses - `() => Promise<Array<object>>`, the
 * SDK getHouses().
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @returns {object} The registry ({ refresh, list, resolve }).
 * @example
 * const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses() });
 */
function createHouseRegistry({ fetchHouses, logger = console }) {
  // Located houses only: an unlocated house has no weather.
  let located = [];

  /**
   * @description Re-read the houses from Gladys. A failure keeps the previous
   * list: a transient error must not blind the triggers.
   * @returns {Promise<Array<object>>} The located houses.
   * @example
   * await houses.refresh();
   */
  async function refresh() {
    try {
      const houses = await fetchHouses();
      located = (Array.isArray(houses) ? houses : []).filter(
        (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
      );
    } catch (err) {
      logger.warn(`Unable to read the houses of Gladys: ${err.message}`);
    }
    return located;
  }

  /**
   * @description The located houses, as last read.
   * @returns {Array<object>} `[{ id, name, selector, latitude, longitude }]`.
   * @example
   * houses.list();
   */
  function list() {
    return located;
  }

  /**
   * @description Find the house a scene action targets. An empty value means
   * "the house", i.e. the first located one — the common single-house case.
   * Otherwise the name or the selector is matched, ignoring case and accents.
   * @param {string|null|undefined} wanted - The house name or selector.
   * @returns {object} The house.
   * @throws {Error} When no house is located or none matches.
   * @example
   * houses.resolve('Maison');
   */
  function resolve(wanted) {
    if (located.length === 0) {
      throw new Error('No house of Gladys has a location: set it in the house settings');
    }
    if (wanted === null || wanted === undefined || String(wanted).trim() === '') {
      return located[0];
    }
    const target = normalizeName(wanted);
    const house = located.find(
      (candidate) =>
        normalizeName(candidate.name) === target || normalizeName(candidate.selector) === target,
    );
    if (house === undefined) {
      throw new Error(`No located house named "${wanted}"`);
    }
    return house;
  }

  return { refresh, list, resolve };
}

export { createHouseRegistry, normalizeName };
