import { describe, expect, it } from 'vitest';
import { createFpsGuard } from '../src/scene/fpsGuard.js';

const config = () => ({ fpsSampleSeconds: 1, fpsFloor: 40, fpsWindow: 3, fpsRecover: 55 });

// Runs `seconds` of frames at `fps`; returns the rendered share and the samples taken.
function run(guard, fps, seconds) {
  let rendered = 0;
  const samples = [];
  const frames = Math.round(fps * seconds);
  for (let i = 0; i < frames; i++) {
    const { render, sample } = guard.frame(1 / fps);
    if (render) rendered++;
    if (sample) samples.push(sample);
  }
  return { share: rendered / frames, samples };
}

describe('createFpsGuard', () => {
  it('renders every frame at a healthy rate, sampling once a second', () => {
    const guard = createFpsGuard(config());
    const { share, samples } = run(guard, 60, 5);
    expect(share).toBe(1);
    expect(samples).toHaveLength(5);
    expect(samples[0].fps).toBeCloseTo(60, 0);
    expect(samples.every((s) => !s.skipping)).toBe(true);
  });

  it('rides out a dip shorter than the window', () => {
    const guard = createFpsGuard(config());
    run(guard, 25, 2);
    run(guard, 60, 1);
    run(guard, 25, 2);
    expect(guard.skipping).toBe(false);
  });

  it('renders every other frame once the rate stays under the floor for the window', () => {
    const guard = createFpsGuard(config());
    run(guard, 30, 3);
    expect(guard.skipping).toBe(true);
    expect(run(guard, 30, 2).share).toBeCloseTo(0.5, 2);
  });

  it('holds the fallback between the floor and recovery, and lets go after a window at recovery', () => {
    const guard = createFpsGuard(config());
    run(guard, 30, 3);
    run(guard, 50, 5);
    expect(guard.skipping).toBe(true);
    run(guard, 60, 3);
    expect(guard.skipping).toBe(false);
  });

  it('never engages with a floor of 0, and a floor set to 0 releases it', () => {
    const off = { ...config(), fpsFloor: 0 };
    const guard = createFpsGuard(off);
    run(guard, 10, 10);
    expect(guard.skipping).toBe(false);
    const live = config();
    const tuned = createFpsGuard(live);
    run(tuned, 30, 3);
    live.fpsFloor = 0;
    run(tuned, 30, 3);
    expect(tuned.skipping).toBe(false);
  });

  it('a floor above the display rate forces it on and keeps it on (the dev-forced check)', () => {
    const live = { ...config(), fpsFloor: 60 };
    const guard = createFpsGuard(live);
    run(guard, 59.9, 10);
    expect(guard.skipping).toBe(true);
  });
});
