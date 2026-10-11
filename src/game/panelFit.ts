// Panel fit: where a carried panel seats by all its holes at once. Pure — world connector
// records `{ type, position, axis }` (snapMath's; callers carry their own fields alongside),
// poses `{ position, rotation }`, quaternions [x, y, z, w].
//
//   seed  a hole within the window of a free end that takes it: the hole's axis straightened
//         onto the end's, as findSnap seats hardware
//   spin  the turn about that axis that lands a second hole on a second end — the panel's
//         spin is solved from the pair, never kept from the drag
//   fit   every hole that then sits on a compatible end, axis against axis: the pairs a
//         release seats, all at once
//
// Any fit seats; which one is where the panel goes is ranked apart (rankFits).

import { areCompatible, isFastenerEnd } from '../../tools/validate/lib/vocabulary.js';
import { multiplyQuaternions, normalizeQuaternion, rotateVector } from '../../tools/validate/lib/geometry.js';
import { applyTransform, findSnap } from './snapMath.js';
import type { Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';
import type { SnapTransform, WorldConnector } from './snapMath.js';

/** One hole of the panel on one end it seats on. */
export interface FitPair<H extends WorldConnector = WorldConnector, E extends WorldConnector = WorldConnector> {
  hole: H;
  end: E;
}

/**
 * A whole-panel fit: the pose it seats the panel at, the transform carrying it there from
 * the drag's pose, every pair it seats (the seed pair first), how far the panel's centre
 * moves, and the seed's skew (radians).
 */
export interface Fit<H extends WorldConnector = WorldConnector, E extends WorldConnector = WorldConnector> {
  pose: Pose;
  transform: SnapTransform;
  pairs: FitPair<H, E>[];
  distance: number;
  angle: number;
}

/** The fit search's window: seeding reach and skew, and how exactly a further hole must sit. */
export interface FitWindow {
  maxDistance: number;
  maxAngle: number;
  matchTolerance: number;
  matchAngle: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.sqrt(dot(a, a));

/** A part type a fit seats: it has connectors, every one a hole — no fastener end, so not hardware or a tool. */
export const isPanelType = ({ connectors }: { connectors: readonly { type: ConnectorType }[] }) =>
  connectors.length > 0 && !connectors.some((c) => isFastenerEnd(c.type));

/** Angle (radians) between axis `a` and the reverse of `b` (0 = seated head-on). */
const misalignment = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, -dot(a, b))));

/** A world point carried by a transform. */
const carry = ({ rotation, translation }: SnapTransform, point: Vec3) => add(rotateVector(rotation, point), translation);

/** `transform`, then a turn of `angle` about the line through `centre` along unit `axis`. */
function spun(transform: SnapTransform, axis: Vec3, angle: number, centre: Vec3): SnapTransform {
  const s = Math.sin(angle / 2);
  const turn: Quat = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  return {
    rotation: normalizeQuaternion(multiplyQuaternions(turn, transform.rotation)),
    translation: add(rotateVector(turn, sub(transform.translation, centre)), centre),
  };
}

/**
 * The seed `seed` (hole `hole` on end `end`) turned about the end's axis, once per second
 * pair a turn within `maxAngle` lands — its hole the same distance off that axis as its end.
 */
function spins<H extends WorldConnector, E extends WorldConnector>(
  seed: SnapTransform,
  hole: H,
  end: E,
  holes: readonly H[],
  ends: readonly E[],
  { maxAngle, matchTolerance }: FitWindow,
): SnapTransform[] {
  const axis = end.axis;
  const across = (point: Vec3) => {
    const offset = sub(point, end.position);
    return sub(offset, scale(axis, dot(offset, axis)));
  };
  const out: SnapTransform[] = [];
  for (const second of holes) {
    if (second === hole) continue;
    const p = across(carry(seed, second.position));
    // On the seed's own axis: its spin says nothing.
    if (length(p) < matchTolerance) continue;
    for (const other of ends) {
      if (other === end || !areCompatible(second.type, other.type)) continue;
      const q = across(other.position);
      if (Math.abs(length(p) - length(q)) > matchTolerance) continue;
      const angle = Math.atan2(dot(axis, cross(p, q)), dot(p, q));
      if (Math.abs(angle) <= maxAngle) out.push(spun(seed, axis, angle, end.position));
    }
  }
  return out;
}

/**
 * The pairs `transform` seats: each hole carried by it onto the nearest compatible end within
 * `matchTolerance`, axis against axis within `matchAngle`, one end per hole — as indices.
 */
function pairsOf(transform: SnapTransform, holes: readonly WorldConnector[], ends: readonly WorldConnector[], { matchTolerance, matchAngle }: FitWindow) {
  const candidates: { hole: number; end: number; distance: number }[] = [];
  holes.forEach((hole, i) => {
    const position = carry(transform, hole.position);
    const axis = rotateVector(transform.rotation, hole.axis);
    ends.forEach((end, j) => {
      if (!areCompatible(hole.type, end.type)) return;
      const distance = length(sub(end.position, position));
      if (distance <= matchTolerance && misalignment(axis, end.axis) <= matchAngle) candidates.push({ hole: i, end: j, distance });
    });
  });
  candidates.sort((a, b) => a.distance - b.distance);
  const taken = new Set<number>();
  const seated = new Set<number>();
  return candidates.filter(({ hole, end }) => {
    if (seated.has(hole) || taken.has(end)) return false;
    seated.add(hole);
    taken.add(end);
    return true;
  });
}

/**
 * Every whole-panel fit of `holes` (the panel's, world space at `pose`) onto `ends` (free
 * ends that may take them) — see the header. Fits seating the same pairs are one, the
 * nearer kept. Unranked.
 */
export function findFits<H extends WorldConnector, E extends WorldConnector>(
  holes: readonly H[],
  pose: Pose,
  ends: readonly E[],
  window: FitWindow,
): Fit<H, E>[] {
  const fits = new Map<string, Fit<H, E>>();
  holes.forEach((hole, h) => {
    ends.forEach((end, e) => {
      const seed = findSnap([hole], [end], window);
      if (!seed) return;
      const turns = spins(seed.transform, hole, end, holes, ends, window);
      for (const transform of turns.length > 0 ? turns : [seed.transform]) {
        const pairs = pairsOf(transform, holes, ends, window);
        if (!pairs.some((p) => p.hole === h && p.end === e)) continue;
        const moved = applyTransform(transform, pose);
        const distance = length(sub(moved.position, pose.position));
        const key = pairs.map((p) => `${p.hole}:${p.end}`).sort().join(',');
        const known = fits.get(key);
        if (known && known.distance <= distance) continue;
        // The seed pair first: it is the one reported.
        const ordered = [pairs.find((p) => p.hole === h)!, ...pairs.filter((p) => p.hole !== h)];
        fits.set(key, {
          pose: moved,
          transform,
          pairs: ordered.map((p) => ({ hole: holes[p.hole], end: ends[p.end] })),
          distance,
          angle: seed.angle,
        });
      }
    });
  });
  return [...fits.values()];
}
