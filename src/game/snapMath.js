// Connector snapping for lay-out: which connector TYPES can meet, and the rigid transform
// that seats a dragged part's connector onto another part's. Pure: world-space connector
// records `{ type, position: [x, y, z], axis: [x, y, z] }` built by the caller, quaternions
// as [x, y, z, w].
//
// Compatibility here is type-level only (a dowel end fits a dowel hole). Which instance
// mates with which is the assembly graph's (src/game/assembly.js), not this module's.

import { CONNECTOR } from './catalog.js';

/** Fastener end → the hole it goes in. Matching is symmetric; see `areCompatible`. */
export const COMPATIBLE = Object.freeze({
  [CONNECTOR.DOWEL_END]: CONNECTOR.DOWEL_HOLE,
  [CONNECTOR.BOLT_THREAD]: CONNECTOR.CAM_BOLT_HOLE,
  [CONNECTOR.CAM_LOCK_BODY]: CONNECTOR.CAM_LOCK_RECESS,
  [CONNECTOR.PIN_TIP]: CONNECTOR.SHELF_PIN_HOLE,
  [CONNECTOR.BACK_FITTING_TIP]: CONNECTOR.BACK_FITTING_HOLE,
  [CONNECTOR.WRENCH_TIP]: CONNECTOR.BOLT_HEAD,
  [CONNECTOR.SCREWDRIVER_TIP]: CONNECTOR.CAM_SLOT,
});

export const areCompatible = (a, b) => COMPATIBLE[a] === b || COMPATIBLE[b] === a;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.sqrt(dot(a, a));
const negate = (a) => [-a[0], -a[1], -a[2]];

function normalizeQuaternion(q) {
  const n = Math.hypot(...q);
  return q.map((c) => c / n);
}

/** Hamilton product a·b: rotation b, then a. */
export function multiplyQuaternions([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector([qx, qy, qz, qw], v) {
  const u = [qx, qy, qz];
  const t = cross(u, v).map((c) => 2 * c);
  return add(add(v, t.map((c) => qw * c)), cross(u, t));
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from, to) {
  const d = dot(from, to);
  if (d < -1 + 1e-9) {
    // Opposite: half turn about any axis perpendicular to `from`.
    const ortho = Math.abs(from[0]) < 0.9 ? cross(from, [1, 0, 0]) : cross(from, [0, 1, 0]);
    const n = length(ortho);
    return [ortho[0] / n, ortho[1] / n, ortho[2] / n, 0];
  }
  return normalizeQuaternion([...cross(from, to), 1 + d]);
}

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
