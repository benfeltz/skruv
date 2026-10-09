// Drag and rotation math for part manipulation. Pure: plain [x, y, z] arrays in and out,
// no Three vector types, so Vitest covers it headlessly.

import type { Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

const PARALLEL_EPSILON = 1e-9;

/** A point on screen, [x, y] in CSS px (y down). */
export type ScreenPoint = [number, number];

/** A room centred on the origin, metres. */
export interface Room {
  width: number;
  depth: number;
  height: number;
}

/**
 * Where a ray meets the horizontal plane y = planeY, as [x, planeY, z]; null when the ray
 * runs parallel to the plane or points away from it.
 */
export function intersectDragPlane([ox, oy, oz]: number[], [dx, dy, dz]: number[], planeY: number): Vec3 | null {
  if (Math.abs(dy) < PARALLEL_EPSILON) return null;
  const t = (planeY - oy) / dy;
  if (t < 0) return null;
  return [ox + t * dx, planeY, oz + t * dz];
}

/**
 * The grab offset [dx, dz] that keeps a part at `partXZ` once its drag plane has moved and
 * the finger's ray now meets it at `pointOnPlane` — so a lift raises the part straight up
 * instead of sliding it along the ray toward the camera.
 */
export function rebaseDragOffset([px, pz]: number[], [x, , z]: number[]): [number, number] {
  return [px - x, pz - z];
}

/**
 * Clamps a part's centre so its [halfX, halfZ] footprint stays `margin` inside the walls
 * of a room centred on the origin. A part wider than the room is held at the centre line.
 */
export function clampToRoom([x, y, z]: number[], [halfX, halfZ]: number[], room: Omit<Room, 'height'>, margin: number): Vec3 {
  const limitX = Math.max(0, room.width / 2 - margin - halfX);
  const limitZ = Math.max(0, room.depth / 2 - margin - halfZ);
  return [Math.min(limitX, Math.max(-limitX, x)), y, Math.min(limitZ, Math.max(-limitZ, z))];
}

/**
 * Clamps a lifted part's centre height so its bottom stays on or above the floor and its
 * top stays `margin` below the walls' tops. A part taller than that range sits on the floor.
 */
export function clampLift(y: number, halfHeight: number, room: Pick<Room, 'height'>, margin: number) {
  const ceiling = Math.max(halfHeight, room.height - margin - halfHeight);
  return Math.min(ceiling, Math.max(halfHeight, y));
}

/**
 * How far (CSS px) a pointer has travelled from `start` to `point` along the on-screen
 * direction `axis` — negative when moving against it, 0 for a degenerate axis (one pointing
 * straight at the camera cannot be pulled along from this view).
 */
export function pullAlong([sx, sy]: number[], [x, y]: number[], [ax, ay]: number[]) {
  const length = Math.hypot(ax, ay);
  if (length < PARALLEL_EPSILON) return 0;
  return ((x - sx) * ax + (y - sy) * ay) / length;
}

/**
 * Nearest detent to `angle` for detents every `step` radians; exact halfway points round
 * away from zero, so ±45° goes to ±90° symmetrically. A falsy step (free rotation)
 * returns the angle unchanged.
 */
export function quantizeAngle(angle: number, step: number | null) {
  if (!step) return angle;
  const detents = Math.round(Math.abs(angle) / step);
  return Math.sign(angle) * detents * step || 0;
}

/**
 * Signed angle swept around screen point `center` going from `from` to `to`, in
 * (-π, π]. Screen y grows downward, so a counter-clockwise sweep as seen is positive.
 */
export function arcDelta([cx, cy]: number[], [fx, fy]: number[], [tx, ty]: number[]) {
  const a0 = Math.atan2(cy - fy, fx - cx);
  const a1 = Math.atan2(cy - ty, tx - cx);
  let delta = a1 - a0;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * World-axis half-extents [x, y, z] of a box with half-sizes `half` turned by quaternion
 * [x, y, z, w] — the half-size of its world-aligned bounding box.
 */
export function rotatedHalfExtents([hx, hy, hz]: number[], [x, y, z, w]: number[]): Vec3 {
  const rows = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  // map keeps the length; TS widens a mapped tuple to number[].
  return rows.map(([a, b, c]) => Math.abs(a) * hx + Math.abs(b) * hy + Math.abs(c) * hz) as Vec3;
}

/**
 * True when a box centred at `position` with world half-extents [x, y, z] lies above the
 * floor and inside the walls of a room centred on the origin, give or take `tolerance`.
 */
export function fitsInRoom([x, y, z]: number[], [hx, hy, hz]: number[], room: Omit<Room, 'height'>, tolerance = 0) {
  return (
    y - hy >= -tolerance &&
    Math.abs(x) + hx <= room.width / 2 + tolerance &&
    Math.abs(z) + hz <= room.depth / 2 + tolerance
  );
}

/**
 * True when a body centre at [x, y, z] has left the room: under the floor by more than
 * `margin`, or past a wall by more than it — a part flung through a slab. No ceiling: one
 * thrown up comes back down.
 */
export function hasEscaped([x, y, z]: number[], room: Omit<Room, 'height'>, margin: number) {
  return y < -margin || Math.abs(x) > room.width / 2 + margin || Math.abs(z) > room.depth / 2 + margin;
}

/** Spherical interpolation from quaternion `a` to `b` ([x, y, z, w]) by fraction `t`. */
function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  // q and −q are the same rotation; go the short way round.
  const to = cos < 0 ? b.map((v) => -v) : b;
  cos = Math.abs(cos);
  // map keeps the length; TS widens a mapped tuple to number[].
  if (cos > 1 - 1e-9) return a.map((v, i) => v + (to[i] - v) * t) as Quat;
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sin;
  const wb = Math.sin(t * angle) / sin;
  return a.map((v, i) => v * wa + to[i] * wb) as Quat;
}

/**
 * Seat assist: `pose` ({ position, rotation }) eased toward `target` by an exponential
 * pull of `strength` (1/s) over `delta` seconds — framerate-independent, so two half steps
 * land where one full step does. Strength 0 (or no time) leaves the pose where it is.
 */
export function easeToward(pose: Pose, target: Pose, strength: number, delta: number): Pose {
  const t = 1 - Math.exp(-strength * delta);
  return {
    // map keeps the length; TS widens a mapped tuple to number[].
    position: pose.position.map((v, i) => v + (target.position[i] - v) * t) as Vec3,
    rotation: slerp(pose.rotation, target.rotation, t),
  };
}
