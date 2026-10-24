// The frame-time histogram behind the metrics readout (src/ui/metricsOverlay.ts), from the
// engine spike. Pure — no Three, Rapier or DOM — and allocation-free once made: every sample
// lands in a typed array sized up front, so measuring never adds the GC pressure it is there
// to catch.

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
