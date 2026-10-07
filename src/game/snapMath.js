// Connector snapping for lay-out: the rigid transform that seats a dragged part's connector onto another part's. Pure: world-space connector
// records `{ type, position: [x, y, z], axis: [x, y, z] }` built by the caller, quaternions
// as [x, y, z, w].
//
// Compatibility is type-level only (a dowel end fits a dowel hole; the vocabulary's
// COMPATIBLE). Which instance
// mates with which is the assembly graph's (src/game/assembly.js), not this module's.

import { areCompatible } from '../../tools/validate/lib/vocabulary.js';
import { multiplyQuaternions, normalizeQuaternion, rotateVector, rotationBetween } from '../../tools/validate/lib/geometry.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.sqrt(dot(a, a));
const negate = (a) => [-a[0], -a[1], -a[2]];

/** Angle between the dragged axis and the target's reversed axis (0 = seated head-on). */
const misalignment = (a, b) => Math.acos(Math.min(1, Math.max(-1, -dot(a, b))));

/**
 * Best compatible pair within `maxDistance` (metres) and `maxAngle` (radians) of axis
 * anti-alignment — nearest first, then straightest — or null. The returned `transform`
 * `{ rotation, translation }` maps world points x ↦ rotation·x + translation, carrying
 * `from` onto `to` with its axis reversed against `to`'s.
 */
export function findSnap(draggedConnectors, otherConnectors, { maxDistance, maxAngle }) {
  let best = null;
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
export function applyTransform({ rotation, translation }, pose) {
  return {
    position: add(rotateVector(rotation, pose.position), translation),
    rotation: normalizeQuaternion(multiplyQuaternions(rotation, pose.rotation)),
  };
}
