import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMERA, CAMERA_LIMITS, ROOM } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { createPackedWorldLayout } from '../src/game/boxLayout.js';
import { LIVE_KNOBS } from '../src/game/tunables.js';
import { clampCamera, clampTarget, clampTargetAlongView, panSpeedAt, seatOnFloor, startPosition } from '../src/scene/cameraLimits.js';

const room = { width: 10, depth: 8, height: 3 };
const limits = { targetMargin: 0.5, targetHeight: [0, 2], wallMargin: 0.4, floorClearance: 0.05 };

describe('clampTarget', () => {
  it('leaves a target over the floor alone, down to floor level', () => {
    expect(clampTarget([1.5, 0, -2], room, limits)).toEqual([1.5, 0, -2]);
  });

  it('holds the target inside the walls and between its heights', () => {
    expect(clampTarget([9, 5, -9], room, limits)).toEqual([4.5, 2, -3.5]);
    expect(clampTarget([-9, -1, 9], room, limits)).toEqual([-4.5, 0, 3.5]);
  });
});

describe('clampCamera', () => {
  it('holds the camera wallMargin inside the walls horizontally', () => {
    expect(clampCamera([7, 1, -7], room, limits)).toEqual([4.6, 1, -3.6]);
  });

  it('keeps the camera above the floor', () => {
    expect(clampCamera([0, -0.3, 0], room, limits)).toEqual([0, 0.05, 0]);
  });

  it('lets the camera rise over the wall tops (dollhouse view)', () => {
    expect(clampCamera([0, 12, 0], room, limits)).toEqual([0, 12, 0]);
  });
});

describe('shipped camera limits', () => {
  it('lets the target reach every part packed in the box, at floor level', () => {
    for (const { position: [x, , z] } of createPackedWorldLayout()) {
      expect(clampTarget([x, 0, z], ROOM, CAMERA_LIMITS)).toEqual([x, 0, z]);
    }
  });

  it('zooms in close enough that a dowel fills a good part of the view', () => {
    // Height of the view at the closest zoom, against the dowel's length.
    const view = 2 * CAMERA_LIMITS.minDistance * Math.tan((CAMERA.fov * Math.PI) / 360);
    expect(PART_TYPES.dowel.size[1] / view).toBeGreaterThan(0.15);
  });

  it('never clips what it zooms in on', () => {
    expect(CAMERA.near).toBeLessThan(CAMERA_LIMITS.minDistance / 5);
    expect(CAMERA_LIMITS.floorClearance).toBeGreaterThan(CAMERA.near);
  });

  it('zooms out far enough to rise over the walls from the starting view', () => {
    const [, startY] = CAMERA.startTarget;
    expect(startY + CAMERA_LIMITS.maxDistance * Math.cos(CAMERA_LIMITS.minPolarAngle)).toBeGreaterThan(ROOM.height);
  });

  it('keeps the camera inside the walls whatever the zoom', () => {
    const far = CAMERA_LIMITS.maxDistance * 3;
    const [x, , z] = clampCamera([far, 1, -far], ROOM, CAMERA_LIMITS);
    expect(Math.abs(x)).toBeLessThanOrEqual(ROOM.width / 2 - CAMERA_LIMITS.wallMargin);
    expect(Math.abs(z)).toBeLessThanOrEqual(ROOM.depth / 2 - CAMERA_LIMITS.wallMargin);
  });

  it('starts the camera within its limits', () => {
    const [cx, cy, cz] = CAMERA.startPosition;
    const [tx, ty, tz] = CAMERA.startTarget;
    const distance = Math.hypot(cx - tx, cy - ty, cz - tz);
    const polar = Math.acos((cy - ty) / distance);
    expect(clampTarget(CAMERA.startTarget, ROOM, CAMERA_LIMITS)).toEqual(CAMERA.startTarget);
    expect(clampCamera(CAMERA.startPosition, ROOM, CAMERA_LIMITS)).toEqual(CAMERA.startPosition);
    expect(distance).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance);
    expect(distance).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
    expect(polar).toBeGreaterThanOrEqual(CAMERA_LIMITS.minPolarAngle);
    expect(polar).toBeLessThanOrEqual(CAMERA_LIMITS.maxPolarAngle);
  });
});

describe('startPosition (1.7.1 mobile start zoom)', () => {
  it('pulls the start back from its target along the same view', () => {
    expect(startPosition([2, 1, 0], [0, 1, 0], 1.5)).toEqual([3, 1, 0]);
    expect(startPosition([0, 3, 4], [0, 0, 0], 1)).toEqual([0, 3, 4]);
  });

  it('frames a phone through startPosition and leaves the desktop start untouched', () => {
    const scene = readFileSync(new URL('../src/scene/scene.ts', import.meta.url), 'utf8');
    expect(scene).toMatch(/matchMedia\('\(pointer: coarse\)'\)\.matches/);
    expect(scene).toMatch(/coarse \? startPosition\(CAMERA\.startPosition, CAMERA\.startTarget, CAMERA\.mobileStartScale\) : CAMERA\.startPosition/);
  });

  it('starts a phone further out, within the camera limits across the whole knob range', () => {
    expect(CAMERA.mobileStartScale).toBeGreaterThan(1);
    const { min, max } = LIVE_KNOBS['camera.mobileStartScale'];
    for (const scale of [min, CAMERA.mobileStartScale, max]) {
      const eye = startPosition(CAMERA.startPosition, CAMERA.startTarget, scale);
      const distance = Math.hypot(...eye.map((v, i) => v - CAMERA.startTarget[i]));
      expect(distance, `scale ${scale}`).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
      expect(clampCamera(eye, ROOM, CAMERA_LIMITS), `scale ${scale}`).toEqual(eye);
    }
  });
});

