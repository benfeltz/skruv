import { describe, expect, it } from 'vitest';
import { GESTURE, ROOM } from '../src/constants.js';
import {
  arcDelta,
  clampLift,
  clampToRoom,
  easeToward,
  fitsInRoom,
  hasEscaped,
  intersectDragPlane,
  pullAlong,
  quantizeAngle,
  rebaseDragOffset,
  rotatedHalfExtents,
} from '../src/game/dragMath.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

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
  const side: Vec3 = [0.008, 1.01, 0.14];
  const expectVec = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));

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

describe('fitsInRoom', () => {
  const halfW = ROOM.width / 2;

  it('accepts a part resting on the floor well inside the walls', () => {
    expect(fitsInRoom([1, 0.008, -1], [0.4, 0.008, 0.14], ROOM)).toBe(true);
  });

  it('refuses a pose sunk into the floor beyond the tolerance', () => {
    expect(fitsInRoom([0, 0.5, 0], [0.1, 0.6, 0.1], ROOM, 0.002)).toBe(false);
    expect(fitsInRoom([0, 0.599, 0], [0.1, 0.6, 0.1], ROOM, 0.002)).toBe(true);
  });

  it('refuses a pose reaching through a wall', () => {
    expect(fitsInRoom([halfW - 0.5, 1, 0], [1.01, 0.14, 0.008], ROOM)).toBe(false);
    expect(fitsInRoom([0, 1, -(ROOM.depth / 2) + 0.5], [0.008, 0.14, 1.01], ROOM)).toBe(false);
    expect(fitsInRoom([halfW - 1.01, 1.02, 0], [1.01, 1.01, 0.008], ROOM)).toBe(true);
  });
});

describe('clampLift', () => {
  const margin = GESTURE.ceilingMargin;

  it('leaves a height inside the range alone', () => {
    expect(clampLift(1.2, 0.1, ROOM, margin)).toBe(1.2);
  });

  it('keeps the part on or above the floor', () => {
    expect(clampLift(-3, 0.1, ROOM, margin)).toBe(0.1);
  });

  it('keeps the top margin below the walls', () => {
    expect(clampLift(99, 1.01, ROOM, margin)).toBeCloseTo(ROOM.height - margin - 1.01);
  });

  it('sits a part taller than the room on the floor', () => {
    expect(clampLift(2, ROOM.height, ROOM, margin)).toBe(ROOM.height);
  });
});

describe('rebaseDragOffset', () => {
  it('maps the new intersection back onto the part', () => {
    expect(rebaseDragOffset([1.25, -0.5], [1, 0.4, -0.25])).toEqual([0.25, -0.25]);
  });

  it('is zero when the finger is over the part', () => {
    expect(rebaseDragOffset([0.3, 0.7], [0.3, 1, 0.7])).toEqual([0, 0]);
  });
});

describe('pullAlong', () => {
  it('measures travel along the on-screen axis, whatever its length', () => {
    expect(pullAlong([10, 10], [40, 50], [3, 4])).toBeCloseTo(50);
    expect(pullAlong([10, 10], [40, 50], [30, 40])).toBeCloseTo(50);
  });

  it('is negative against the axis and zero across it', () => {
    expect(pullAlong([0, 0], [-20, 0], [1, 0])).toBe(-20);
    expect(pullAlong([0, 0], [0, 35], [1, 0])).toBe(0);
  });

  it('is zero for an axis pointing at the camera', () => {
    expect(pullAlong([0, 0], [100, 100], [0, 0])).toBe(0);
  });
});


