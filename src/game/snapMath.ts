// Connector snapping for lay-out: the rigid transform that seats a dragged part's connector onto another part's. Pure: world-space connector
// records `{ type, position: [x, y, z], axis: [x, y, z] }` built by the caller, quaternions
// as [x, y, z, w].
//
// Compatibility is type-level only (a dowel end fits a dowel hole; the vocabulary's
// COMPATIBLE). Which instance
// mates with which is the assembly graph's (src/game/assembly.ts), not this module's.

import { areCompatible } from '../../tools/validate/lib/vocabulary.js';
import { multiplyQuaternions, normalizeQuaternion, rotateVector, rotationBetween } from '../../tools/validate/lib/geometry.js';
import type { Frame, Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';

/** A world-space connector record; callers carry their own fields alongside. */
export interface WorldConnector extends Frame {
  type: ConnectorType;
}

/** A rigid transform x ↦ rotation·x + translation. */
export interface SnapTransform {
  rotation: Quat;
  translation: Vec3;
}

/** A snap on offer: the pair, how far apart and how skewed, and the transform that seats it. */
export interface Snap<F extends WorldConnector = WorldConnector, T extends WorldConnector = WorldConnector> {
  from: F;
  to: T;
  distance: number;
  angle: number;
  transform: SnapTransform;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const negate = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

/** Angle between the dragged axis and the target's reversed axis (0 = seated head-on). */
const misalignment = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, -dot(a, b))));

/**
 * Best compatible pair within `maxDistance` (metres) and `maxAngle` (radians) of axis
 * anti-alignment — nearest first, then straightest — or null. The returned `transform`
 * `{ rotation, translation }` maps world points x ↦ rotation·x + translation, carrying
 * `from` onto `to` with its axis reversed against `to`'s.
 */
export function findSnap<F extends WorldConnector, T extends WorldConnector>(
  draggedConnectors: Iterable<F>,
  otherConnectors: Iterable<T>,
  { maxDistance, maxAngle }: { maxDistance: number; maxAngle: number },
): Snap<F, T> | null {
  let best: Omit<Snap<F, T>, 'transform'> | null = null;
  for (const from of draggedConnectors) {
    for (const to of otherConnectors) {
      if (!areCompatible(from.type, to.type)) continue;
      const distance = length(sub(to.position, from.position));
      if (distance > maxDistance) continue;
      const angle = misalignment(from.axis, to.axis);
      if (angle > maxAngle) continue;
      if (best && (distance > best.distance || (distance === best.distance && angle >= best.angle))) continue;
      best = { from, to, distance, angle };
    }
  }
  if (!best) return null;
  const rotation = rotationBetween(best.from.axis, negate(best.to.axis));
  const translation = sub(best.to.position, rotateVector(rotation, best.from.position));
  return { ...best, transform: { rotation, translation } };
}

/** A body pose `{ position, rotation }` carried by a snap transform. */
export function applyTransform({ rotation, translation }: SnapTransform, pose: Pose): Pose {
  return {
    position: add(rotateVector(rotation, pose.position), translation),
    rotation: normalizeQuaternion(multiplyQuaternions(rotation, pose.rotation)),
  };
}
