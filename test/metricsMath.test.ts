import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDriftTracker, createFrameHistogram, createSleepTimer } from '../src/spike/metricsMath.js';

describe('frame histogram (engine spike 1.2)', () => {
  it('is null before any frame', () => {
    expect(createFrameHistogram(0.25, 1000, 33).percentile(0.5)).toBeNull();
  });

  it('reads percentiles to within half a bin', () => {
    const h = createFrameHistogram(0.25, 1000, 33);
    // 90 smooth frames, 9 at 25 ms, one 50 ms hitch.
    for (let i = 0; i < 90; i++) h.add(16.67);
    for (let i = 0; i < 9; i++) h.add(25);
    h.add(50);
    expect(h.count).toBe(100);
    expect(Math.abs(h.percentile(0.5)! - 16.67)).toBeLessThanOrEqual(0.125);
    expect(Math.abs(h.percentile(0.95)! - 25)).toBeLessThanOrEqual(0.125);
    expect(Math.abs(h.percentile(0.99)! - 25)).toBeLessThanOrEqual(0.125);
    expect(Math.abs(h.percentile(1)! - 50)).toBeLessThanOrEqual(0.125);
    expect(h.slow).toBe(1);
    expect(h.seconds).toBeCloseTo((90 * 16.67 + 9 * 25 + 50) / 1000, 6);
  });

  it('counts only frames strictly over the slow threshold', () => {
    const h = createFrameHistogram(0.25, 1000, 33);
    h.add(33);
    h.add(33.1);
    expect(h.slow).toBe(1);
  });

  it('caps a frame past the ceiling at the ceiling', () => {
    const h = createFrameHistogram(0.25, 1000, 33);
    h.add(5000);
    expect(h.percentile(0.5)).toBe(1000);
  });

  it('starts over on reset', () => {
    const h = createFrameHistogram(0.25, 1000, 33);
    h.add(40);
    h.reset();
    expect([h.count, h.slow, h.seconds, h.percentile(0.5)]).toEqual([0, 0, 0, null]);
  });
});

describe('drift tracker (engine spike 1.2)', () => {
  it('keeps the largest displacement of any body, in mm, until cleared', () => {
    const d = createDriftTracker(2);
    d.rebase(0, 0, 0, 0);
    d.rebase(1, 1, 1, 1);
    d.sample(0, 0.003, 0.004, 0);
    d.sample(1, 1, 1, 1.001);
    d.sample(0, 0, 0, 0);
    expect(d.maxMm).toBeCloseTo(5, 9);
    d.clear();
    expect(d.maxMm).toBe(0);
  });
});

describe('sleep timer (engine spike 1.2)', () => {
  it('reports when everything fell asleep and stayed asleep', () => {
    const t = createSleepTimer();
    t.advance(1, false);
    t.advance(1, true);
    expect(t.asleepAfter).toBe(2);
    t.advance(1, false);
    expect(t.asleepAfter).toBeNull();
    t.advance(1, true);
    t.advance(5, true);
    expect(t.asleepAfter).toBe(4);
    t.reset();
    expect([t.elapsed, t.asleepAfter]).toEqual([0, null]);
  });
});

describe('the metrics math stays pure', () => {
  it('imports nothing and touches no DOM', () => {
    const source = readFileSync(new URL('../src/spike/metricsMath.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\b(window|document|requestAnimationFrame)\b/);
  });
});
