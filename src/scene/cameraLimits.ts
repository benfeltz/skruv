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

/** The unit direction from `eye` toward `target`, or null when they coincide. */
function viewDirection(eye: Vec3, target: Vec3): Vec3 | null {
  const toward = target.map((v, i) => v - eye[i]);
  const length = Math.hypot(...toward);
  // map keeps the length; TS widens a mapped tuple to number[].
  return length > 0 ? (toward.map((v) => v / length) as Vec3) : null;
}

/** How far along `direction` (unit) from `eye` the floor at height `floor` is; null looking level or upward, or from the floor. */
function floorReach(eye: Vec3, direction: Vec3, floor: number): number | null {
  const down = -direction[1];
  return eye[1] > floor && down > 1e-6 ? (eye[1] - floor) / down : null;
}

/** The point `distance` along `direction` (unit) from `eye`. */
function along(eye: Vec3, direction: Vec3, distance: number): Vec3 {
  // map keeps the length; TS widens a mapped tuple to number[].
  return eye.map((v, i) => v + direction[i] * distance) as Vec3;
}

/**
 * The orbit target moved along the line of sight from `eye` to where it meets the floor
 * (the bottom of `targetHeight`), when that is within `maxDistance`. The view is unchanged,
 * but the camera then orbits and zooms about the spot it is looking at — so a zoom closes
 * all the way in on parts lying there instead of stalling at a point hanging in the air.
 * Looking level or upward, or at floor out of reach, the target stays where it is.
 */
export function seatOnFloor(eye: Vec3, target: Vec3, limits: Pick<Limits, 'targetHeight' | 'maxDistance'>): Vec3 {
  const direction = viewDirection(eye, target);
  const reach = direction && floorReach(eye, direction, limits.targetHeight[0]);
  if (!direction || reach === null || reach > limits.maxDistance) return target;
  return along(eye, direction, reach);
}

/**
 * The pivot for a gesture about to start: the orbit target moved along the line of sight
 * from `eye` to the nearer of `hitDistance` (the first part that line meets, or null) and
 * the floor — only ever along the line already being looked down, so the view never jumps.
 * A candidate nearer than `minDistance` or farther than `maxDistance` is ignored (holding
 * the camera to those would jerk it), and so is one `clampTarget` would move (outside the
 * target's bounds, the clamp would pull it off the line); with none left the target stays.
 */
export function pivotAlongView(
  eye: Vec3,
  target: Vec3,
  hitDistance: number | null,
  room: Room,
  limits: Pick<Limits, 'targetHeight' | 'targetMargin' | 'minDistance' | 'maxDistance'>,
): Vec3 {
  const direction = viewDirection(eye, target);
  if (!direction) return target;
  const holds = (d: number) => {
    const point = along(eye, direction, d);
    return clampTarget(point, room, limits).every((v, i) => Math.abs(v - point[i]) < 1e-9);
  };
  const inReach = [hitDistance, floorReach(eye, direction, limits.targetHeight[0])]
    .filter((d): d is number => d !== null && d >= limits.minDistance && d <= limits.maxDistance && holds(d));
  return inReach.length ? along(eye, direction, Math.min(...inReach)) : target;
}
