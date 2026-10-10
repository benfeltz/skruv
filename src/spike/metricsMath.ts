// Engine spike 1.2 (branch-local): the metrics overlay's arithmetic. Pure — no Three,
// Rapier or DOM — and allocation-free once made: every sample lands in typed arrays sized
// up front, so measuring never adds the GC pressure it is there to catch.

/**
 * Frame-time histogram: `add(ms)` bins one rAF delta (fixed `binMs` bins up to `maxMs`; a
 * longer frame lands in the last bin). `percentile(p)` (p in 0–1) is the midpoint of the
 * bin holding the p-th frame — within binMs/2 of the true value — or null before any frame.
 * `slow` counts frames over `slowMs`; `seconds` is the summed frame time since the last reset.
 */
export function createFrameHistogram(binMs: number, maxMs: number, slowMs: number) {
  const bins = new Uint32Array(Math.ceil(maxMs / binMs) + 1);
  let count = 0;
  let slow = 0;
  let totalMs = 0;

  return {
    add(ms: number) {
      bins[Math.min(Math.floor(ms / binMs), bins.length - 1)]++;
      count++;
      totalMs += ms;
      if (ms > slowMs) slow++;
    },
    percentile(p: number) {
      if (count === 0) return null;
      const rank = Math.max(1, Math.ceil(p * count));
      let seen = 0;
      for (let i = 0; i < bins.length; i++) {
        seen += bins[i];
        if (seen >= rank) return Math.min((i + 0.5) * binMs, maxMs);
      }
      return maxMs;
    },
    reset() {
      bins.fill(0);
      count = 0;
      slow = 0;
      totalMs = 0;
    },
    get count() {
      return count;
    },
    get slow() {
      return slow;
    },
    get seconds() {
      return totalMs / 1000;
    },
  };
}

/**
 * Largest displacement of any of `n` bodies from where it stood at the last `rebase`:
 * `rebase(i, x, y, z)` sets body i's reference, `sample(i, x, y, z)` measures against it,
 * `clear()` forgets the worst. `maxMm` is the worst since, in millimetres (positions are
 * metres).
 */
export function createDriftTracker(n: number) {
  const reference = new Float64Array(n * 3);
  let maxM = 0;

  return {
    rebase(i: number, x: number, y: number, z: number) {
      reference[i * 3] = x;
      reference[i * 3 + 1] = y;
      reference[i * 3 + 2] = z;
    },
    clear() {
      maxM = 0;
    },
    sample(i: number, x: number, y: number, z: number) {
      const d = Math.hypot(x - reference[i * 3], y - reference[i * 3 + 1], z - reference[i * 3 + 2]);
      if (d > maxM) maxM = d;
    },
    get maxMm() {
      return maxM * 1000;
    },
  };
}

/**
 * Time-to-sleep: `advance(seconds, allAsleep)` moves the clock on. `asleepAfter` is the
 * clock reading when every body last fell asleep and has stayed so — null while any is
 * awake. `reset()` restarts the clock (where the stability watch begins).
 */
export function createSleepTimer() {
  let elapsed = 0;
  let asleepAt: number | null = null;

  return {
    advance(seconds: number, allAsleep: boolean) {
      elapsed += seconds;
      if (!allAsleep) asleepAt = null;
      else if (asleepAt === null) asleepAt = elapsed;
    },
    reset() {
      elapsed = 0;
      asleepAt = null;
    },
    get elapsed() {
      return elapsed;
    },
    get asleepAfter() {
      return asleepAt;
    },
  };
}
