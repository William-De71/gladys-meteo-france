// -----------------------------------------------------------------------------
// Upstream vigilance watcher — the freshness nudge (contract B.18 point 5).
//
// Gladys evaluates its weather-alert scene triggers on a 30-minute scheduled
// check. A provider that KNOWS something changed upstream can do better, but
// NEVER by pushing data: `requestWeatherRefresh()` means only "re-pull me now".
// The data then re-enters through the audited onWeatherGet path.
//
// So this watcher:
//   - polls the vigilance of the departments the core actually asked about
//     (learned from onWeatherGet calls — we never guess a location);
//   - compares the highest color to the previous poll;
//   - nudges the core on ANY change (up or down: an alert ending is a scene
//     trigger too, `weather.alert-ended`).
//
// It carries no state to the core and holds no user data: just department
// numbers and their last known vigilance color.
// -----------------------------------------------------------------------------

// Upstream poll interval. The core's floor is 30 min; polling every 15 min lets
// a raising vigilance reach the scenes twice as fast, and it is the cadence the
// internal service used.
const POLL_INTERVAL_MS = 15 * 60 * 1000;

// A department is forgotten when the core stops asking about it (house deleted,
// coordinates changed): no point polling it forever.
const DEPARTMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @description Create the upstream vigilance watcher.
 * @param {object} options - Options.
 * @param {Function} options.fetchVigilance - `(department) => Promise<any>`.
 * @param {Function} options.readMaxColor - `(warningData) => number`.
 * @param {Function} options.onChange - Called when a vigilance color changed.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {number} [options.intervalMs] - Poll interval (for tests).
 * @returns {object} The watcher ({ track, poll, start, stop, size }).
 * @example
 * const watcher = createVigilanceWatcher({ fetchVigilance, readMaxColor, onChange });
 */
function createVigilanceWatcher({
  fetchVigilance,
  readMaxColor,
  onChange,
  logger = console,
  intervalMs = POLL_INTERVAL_MS,
}) {
  // department -> { color: number|null, lastSeen: number }
  const departments = new Map();
  let timer = null;

  /**
   * @description Start watching a department. Called on every onWeatherGet, so
   * the watcher only ever polls locations the core cares about.
   * @param {string} department - The department number.
   * @example
   * watcher.track('06');
   */
  function track(department) {
    if (typeof department !== 'string' || department.length === 0) {
      return;
    }
    const existing = departments.get(department);
    departments.set(department, {
      // A brand new department starts with an unknown color: the first poll is
      // a baseline and never nudges (the core would re-pull for nothing).
      color: existing ? existing.color : null,
      lastSeen: Date.now(),
    });
  }

  /**
   * @description Drop the departments the core stopped asking about.
   * @example
   * forgetStaleDepartments();
   */
  function forgetStaleDepartments() {
    const now = Date.now();
    departments.forEach((state, department) => {
      if (now - state.lastSeen > DEPARTMENT_TTL_MS) {
        departments.delete(department);
      }
    });
  }

  /**
   * @description Poll every tracked department once and nudge the core when a
   * vigilance color changed.
   * @returns {Promise<boolean>} True when the core was nudged.
   * @example
   * await watcher.poll();
   */
  async function poll() {
    forgetStaleDepartments();
    let changed = false;
    // Sequential on purpose: a handful of departments at most, and it keeps the
    // upstream API load minimal.
    for (const [department, state] of departments) {
      try {
        const warningData = await fetchVigilance(department);
        const color = readMaxColor(warningData);
        const previous = state.color;
        departments.set(department, { color, lastSeen: state.lastSeen });
        if (previous !== null && color !== previous) {
          logger.info(
            `Vigilance changed for department ${department}: ${previous} -> ${color}, nudging Gladys`,
          );
          changed = true;
        }
      } catch (err) {
        // An upstream failure must never kill the watcher: the core still has
        // its own 30-minute floor.
        logger.debug(`Vigilance poll failed for department ${department}: ${err.message}`);
      }
    }
    if (changed) {
      // One nudge per poll, whatever the number of departments that changed:
      // the core re-pulls everything anyway, and it is rate-limited to 1/min.
      onChange();
    }
    return changed;
  }

  /**
   * @description Start the periodic poll.
   * @example
   * watcher.start();
   */
  function start() {
    if (timer !== null) {
      return;
    }
    timer = setInterval(() => {
      poll().catch((err) => logger.warn(`Vigilance watcher failed: ${err.message}`));
    }, intervalMs);
    // Never hold the process alive just for the watcher.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  /**
   * @description Stop the periodic poll.
   * @example
   * watcher.stop();
   */
  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    track,
    poll,
    start,
    stop,
    get size() {
      return departments.size;
    },
  };
}

export { createVigilanceWatcher, POLL_INTERVAL_MS, DEPARTMENT_TTL_MS };
