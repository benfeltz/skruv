import { describe, expect, it } from 'vitest';
import { GESTURE, ROOM } from '../src/constants.js';
import {
  arcDelta,
  clampToRoom,
  intersectDragPlane,
  quantizeAngle,
  rotatedHalfExtents,
} from '../src/game/dragMath.js';

const DEG = Math.PI / 180;

describe('intersectDragPlane', () => {
  it('meets the plane where the ray crosses it', () => {
    expect(intersectDragPlane([0, 2, 0], [0, -1, 1], 0.5)).toEqual([0, 0.5, 1.5]);
  });

  it('returns null for a ray parallel to the plane', () => {
    expect(intersectDragPlane([0, 2, 0], [1, 0, 0], 0.5)).toBeNull();
  });

  it('returns null for a ray pointing away from the plane', () => {
    expect(intersectDragPlane([0, 2, 0], [0, 1, 1], 0.5)).toBeNull();
  });
});

describe('clampToRoom', () => {
  const margin = GESTURE.wallMargin;
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;

  it('leaves a part well inside the room where it is', () => {
    expect(clampToRoom([1, 0.2, -1], [0.1, 0.1], ROOM, margin)).toEqual([1, 0.2, -1]);
  });

  it('holds the footprint wallMargin inside every wall', () => {
    const half = [0.4, 0.14];
    const [x1, , z1] = clampToRoom([100, 0, 100], half, ROOM, margin);
    expect(x1 + half[0]).toBeCloseTo(halfW - margin);
    expect(z1 + half[1]).toBeCloseTo(halfD - margin);
    const [x2, , z2] = clampToRoom([-100, 0, -100], half, ROOM, margin);
    expect(x2 - half[0]).toBeCloseTo(-halfW + margin);
    expect(z2 - half[1]).toBeCloseTo(-halfD + margin);
  });

  it('never moves the height', () => {
    expect(clampToRoom([100, 0.37, 0], [0.1, 0.1], ROOM, margin)[1]).toBe(0.37);
  });

  it('centres a part too wide to fit', () => {
    expect(clampToRoom([3, 0, 3], [halfW, halfD], ROOM, margin)).toEqual([0, 0, 0]);
  });
});

describe('quantizeAngle', () => {
  const step = 90 * DEG;

  it('snaps to the nearest 90° detent', () => {
    expect(quantizeAngle(44.9 * DEG, step)).toBe(0);
    expect(quantizeAngle(46 * DEG, step)).toBeCloseTo(step);
    expect(quantizeAngle(-46 * DEG, step)).toBeCloseTo(-step);
    expect(quantizeAngle(200 * DEG, step)).toBeCloseTo(2 * step);
  });

  it('rounds the ±45° boundaries away from zero, symmetrically', () => {
    expect(quantizeAngle(45 * DEG, step)).toBeCloseTo(step);
    expect(quantizeAngle(-45 * DEG, step)).toBeCloseTo(-step);
  });

  it('returns a clean zero, never -0', () => {
    expect(Object.is(quantizeAngle(-10 * DEG, step), 0)).toBe(true);
  });

  it('is the identity in free mode', () => {
    expect(quantizeAngle(33 * DEG, 0)).toBe(33 * DEG);
    expect(quantizeAngle(-12 * DEG, null)).toBe(-12 * DEG);
  });

  it('uses 90° detents by default', () => {
    expect(GESTURE.detentStep).toBeCloseTo(step);
  });
});

describe('arcDelta', () => {
  it('is positive for a counter-clockwise sweep on screen (y down)', () => {
    expect(arcDelta([0, 0], [10, 0], [0, -10])).toBeCloseTo(90 * DEG);
  });

  it('is negative for a clockwise sweep', () => {
    expect(arcDelta([0, 0], [10, 0], [0, 10])).toBeCloseTo(-90 * DEG);
  });

  it('wraps across the ±180° seam to the short way round', () => {
    expect(arcDelta([0, 0], [-10, -1], [-10, 1])).toBeCloseTo(2 * Math.atan2(1, 10));
  });
});

describe('rotatedHalfExtents', () => {
  const side = [0.008, 1.01, 0.14];
  const expectVec = (actual, expected) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));

  it('is the half-sizes themselves when unrotated', () => {
    expectVec(rotatedHalfExtents(side, [0, 0, 0, 1]), side);
  });

  it('swaps the extents a quarter turn exchanges', () => {
    const quarterY = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    expectVec(rotatedHalfExtents([1.01, 0.008, 0.14], quarterY), [0.14, 0.008, 1.01]);
    const quarterX = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    expectVec(rotatedHalfExtents(side, quarterX), [0.008, 0.14, 1.01]);
  });

  it('grows to the bounding box of a box turned off-axis', () => {
    const eighthY = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];
    const [x, y, z] = rotatedHalfExtents([1, 0.5, 0], eighthY);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(y).toBeCloseTo(0.5);
    expect(z).toBeCloseTo(Math.SQRT1_2);
  });
});
