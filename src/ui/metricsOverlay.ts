import { CLUSTER, COLORS, LIFT_LINE, MENU, METRICS } from '../constants.js';
import { createFrameHistogram } from '../game/metricsMath.js';

// The frame-time readout the menu's Metrics row switches on: frames, seconds, slow frames and
// the p50/p95/p99/worst frame, redrawn every METRICS.readoutSeconds. Observation only — it
// reads frame times, never writes game state. The src/ui pattern: own element, one injected
// <style>, colours from COLORS, a small API. src/main.ts loads it by dynamic import.

const STYLE_ID = 'skruv-metrics-overlay';
const MS_PER_SECOND = 1000;
// Portrait: the lift line hangs under the menu, its touch band centred on the menu button; the
// readout starts past that band, so the line's knob is never under it.
const PAST_LIFT_LINE = CLUSTER.inset + MENU.size / 2 + LIFT_LINE.hitWidth / 2 + CLUSTER.gap;
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .metrics-overlay {
      position: fixed;
      /* Clear of the control cluster's corner and the lift line under it: below its row, past the line's band, in portrait; beside its column in landscape. */
      top: calc(${CLUSTER.inset + MENU.size + CLUSTER.gap}px + env(safe-area-inset-top));
      left: calc(${PAST_LIFT_LINE}px + env(safe-area-inset-left));
      z-index: 3;
      max-width: calc(100vw - ${PAST_LIFT_LINE + CLUSTER.inset}px);
      margin: 0;
      padding: 6px 8px;
      border-radius: 8px;
      background: ${css(COLORS.uiSurface)}c7;
      color: ${css(COLORS.uiText)};
      font: 11px/1.35 ui-monospace, Menlo, monospace;
      white-space: pre;
      pointer-events: none;
    }
    html[data-strip='right'] .metrics-overlay {
      top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));
      left: calc(${CLUSTER.inset + MENU.size + CLUSTER.gap}px + env(safe-area-inset-left));
      max-width: calc(100vw - ${CLUSTER.inset * 2 + MENU.size + CLUSTER.gap}px);
    }
  `;
  document.head.append(style);
}

const ms = (value: number | null) => value?.toFixed(1) ?? '–';

/**
 * The readout. Mount `element`; call `frame(rawDeltaSeconds)` once per rAF tick with the
 * loop's true delta; `dispose()` takes it off the page.
 */
export function createMetricsOverlay(config = METRICS) {
  injectStyle();
  const histogram = createFrameHistogram(config.histogramBinMs, config.histogramMaxMs, config.slowFrameMs);
  const element = document.createElement('pre');
  element.className = 'metrics-overlay';
  let sinceReadout = 0;

  function render() {
    element.textContent = [
      `frames ${histogram.count}  ${histogram.seconds.toFixed(1)} s  >${config.slowFrameMs}ms ${histogram.slow}`,
      `p50 ${ms(histogram.percentile(0.5))}  p95 ${ms(histogram.percentile(0.95))}  p99 ${ms(histogram.percentile(0.99))}  max ${ms(histogram.percentile(1))} ms`,
    ].join('\n');
  }
  render();

  return {
    element,
    /** One rAF tick; the loop's first has no delta. */
    frame(rawDelta: number) {
      if (rawDelta <= 0) return;
      histogram.add(rawDelta * MS_PER_SECOND);
      sinceReadout += rawDelta;
      if (sinceReadout >= config.readoutSeconds) {
        render();
        sinceReadout = 0;
      }
    },
    dispose() {
      element.remove();
    },
  };
}

export type MetricsOverlay = ReturnType<typeof createMetricsOverlay>;
