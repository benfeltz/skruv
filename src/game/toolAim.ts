// Self-aim: the arithmetic that turns a carried part's fastener end — a tool's tip, a
// dowel's or bolt's end — toward the nearest seat that takes it. Pure — positions
// [x, y, z], quaternions [x, y, z, w]; the router feeds it the drag's pick-up rotation
// every frame and AIM's zone and rate.

import { multiplyQuaternions, normalizeQuaternion, rotateVector, rotationBetween } from '../../tools/validate/lib/geometry.js';
import { easeToward } from './dragMath.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

const ORIGIN: Vec3 = [0, 0, 0];

/** Aim strength `distance` metres from a target: 1 on it, easing smoothly to 0 at `zone` and beyond. */
export function aimWeight(distance: number, zone: number) {
  const t = Math.min(1, Math.max(0, 1 - distance / zone));
  return t * t * (3 - 2 * t);
}

/** The target (any `{ position }`) nearest `tip` and strictly inside `zone`, with its distance — or null. */
export function nearestTarget<T extends { position: Vec3 }>(tip: Vec3, targets: Iterable<T>, zone: number) {
  let best: { target: T; distance: number } | null = null;
  for (const target of targets) {
    const distance = Math.hypot(target.position[0] - tip[0], target.position[1] - tip[1], target.position[2] - tip[2]);
    if (distance < zone && (!best || distance < best.distance)) best = { target, distance };
  }
  return best;
}

/** How far (radians) an end — `axis`, local — at `rotation` is from pointing straight into a target facing `targetAxis`. */
export function aimAngle(rotation: Quat, axis: Vec3, targetAxis: Vec3) {
  const [x, y, z] = rotateVector(rotation, axis);
  return Math.acos(Math.min(1, Math.max(-1, -(x * targetAxis[0] + y * targetAxis[1] + z * targetAxis[2]))));
}

/**
 * `rotation` turned by the smallest extra rotation that points the tip — `tipAxis`, local —
 * straight into a target whose axis is `targetAxis` (anti-aligned, as a snap seats it).
 */
export function aimedRotation(rotation: Quat, tipAxis: Vec3, targetAxis: Vec3): Quat {
  const into: Vec3 = [-targetAxis[0], -targetAxis[1], -targetAxis[2]];
  return normalizeQuaternion(multiplyQuaternions(rotationBetween(rotateVector(rotation, tipAxis), into), rotation));
}

/**
 * One frame of aiming: `rotation` eased toward `aimed` at `rate·weight` (1/s) over `delta`
 * seconds — the seat assist's framerate-independent law.
 */
export function aimStep(rotation: Quat, aimed: Quat, weight: number, rate: number, delta: number): Quat {
  return easeToward({ position: ORIGIN, rotation }, { position: ORIGIN, rotation: aimed }, rate * weight, delta).rotation;
}
