import { describe, expect, it } from 'vitest';
import { CAMERA, CAMERA_LIMITS, ROOM } from '../src/constants.js';
import { PART_TYPES } from '../src/game/catalog.js';
import { createDevLayout } from '../src/game/devLayout.js';
import { clampCamera, clampTarget } from '../src/scene/cameraLimits.js';

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
  it('lets the target reach every part laid out on the floor, at floor level', () => {
    for (const { position: [x, , z] } of createDevLayout()) {
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
