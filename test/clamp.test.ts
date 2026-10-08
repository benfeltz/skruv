import { describe, expect, it } from 'vitest';
import { clampDelta, clampPixelRatio as clampPixelRatioStrict } from '../src/scene/clamp.js';

// The fallback covers a missing ratio, which the strict signature rules out.
const clampPixelRatio = clampPixelRatioStrict as (devicePixelRatio: number | undefined, max: number) => number;

describe('clampPixelRatio', () => {
  it('passes through ratios at or below the cap', () => {
    expect(clampPixelRatio(1, 2)).toBe(1);
    expect(clampPixelRatio(1.5, 2)).toBe(1.5);
    expect(clampPixelRatio(2, 2)).toBe(2);
  });

  it('caps high-density screens', () => {
    expect(clampPixelRatio(3, 2)).toBe(2);
  });

  it('keeps sub-1 ratios from zoomed-out desktops', () => {
    expect(clampPixelRatio(0.75, 2)).toBe(0.75);
  });

  it('falls back to 1 for missing or invalid ratios', () => {
    expect(clampPixelRatio(undefined, 2)).toBe(1);
    expect(clampPixelRatio(NaN, 2)).toBe(1);
    expect(clampPixelRatio(0, 2)).toBe(1);
    expect(clampPixelRatio(-1, 2)).toBe(1);
  });
});

describe('clampDelta', () => {
  it('passes through normal frame deltas', () => {
    expect(clampDelta(1 / 60, 0.1)).toBeCloseTo(1 / 60);
  });

  it('caps long gaps such as a resumed background tab', () => {
    expect(clampDelta(5, 0.1)).toBe(0.1);
  });

  it('never returns a negative or non-finite delta', () => {
    expect(clampDelta(-0.01, 0.1)).toBe(0);
    expect(clampDelta(NaN, 0.1)).toBe(0);
    expect(clampDelta(Infinity, 0.1)).toBe(0);
  });
});