describe('panSpeedAt (zoomed-in panning)', () => {
  const pan = { panReference: 1.2, maxPanBoost: 5 };

  it('leaves panning alone from the reference distance out', () => {
    expect(panSpeedAt(1.2, pan)).toBe(1);
    expect(panSpeedAt(4, pan)).toBe(1);
  });

  it('speeds panning up as the camera closes in, inversely to distance', () => {
    expect(panSpeedAt(0.6, pan)).toBeCloseTo(2);
    expect(panSpeedAt(0.4, pan)).toBeCloseTo(3);
  });

  it('caps the boost, and never divides by zero', () => {
    expect(panSpeedAt(0.05, pan)).toBe(5);
    expect(panSpeedAt(0, pan)).toBe(5);
  });

  it('at the shipped closest zoom, a swipe covers ground like one from further out', () => {
    // World distance a pan covers per px is distance × speed; at minDistance it must be at
    // least a third of what it is at the reference distance.
    const { minDistance, panReference } = CAMERA_LIMITS;
    expect((minDistance * panSpeedAt(minDistance, CAMERA_LIMITS)) / panReference).toBeGreaterThan(1 / 3 - 1e-9);
  });
});

describe('clampTargetAlongView (zoom toward the fingers near the floor — 1.4.1 review)', () => {
  const eye = [1, 1, 2];
  const direction = (from, to) => {
    const d = to.map((v, i) => v - from[i]);
    const n = Math.hypot(...d);
    return d.map((v) => v / n);
  };

  it('slides a target pushed below the floor back along the line of sight to floor level', () => {
    const sunk = [0.2, -0.3, 0.4];
    const held = clampTargetAlongView(sunk, eye, room, limits);
    expect(held[1]).toBeCloseTo(0, 12);
    // Same view direction: no tilt.
    direction(eye, held).forEach((v, i) => expect(v).toBeCloseTo(direction(eye, sunk)[i], 12));
  });

  it('does the same at the top of the range', () => {
    const low = [0, 0.5, 0];
    const held = clampTargetAlongView([1, 3, 0], low, room, limits);
    expect(held[1]).toBeCloseTo(2, 12);
    direction(low, held).forEach((v, i) => expect(v).toBeCloseTo(direction(low, [1, 3, 0])[i], 12));
  });

  it('leaves a target in range alone, and still holds it inside the walls', () => {
    expect(clampTargetAlongView([1, 0.5, -1], eye, room, limits)).toEqual([1, 0.5, -1]);
    expect(clampTargetAlongView([9, 0.5, 0], eye, room, limits)).toEqual([4.5, 0.5, 0]);
  });

  it('falls back to a plain clamp when the eye itself is past the bound', () => {
    expect(clampTargetAlongView([0, -0.2, 0], [0, -0.1, 1], room, limits)).toEqual([0, 0, 0]);
  });
});

describe('seatOnFloor (zoom reaches the parts on the floor — Ben, 1.4.1)', () => {
  const seat = { targetHeight: [0, 2], maxDistance: 6 };
  const dir = (a, b) => { const d = b.map((v, i) => v - a[i]); const n = Math.hypot(...d); return d.map((x) => x / n); };

  it('moves a target hanging in the air down the line of sight onto the floor', () => {
    const eye = [2, 1.8, 2.4];
    const target = [0, 0.6, 0];
    const seated = seatOnFloor(eye, target, seat);
    expect(seated[1]).toBeCloseTo(0, 12);
    dir(eye, seated).forEach((v, i) => expect(v).toBeCloseTo(dir(eye, target)[i], 12));
  });

  it('pulls a target below the floor back up to it, on the same line of sight', () => {
    const seated = seatOnFloor([0, 1, 1], [0, -1, -1], seat);
    expect(seated).toEqual([0, 0, 0]);
  });

  it('leaves the target alone looking level or upward, or at floor out of reach', () => {
    expect(seatOnFloor([0, 1, 1], [0, 1, 0], seat)).toEqual([0, 1, 0]);
    expect(seatOnFloor([0, 1, 1], [0, 1.5, 0], seat)).toEqual([0, 1.5, 0]);
    // Nearly level: the floor is 20 m away.
    expect(seatOnFloor([0, 1, 0], [0, 0.95, -1], seat)).toEqual([0, 0.95, -1]);
  });

  it('is a no-op for a target already on the floor', () => {
    seatOnFloor([1, 2, 1], [0.3, 0, -0.2], seat).forEach((v, i) => expect(v).toBeCloseTo([0.3, 0, -0.2][i], 12));
  });
});
