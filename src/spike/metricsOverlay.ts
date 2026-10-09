import { SPIKE } from '../constants.js';
import { createDriftTracker, createFrameHistogram, createSleepTimer } from './metricsMath.js';
import type { Body } from '../physics/world.js';

// Engine spike 1.2 (branch-local): the shared measurement protocol's in-page half, up only
// under ?spike=assembled and loaded only then. Observation only — it reads frame times and
// body poses, never writes game state.
//
//   frames ↺     restarts the frame-time window (action script step 3: the drag minute)
//   stability ↺  rebases drift on where the bodies stand now and restarts the sleep clock
//                (action script steps 2 and 4)
//   dump         shows metrics.json in the shared schema, copies it, logs it
//
// Only measured fields are filled. Memory, cold start, device, app size, edit→phone and the
// agent loop are measured outside the page and stay null here; memory.how names the tool.

const MS_PER_SECOND = 1000;
// YYYY-MM-DD on the device's own calendar (toISOString is UTC: an evening pass would date tomorrow).
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const round2 = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

const CSS = `
  .spike-metrics { position: fixed; top: 8px; left: 8px; z-index: 20; max-width: calc(100vw - 16px);
    font: 11px/1.35 ui-monospace, Menlo, monospace; color: #e8e8e8; background: rgba(20, 22, 26, 0.78);
    border-radius: 8px; padding: 6px 8px; pointer-events: none; }
  .spike-metrics pre { margin: 0; white-space: pre; }
  .spike-metrics .row { display: flex; gap: 6px; margin-top: 6px; pointer-events: auto; }
  .spike-metrics button { font: inherit; color: inherit; background: #3a3f48; border: 0; border-radius: 6px; padding: 6px 8px; }
  .spike-metrics .dump { max-height: 40vh; overflow: auto; margin-top: 6px; pointer-events: auto; user-select: text; -webkit-user-select: text; }
`;

function button(label: string, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

/**
 * The overlay over `bodies` (the assembled set's, whose drift and sleep it watches).
 * Mount `element`; call `frame(rawDeltaSeconds)` once per rAF tick with the loop's true
 * delta. `haptic(ms)` records one grab→haptic-bridge round trip (src/spike/haptics.ts).
 */
export function createMetricsOverlay({ bodies }: { bodies: Body[] }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const histogram = createFrameHistogram(SPIKE.histogramBinMs, SPIKE.histogramMaxMs, SPIKE.slowFrameMs);
  const drift = createDriftTracker(bodies.length);
  const sleep = createSleepTimer();
  // The bridge round trips, few enough (one per grab) to keep as a plain list.
  const haptics: number[] = [];
  let sinceSample = 0;
  let sinceReadout = 0;
  let rebasePending = true;
  // performance.now() at the first frame the loop ran: page navigation → first frame.
  let firstFrameMs: number | null = null;

  const element = document.createElement('div');
  element.className = 'spike-metrics';
  const readout = document.createElement('pre');
  const dump = document.createElement('pre');
  dump.className = 'dump';
  dump.hidden = true;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    button('frames ↺', () => histogram.reset()),
    button('stability ↺', () => (rebasePending = true)),
    button('dump', showDump),
  );
  element.append(readout, row, dump);

  function sampleBodies(seconds: number) {
    let allAsleep = true;
    if (rebasePending) drift.clear();
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const { x, y, z } = body.translation();
      if (rebasePending) drift.rebase(i, x, y, z);
      else drift.sample(i, x, y, z);
      if (!body.isSleeping()) allAsleep = false;
    }
    if (rebasePending) {
      sleep.reset();
      rebasePending = false;
    }
    sleep.advance(seconds, allAsleep);
  }

  function median(values: number[]) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** The shared metrics.json, measured fields only — the rest null for the device pass. */
  function metrics() {
    return {
      spike: SPIKE.name,
      device: null,
      date: localDate(new Date()),
      framePacing: {
        p50ms: round2(histogram.percentile(0.5)),
        p95ms: round2(histogram.percentile(0.95)),
        p99ms: round2(histogram.percentile(0.99)),
        framesOver33ms: histogram.slow,
        sessionSeconds: round2(histogram.seconds),
      },
      stability: { maxDriftMm: round2(drift.maxMm), visibleJitter: null, allAsleepSeconds: round2(sleep.asleepAfter) },
      memory: { steadyMb: null, peakMb: null, warningsOrKills: null, how: SPIKE.memoryHow },
      coldStart: { median3Seconds: null },
      appSize: { installedMb: null, webExportMb: null },
      editToPhone: { seconds: null, how: null },
      haptics: { grabToTickMs: round2(median(haptics)), perceptibleLag: null },
      agentLoop: { metaTestRounds: null, stalls: null },
    };
  }

  function showDump() {
    const json = JSON.stringify(metrics(), null, 2);
    dump.textContent = json;
    dump.hidden = !dump.hidden;
    console.info('[spike metrics]', json);
    navigator.clipboard?.writeText(json).catch(() => {});
  }

  function render() {
    const asleep = sleep.asleepAfter;
    readout.textContent = [
      `frames ${histogram.count}  ${histogram.seconds.toFixed(1)} s  >${SPIKE.slowFrameMs}ms ${histogram.slow}`,
      `p50 ${histogram.percentile(0.5)?.toFixed(2) ?? '–'}  p95 ${histogram.percentile(0.95)?.toFixed(2) ?? '–'}  p99 ${histogram.percentile(0.99)?.toFixed(2) ?? '–'} ms`,
      `drift ${drift.maxMm.toFixed(1)} mm  ${asleep === null ? `awake ${sleep.elapsed.toFixed(1)} s` : `asleep at ${asleep.toFixed(1)} s`}`,
      `haptic ${haptics.length ? `${median(haptics)!.toFixed(1)} ms (n=${haptics.length})` : '–'}  boot→frame ${firstFrameMs === null ? '–' : `${(firstFrameMs / MS_PER_SECOND).toFixed(2)} s`}`,
    ].join('\n');
  }

  /** One rAF tick. The frame-time path allocates nothing; poses are read every few frames. */
  function frame(rawDelta: number) {
    if (firstFrameMs === null) firstFrameMs = performance.now();
    // The loop's first tick has no delta.
    if (rawDelta <= 0) return;
    histogram.add(rawDelta * MS_PER_SECOND);
    sinceSample += rawDelta;
    if (sinceSample >= SPIKE.stabilitySampleSeconds) {
      sampleBodies(sinceSample);
      sinceSample = 0;
    }
    sinceReadout += rawDelta;
    if (sinceReadout >= SPIKE.readoutSeconds) {
      render();
      sinceReadout = 0;
    }
  }

  render();
  return {
    element,
    frame,
    haptic(ms: number) {
      haptics.push(ms);
    },
  };
}

export type MetricsOverlay = ReturnType<typeof createMetricsOverlay>;
