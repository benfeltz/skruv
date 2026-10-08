import { TUNE } from '../constants.js';

// Frame deltas summed over a sample fall a hair short of whole seconds.
const EPSILON = 1e-9;

/** One frame-rate sample: the loop's rate, and whether render skipping is engaged. */
export interface FpsSample {
  fps: number;
  skipping: boolean;
}

/** Whether to render this frame, and the sample it closed, if any. */
export interface FrameDecision {
  render: boolean;
  sample: FpsSample | null;
}

/**
 * Samples the loop's frame rate and decides, frame by frame, whether to render it. Under
 * sustained load (below `fpsFloor` for `fpsWindow` seconds) it renders every other frame;
 * `frame(delta)` returns `{ render, sample }`, `sample` being `{ fps, skipping }` once per
 * `fpsSampleSeconds` (`fps` the loop's rate), else null.
 *
 * While skipping, the loop's rate says nothing about the room's: half the frames are
 * cheap. So it times the two kinds apart — a frame's delta is the cost of the frame
 * before it, rendered or skipped:
 *   - the rendered-frame interval is what every frame would cost rendered: it lets go once
 *     that rate holds at `fpsRecover` (or the floor, if higher) for `fpsWindow`, so it
 *     doesn't flip back into the load it just left
 *   - if rendered frames cost no more than skipped ones (by `fpsHelpRatio`), skipping buys
 *     nothing — the loop is capped (iOS Low Power Mode's 30 Hz, a throttled tab), not
 *     loaded. It lets go at once and stays off until the rate is back at the floor.
 * `delta` must be the true frame time, not the game's clamped step. A gap over `fpsMaxGap`
 * (a backgrounded tab) drops the sample in progress. Reads `config` (TUNE by default) at
 * use time, so its knobs tune live. Pure.
 */
export function createFpsGuard(config = TUNE) {
  let frames = 0;
  let elapsed = 0;
  // While skipping: summed deltas and counts of frames that followed a rendered frame, and
  // that followed a skipped one.
  let renderedTime = 0;
  let renderedCount = 0;
  let skippedTime = 0;
  let skippedCount = 0;
  // Seconds the rate has been past the threshold that would flip the mode.
  let held = 0;
  let skipping = false;
  // Skipping was tried at this rate and bought nothing.
  let futile = false;
  let lastRendered = true;
  let odd = false;

  function engage(fps: number, seconds: number) {
    const floor = config.fpsFloor;
    if (fps >= floor) futile = false;
    const low = floor > 0 && !futile && fps < floor;
    held = low ? held + seconds : 0;
    if (held < config.fpsWindow - EPSILON) return;
    skipping = true;
    held = 0;
  }

  function release(seconds: number) {
    const floor = config.fpsFloor;
    const rendered = renderedCount ? renderedTime / renderedCount : 0;
    const skipped = skippedCount ? skippedTime / skippedCount : 0;
    if (floor > 0 && rendered > 0 && skipped > 0 && rendered < skipped * config.fpsHelpRatio) {
      futile = true;
      skipping = false;
      held = 0;
      return;
    }
    const fullRate = rendered > 0 ? 1 / rendered : Infinity;
    const recovered = floor <= 0 || fullRate >= Math.max(config.fpsRecover, floor);
    held = recovered ? held + seconds : 0;
    if (held < config.fpsWindow - EPSILON) return;
    skipping = false;
    held = 0;
  }

  function resetSample() {
    frames = 0;
    elapsed = 0;
    renderedTime = renderedCount = skippedTime = skippedCount = 0;
  }

  function frame(delta: number): FrameDecision {
    if (delta > config.fpsMaxGap) {
      resetSample();
      odd = !odd;
      lastRendered = !skipping || odd;
      return { render: lastRendered, sample: null };
    }
    frames++;
    elapsed += delta;
    if (skipping) {
      if (lastRendered) {
        renderedTime += delta;
        renderedCount++;
      } else {
        skippedTime += delta;
        skippedCount++;
      }
    }
    let sample: FpsSample | null = null;
    if (elapsed >= config.fpsSampleSeconds - EPSILON) {
      const fps = frames / elapsed;
      if (skipping) release(elapsed);
      else engage(fps, elapsed);
      sample = { fps, skipping };
      resetSample();
    }
    odd = !odd;
    const render = !skipping || odd;
    lastRendered = render;
    return { render, sample };
  }

  return {
    frame,
    get skipping() {
      return skipping;
    },
  };
}
