import { describe, expect, it } from 'vitest';
import { clampTravel, localTravel, pastOpen, pixelsPerMetre } from '../src/game/slideMath.js';
import type { Quat } from '../tools/validate/lib/geometry.js';

const IDENTITY: Quat = [0, 0, 0, 1];
const QUARTER_Y: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

describe('localTravel', () => {
  it('is the world travel for an unturned part', () => {
    const t = localTravel({ position: [1, 0, 0], rotation: IDENTITY, open: { position: [1, 0, 0.1], rotation: IDENTITY } });
    expect(t).not.toBeNull();
    t!.forEach((c, i) => expect(c).toBeCloseTo([0, 0, 0.1][i]!));
  });

  it('is turned back into the frame of a part turned a quarter about y', () => {
    // World +z is the part's -x after a quarter turn about +y.
    const t = localTravel({ position: [0, 0, 0], rotation: QUARTER_Y, open: { position: [0, 0, 0.1], rotation: QUARTER_Y } });
    [-0.1, 0, 0].forEach((c, i) => expect(t![i]).toBeCloseTo(c));
  });

  it('is null without an open pose', () => {
    expect(localTravel({ position: [0, 0, 0], rotation: IDENTITY })).toBeNull();
  });
});

describe('clampTravel', () => {
  it('holds a position to both ends', () => {
    expect(clampTravel(-0.02, 0.1)).toBe(0);
    expect(clampTravel(0.05, 0.1)).toBe(0.05);
    expect(clampTravel(0.3, 0.1)).toBe(0.1);
  });
});

describe('pastOpen', () => {
  it('is false at the pull-out distance and true just past it', () => {
    expect(pastOpen(0.14, 0.1, 0.04)).toBe(false);
    expect(pastOpen(0.1401, 0.1, 0.04)).toBe(true);
  });
});

describe('pixelsPerMetre', () => {
  it('is the screen distance over the probe', () => {
    expect(pixelsPerMetre([0, 0], [30, 40], 0.5)).toBe(100);
  });

  it('is 0 when the axis has no length on screen or no probe', () => {
    expect(pixelsPerMetre([5, 5], [5, 5], 0.5)).toBe(0);
    expect(pixelsPerMetre([0, 0], [30, 40], 0)).toBe(0);
  });
});
