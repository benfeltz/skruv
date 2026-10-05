import { describe, expect, it } from 'vitest';
import { CAMERA, CAMERA_LIMITS, ROOM } from '../src/constants.js';
import { maxOrbitDistance, minCameraHeight } from '../src/scene/cameraLimits.js';

const room = { width: 10, depth: 10, height: 4 };
const limits = {
  pivot: [0, 1, 0],
  maxTargetRadius: 1,
  wallMargin: 0.5,
  minDistance: 1,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI / 2,
};

describe('maxOrbitDistance', () => {
  it('is bound by the walls when the room is tall', () => {
    expect(maxOrbitDistance({ ...room, height: 100 }, limits)).toBeCloseTo(5 - 0.5 - 1);
  });

  // 1.4.1 dollhouse view: the wall tops no longer bound zoom-out.
  it('is no longer bound by the wall tops when the room is low', () => {
    expect(maxOrbitDistance(room, limits)).toBeCloseTo(5 - 0.5 - 1);
    expect(maxOrbitDistance({ ...room, height: 0.5 }, limits)).toBeCloseTo(5 - 0.5 - 1);
  });

  it('ignores the polar limits — only the horizontal reach binds', () => {
    const tilted = { ...limits, minPolarAngle: Math.PI / 3 };
    expect(maxOrbitDistance(room, tilted)).toBeCloseTo(maxOrbitDistance(room, limits));
  });

  it('uses the nearer wall for an off-centre pivot or a narrow room', () => {
    expect(maxOrbitDistance({ ...room, height: 100, depth: 6 }, limits)).toBeCloseTo(3 - 1.5);
    const offCentre = { ...limits, pivot: [2, 1, 0] };
    expect(maxOrbitDistance({ ...room, height: 100 }, offCentre)).toBeCloseTo(3 - 1.5);
  });
});

describe('shipped camera limits', () => {
  const maxDistance = maxOrbitDistance(ROOM, CAMERA_LIMITS);
  const [pivotX, pivotY, pivotZ] = CAMERA_LIMITS.pivot;
  const { maxTargetRadius, wallMargin, minPolarAngle } = CAMERA_LIMITS;

  it('leaves room to zoom', () => {
    expect(maxDistance).toBeGreaterThan(CAMERA_LIMITS.minDistance);
  });

  it('keeps the camera inside the walls', () => {
    const reach = maxTargetRadius + maxDistance;
    expect(Math.abs(pivotX) + reach).toBeLessThanOrEqual(ROOM.width / 2 - wallMargin);
    expect(Math.abs(pivotZ) + reach).toBeLessThanOrEqual(ROOM.depth / 2 - wallMargin);
  });

  it('lets the camera rise above the wall tops (dollhouse view)', () => {
    const highest = pivotY + maxTargetRadius + maxDistance * Math.cos(minPolarAngle);
    expect(highest).toBeGreaterThan(ROOM.height);
  });

  it('clears the wall tops fully zoomed out from the starting view, not only at the extreme', () => {
    // The start target, at full zoom-out, looking down as steeply as allowed.
    const [, startY] = CAMERA.startTarget;
    expect(startY + maxDistance * Math.cos(minPolarAngle)).toBeGreaterThan(ROOM.height);
  });

  it('zooms out further than the old wall-tops bound allowed', () => {
    const byWallTops = (ROOM.height - wallMargin - (pivotY + maxTargetRadius)) / Math.cos(minPolarAngle);
    expect(maxDistance).toBeGreaterThan(byWallTops);
  });

  it('keeps the camera above the floor by more than the near plane', () => {
    expect(minCameraHeight(CAMERA_LIMITS)).toBeGreaterThan(CAMERA.near);
  });

  it('starts the camera within its limits', () => {
    const [cx, cy, cz] = CAMERA.startPosition;
    const [tx, ty, tz] = CAMERA.startTarget;
    const distance = Math.hypot(cx - tx, cy - ty, cz - tz);
    const polar = Math.acos((cy - ty) / distance);
    expect(Math.hypot(tx - pivotX, ty - pivotY, tz - pivotZ)).toBeLessThanOrEqual(maxTargetRadius);
    expect(distance).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance);
    expect(distance).toBeLessThanOrEqual(maxDistance);
    expect(polar).toBeGreaterThanOrEqual(minPolarAngle);
    expect(polar).toBeLessThanOrEqual(CAMERA_LIMITS.maxPolarAngle);
  });
});

describe('close-up zoom (1.4.1, Ben)', () => {
  it('zooms in close enough to frame a dowel and its hole', () => {
    expect(CAMERA_LIMITS.minDistance).toBeLessThanOrEqual(0.3);
  });

  it('never clips what it zooms in on: the near plane sits well inside the closest zoom', () => {
    expect(CAMERA.near).toBeLessThan(CAMERA_LIMITS.minDistance / 10);
  });
});
