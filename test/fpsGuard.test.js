import { describe, expect, it } from 'vitest';
import { createFpsGuard } from '../src/scene/fpsGuard.js';

const config = () => ({ fpsSampleSeconds: 1, fpsFloor: 40, fpsWindow: 3, fpsRecover: 55, fpsHelpRatio: 1.25, fpsMaxGap: 1 });

/**
 * Runs `seconds` of a device: a rendered frame takes 1/`renderFps` s, a skipped one
 * 1/`loopFps` s (the rAF cap: a frame never comes faster than that). A frame's delta is the
 * cost of the frame before it. Returns the share of frames rendered and the samples.
 */
function run(guard, { renderFps, loopFps = 60 }, seconds) {
  const renderCost = Math.max(1 / renderFps, 1 / loopFps);
  const skipCost = 1 / loopFps;
  let rendered = 0;
  let count = 0;
  let previous = true;
  const samples = [];
  for (let t = 0; t < seconds; count++) {
    const delta = previous ? renderCost : skipCost;
    t += delta;
    const { render, sample } = guard.frame(delta);
    previous = render;
    if (render) rendered++;
    if (sample) samples.push(sample);
  }
  return { share: rendered / count, samples };
}

describe('createFpsGuard', () => {
  it('renders every frame at a healthy rate, sampling once a second', () => {
    const guard = createFpsGuard(config());
    const { share, samples } = run(guard, { renderFps: 60 }, 5);
    expect(share).toBe(1);
    expect(samples).toHaveLength(5);
    expect(samples[0].fps).toBeCloseTo(60, 0);
    expect(samples.every((s) => !s.skipping)).toBe(true);
  });

  it('rides out a dip shorter than the window', () => {
    const guard = createFpsGuard(config());
    run(guard, { renderFps: 25 }, 2);
    run(guard, { renderFps: 60 }, 1);
    run(guard, { renderFps: 25 }, 2);
    expect(guard.skipping).toBe(false);
  });

  it('render-bound: renders every other frame once the rate stays under the floor for the window', () => {
    const guard = createFpsGuard(config());
    run(guard, { renderFps: 30 }, 3);
    expect(guard.skipping).toBe(true);
    expect(run(guard, { renderFps: 30 }, 2).share).toBeCloseTo(0.5, 1);
  });

  // Review 1.6: skipping doubles the loop rate past fpsRecover; judging recovery on the loop
  // flipped it off and on every window.
  it('render-bound at 30–40 fps: holds the fallback steadily instead of flipping every window', () => {
    for (const loopFps of [60, 120]) {
      for (const renderFps of [30, 35, 39]) {
        const guard = createFpsGuard(config());
        run(guard, { renderFps, loopFps }, 3);
        const { samples } = run(guard, { renderFps, loopFps }, 20);
        expect(samples.every((s) => s.skipping), `${renderFps} fps on ${loopFps} Hz`).toBe(true);
      }
    }
  });

  it('lets go once a fully rendered frame would hold at the recovery rate for the window', () => {
    const guard = createFpsGuard(config());
    run(guard, { renderFps: 30 }, 3);
    run(guard, { renderFps: 45 }, 5);
    expect(guard.skipping).toBe(true);
    run(guard, { renderFps: 60 }, 4);
    expect(guard.skipping).toBe(false);
  });

  // Review 1.6: a 30 Hz rAF cap (iOS Low Power Mode) with cheap frames is under the floor,
  // but skipping only halves it to 15 and the loop never reads as recovered.
  it('capped, not loaded: lets go within a sample and stays off', () => {
    const guard = createFpsGuard(config());
    run(guard, { renderFps: 200, loopFps: 30 }, 3);
    expect(guard.skipping).toBe(true);
    run(guard, { renderFps: 200, loopFps: 30 }, 1.1);
    expect(guard.skipping).toBe(false);
    const { share, samples } = run(guard, { renderFps: 200, loopFps: 30 }, 30);
    expect(share).toBe(1);
    expect(samples.every((s) => !s.skipping)).toBe(true);
  });

  it('may engage again after a futile try once the rate has been back at the floor', () => {
    const guard = createFpsGuard(config());
    run(guard, { renderFps: 200, loopFps: 30 }, 5);
    expect(guard.skipping).toBe(false);
    run(guard, { renderFps: 60 }, 1);
    run(guard, { renderFps: 30 }, 3);
    expect(guard.skipping).toBe(true);
  });

  // Review 1.6: fed clamped deltas (1/15 s at most) it reported 15 fps for a 10 fps phone.
  it('reports a slow device at its true rate, and times its sample in real seconds', () => {
    const guard = createFpsGuard(config());
    const { samples } = run(guard, { renderFps: 8 }, 5);
    expect(samples[0].fps).toBeCloseTo(8, 0);
    expect(samples).toHaveLength(5);
  });

  it('drops a backgrounded gap instead of reading it as load', () => {
    const guard = createFpsGuard(config());
    run(guard, { renderFps: 60 }, 0.5);
    expect(guard.frame(30)).toEqual({ render: true, sample: null });
    const { samples } = run(guard, { renderFps: 60 }, 5);
    expect(samples.every((s) => s.fps > 55 && !s.skipping)).toBe(true);
  });

  it('never engages with a floor of 0, and a floor set to 0 releases it', () => {
    const guard = createFpsGuard({ ...config(), fpsFloor: 0 });
    run(guard, { renderFps: 10 }, 10);
    expect(guard.skipping).toBe(false);
    const live = config();
    const tuned = createFpsGuard(live);
    run(tuned, { renderFps: 30 }, 3);
    expect(tuned.skipping).toBe(true);
    live.fpsFloor = 0;
    run(tuned, { renderFps: 30 }, 3);
    expect(tuned.skipping).toBe(false);
  });
});
