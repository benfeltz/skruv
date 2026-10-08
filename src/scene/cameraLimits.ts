// Pure orbit-limit geometry — no Three, no DOM — so Vitest covers it headlessly.
//
// The orbit target may go anywhere over the floor — down to the parts lying on it, out to
// `targetMargin` inside the walls — so a pinch can bring the camera right up to any dowel
// and its hole. The camera itself is clamped every frame: `wallMargin` inside the walls
// horizontally, `floorClearance` above the floor, unbounded above (zoomed out it rises over
// the wall tops — the dollhouse view).

import type { CAMERA_LIMITS, ROOM } from '../constants.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

type Room = Pick<typeof ROOM, 'width' | 'depth'>;
type Limits = typeof CAMERA_LIMITS;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `position` pulled back from `target` along the same view, `scale` times as far. */
export function startPosition(position: Vec3, target: Vec3, scale: number): Vec3 {
  // map keeps the length; TS widens a mapped tuple to number[].
  return position.map((v, i) => target[i] + (v - target[i]) * scale) as Vec3;
}

/** The orbit target, held over the floor and inside the walls. */
export function clampTarget([x, y, z]: Vec3, room: Room, limits: Pick<Limits, 'targetMargin' | 'targetHeight'>): Vec3 {
  const reachX = room.width / 2 - limits.targetMargin;
  const reachZ = room.depth / 2 - limits.targetMargin;
  const [low, high] = limits.targetHeight;
  return [clamp(x, -reachX, reachX), clamp(y, low, high), clamp(z, -reachZ, reachZ)];
}

/** The camera, held inside the walls horizontally and above the floor. */
export function clampCamera([x, y, z]: Vec3, room: Room, limits: Pick<Limits, 'wallMargin' | 'floorClearance'>): Vec3 {
  const reachX = room.width / 2 - limits.wallMargin;
  const reachZ = room.depth / 2 - limits.wallMargin;
  return [clamp(x, -reachX, reachX), Math.max(limits.floorClearance, y), clamp(z, -reachZ, reachZ)];
}

/**
 * Pan speed multiplier at `distance` from the orbit target. OrbitControls pans in
 * proportion to that distance, which crawls once zoomed in on hardware; closer than
 * `panReference` the pan is boosted by panReference / distance, up to `maxPanBoost`.
 */
export function panSpeedAt(distance: number, { panReference, maxPanBoost }: Pick<Limits, 'panReference' | 'maxPanBoost'>) {
  if (!(distance > 0)) return maxPanBoost;
  return Math.min(maxPanBoost, Math.max(1, panReference / distance));
}

/**
 * The orbit target clamped like `clampTarget`, but out of its height range it slides back
 * along the line of sight from `eye` to the bound it crossed — so the view direction holds
 * and a zoom toward the fingers near the floor neither tilts the view nor drifts it.
 */
export function clampTargetAlongView(target: Vec3, eye: Vec3, room: Room, limits: Pick<Limits, 'targetMargin' | 'targetHeight'>): Vec3 {
  const [low, high] = limits.targetHeight;
  const y = target[1];
  const bound = y < low ? low : y > high ? high : null;
  // Only when the eye is on the near side of the bound is there a crossing to slide to.
  if (bound !== null && (eye[1] - bound) * (y - bound) < 0) {
    const t = (eye[1] - bound) / (eye[1] - y);
    // map keeps the length; TS widens a mapped tuple to number[].
    return clampTarget(eye.map((v, i) => v + (target[i] - v) * t) as Vec3, room, limits);
  }
  return clampTarget(target, room, limits);
}

/**
 * The orbit target moved along the line of sight from `eye` to where it meets the floor
 * (the bottom of `targetHeight`), when that is within `maxDistance`. The view is unchanged,
 * but the camera then orbits and zooms about the spot it is looking at — so a zoom closes
 * all the way in on parts lying there instead of stalling at a point hanging in the air.
 * Looking level or upward, or at floor out of reach, the target stays where it is.
 */
export function seatOnFloor(eye: Vec3, target: Vec3, limits: Pick<Limits, 'targetHeight' | 'maxDistance'>): Vec3 {
  const toward = target.map((v, i) => v - eye[i]);
  const length = Math.hypot(...toward);
  const floor = limits.targetHeight[0];
  if (!(length > 0) || eye[1] <= floor) return target;
  const down = -toward[1] / length;
  if (down <= 1e-6) return target;
  const reach = (eye[1] - floor) / down;
  if (reach > limits.maxDistance) return target;
  // map keeps the length; TS widens a mapped tuple to number[].
  return eye.map((v, i) => v + (toward[i] / length) * reach) as Vec3;
}