describe('easeToward (seat assist)', () => {
  const quarter: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90° about y
  const from: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const seat: Pose = { position: [0.06, -0.02, 0.04], rotation: quarter };
  const distance = (a: Pose, b: Pose) => Math.hypot(...a.position.map((v, i) => v - b.position[i]));
  const angle = ({ rotation: [, , , w] }: Pose) => 2 * Math.acos(Math.min(1, Math.abs(w)));

  it('converges on the seat over time', () => {
    let pose = from;
    for (let i = 0; i < 120; i++) pose = easeToward(pose, seat, 9, 1 / 60);
    pose.position.forEach((v, i) => expect(v).toBeCloseTo(seat.position[i], 6));
    pose.rotation.forEach((v, i) => expect(v).toBeCloseTo(quarter[i], 6));
  });

  it('closes the gap by 1 − e^(−strength·delta) per step, position and angle alike', () => {
    const pose = easeToward(from, seat, 9, 0.1);
    const kept = Math.exp(-0.9);
    expect(distance(pose, seat)).toBeCloseTo(distance(from, seat) * kept, 9);
    expect(angle(pose)).toBeCloseTo((Math.PI / 2) * (1 - kept), 9);
  });

  it('is framerate-independent: two half steps land where one full step does', () => {
    const once = easeToward(from, seat, 9, 1 / 30);
    const twice = easeToward(easeToward(from, seat, 9, 1 / 60), seat, 9, 1 / 60);
    once.position.forEach((v, i) => expect(twice.position[i]).toBeCloseTo(v, 12));
    once.rotation.forEach((v, i) => expect(twice.rotation[i]).toBeCloseTo(v, 12));
  });

  it('pulls nothing at strength 0 or over no time', () => {
    expect(easeToward(from, seat, 0, 1 / 60)).toEqual(from);
    expect(easeToward(from, seat, 9, 0)).toEqual(from);
  });

  it('takes the short way round when the seat quaternion has the opposite sign', () => {
    const negated: Pose = { ...seat, rotation: quarter.map((v) => -v) as Quat };
    const pose = easeToward(from, negated, 9, 0.1);
    expect(angle(pose)).toBeCloseTo((Math.PI / 2) * (1 - Math.exp(-0.9)), 9);
  });

  it('keeps the rotation a unit quaternion', () => {
    const pose = easeToward({ position: [0, 0, 0], rotation: quarter }, { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, 9, 0.05);
    expect(Math.hypot(...pose.rotation)).toBeCloseTo(1, 12);
  });
});

describe('hasEscaped (1.5 recovery sweep)', () => {
  const room = { width: 10, depth: 10, height: 3 };
  const margin = 0.05;

  it('keeps anything on or above the floor, inside the walls', () => {
    expect(hasEscaped([0, 0.01, 0], room, margin)).toBe(false);
    expect(hasEscaped([4.99, 2.9, -4.99], room, margin)).toBe(false);
    // No ceiling: thrown up, it comes back down.
    expect(hasEscaped([0, 40, 0], room, margin)).toBe(false);
  });

  it('flags a body under the floor or past a wall, beyond the margin', () => {
    expect(hasEscaped([0, -0.06, 0], room, margin)).toBe(true);
    expect(hasEscaped([5.06, 1, 0], room, margin)).toBe(true);
    expect(hasEscaped([0, 1, -5.06], room, margin)).toBe(true);
    expect(hasEscaped([0, -0.04, 5.04], room, margin)).toBe(false);
  });
});

// The router's lift, headless: the finger's ray through one fixed screen point, a drag
// plane raised by the lift, and the part placed where the ray meets the plane plus the
// grab offset — liftDrag then updateDrag (src/scene/gestureRouter.ts).
describe('lifting goes straight up (1.8.1 Step 1)', () => {
  // An elevated camera looking down at the floor at an angle, and the finger's ray
  // through one screen point.
  const camera: Vec3 = [0, 1.6, 2.4];
  const ray: Vec3 = [0.1, -0.55, -0.83];
  const grabY = 0.05;
  const grab = intersectDragPlane(camera, ray, grabY)!;
  // Grabbed 3 cm off the part's centre.
  const part: Vec3 = [grab[0] + 0.03, grabY, grab[2] - 0.02];
  const grabOffset: [number, number] = [part[0] - grab[0], part[2] - grab[2]];
  const placed = (point: Vec3, [dx, dz]: [number, number]) => [point[0] + dx, point[2] + dz];

  // Today's liftDrag: the plane rises, the offset stays.
  function liftUnfixed(planeY: number) {
    return placed(intersectDragPlane(camera, ray, planeY)!, grabOffset);
  }

  function lift(planeY: number) {
    const point = intersectDragPlane(camera, ray, planeY)!;
    return placed(point, rebaseDragOffset([part[0], part[2]], point));
  }

  it('keeps the part over the same spot on the floor as it rises', () => {
    for (const dy of [0.05, 0.3, 0.8]) {
      const [x, z] = lift(grabY + dy);
      expect(x).toBeCloseTo(part[0], 9);
      expect(z).toBeCloseTo(part[2], 9);
    }
  });

  it('is the fix: carrying the old offset to the raised plane slides the part toward the camera', () => {
    const [x, z] = liftUnfixed(grabY + 0.3);
    const before = Math.hypot(part[0] - camera[0], part[2] - camera[2]);
    const after = Math.hypot(x - camera[0], z - camera[2]);
    expect(after).toBeLessThan(before - 0.1);
  });
});
