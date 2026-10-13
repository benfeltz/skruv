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

import { areCompatible, canPassInto } from '../../tools/validate/lib/vocabulary.js';
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

/** The fit search's window: seeding reach and skew, and how exactly a further hole must sit (across and along its end's axis). */
export interface FitWindow {
  maxDistance: number;
  maxAngle: number;
  matchTolerance: number;
  seatSlack: number;
  matchAngle: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.sqrt(dot(a, a));

// The same pose to within rounding.
const SAME = 1e-6;

/** A part type a fit seats: it has connectors, every one a hole — no fastener end, so not hardware or a tool. */
export const isPanelType = ({ connectors }: { connectors: readonly { type: ConnectorType }[] }) =>
  connectors.length > 0 && canPassInto(connectors);

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
 * `matchTolerance` across the end's axis and `seatSlack` along it (dowels stand at different
 * depths, pushed home or not), axis against axis within `matchAngle`, one end per hole — as indices.
 */
function pairsOf(transform: SnapTransform, holes: readonly WorldConnector[], ends: readonly WorldConnector[], { matchTolerance, seatSlack, matchAngle }: FitWindow) {
  const candidates: { hole: number; end: number; distance: number }[] = [];
  holes.forEach((hole, i) => {
    const position = carry(transform, hole.position);
    const axis = rotateVector(transform.rotation, hole.axis);
    ends.forEach((end, j) => {
      if (!areCompatible(hole.type, end.type)) return;
      const offset = sub(end.position, position);
      if (!alongAxis(offset, end.axis, matchTolerance, seatSlack) || misalignment(axis, end.axis) > matchAngle) return;
      candidates.push({ hole: i, end: j, distance: length(offset) });
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
  // How far each kept fit's seed pair was apart: of fits seating the same pairs from the same
  // pose, the one seeded by the nearest pair is kept, so the pair reported first is stable.
  const reach = new Map<string, number>();
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
        const same = known && Math.abs(known.distance - distance) < SAME;
        if (known && (same ? reach.get(key)! <= seed.distance : known.distance < distance)) continue;
        reach.set(key, seed.distance);
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

// --- where it goes: the panel's place in the finished item ---

/** What "where it goes" is read from: the assembled item's parts and joints (src/game/item.ts's ASSEMBLED), passed in. */
export interface AssembledItem {
  parts: readonly ({ id: string; type: string } & Pose)[];
  joints: readonly { hardware: string; host: string }[];
}

/** host type → panel type → each pose the panel sits at in the host's frame, in the finished item. */
export type Relatives = ReadonlyMap<string, ReadonlyMap<string, readonly Pose[]>>;

/** Where it goes, and how near a fit must come to it (see PANEL). */
export interface PreferWindow {
  matchTolerance: number;
  matchAngle: number;
  preferSlide: number;
}

const conjugate = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];

/** Angle (radians) of the rotation between two orientations. */
const turnBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

/**
 * Each panel's pose relative to every panel it shares a piece of hardware with (a dowel) in
 * `assembled`, keyed by part type, both ways round — every instance pairing kept, so either
 * of two identical side panels counts. Computed once.
 */
export function preferredRelatives(assembled: AssembledItem, partTypes: Readonly<Record<string, { connectors: readonly { type: ConnectorType }[] }>>): Relatives {
  const byId = new Map(assembled.parts.map((part) => [part.id, part]));
  const hostsOf = new Map<string, Set<string>>();
  for (const { hardware, host } of assembled.joints) {
    if (!hostsOf.has(hardware)) hostsOf.set(hardware, new Set());
    hostsOf.get(hardware)!.add(host);
  }
  const relatives = new Map<string, Map<string, Pose[]>>();
  for (const hosts of hostsOf.values()) {
    const panels = [...hosts].map((id) => byId.get(id)!).filter((part) => isPanelType(partTypes[part.type]));
    for (const host of panels) {
      for (const panel of panels) {
        if (panel === host) continue;
        const inverse = conjugate(host.rotation);
        const relative: Pose = {
          position: rotateVector(inverse, sub(panel.position, host.position)),
          rotation: normalizeQuaternion(multiplyQuaternions(inverse, panel.rotation)),
        };
        if (!relatives.has(host.type)) relatives.set(host.type, new Map());
        const byPanel = relatives.get(host.type)!;
        const poses = byPanel.get(panel.type) ?? [];
        const known = poses.some((p) => length(sub(p.position, relative.position)) < SAME && turnBetween(p.rotation, relative.rotation) < SAME);
        if (!known) byPanel.set(panel.type, [...poses, relative]);
      }
    }
  }
  return relatives;
}

/** Where a `panelType` goes on a `hostType` posed at `hostPose`: each of its relatives placed there. */
export function preferredPoses(relatives: Relatives, hostType: string, hostPose: Pose, panelType: string): Pose[] {
  return (relatives.get(hostType)?.get(panelType) ?? []).map((relative) => ({
    position: add(hostPose.position, rotateVector(hostPose.rotation, relative.position)),
    rotation: normalizeQuaternion(multiplyQuaternions(hostPose.rotation, relative.rotation)),
  }));
}

/**
 * Where a carried panel goes when a panel it carries goes at `preferred`: kept at the offset
 * it had from that member when picked up (`member` and `grabbed`, their poses then), so an
 * assembly carried by any of its panels is where it goes when any of them is.
 */
export function preferredThrough(preferred: Pose, member: Pose, grabbed: Pose): Pose {
  const inverse = conjugate(member.rotation);
  const anchor = rotateVector(inverse, sub(grabbed.position, member.position));
  const turn = multiplyQuaternions(inverse, grabbed.rotation);
  return {
    position: add(preferred.position, rotateVector(preferred.rotation, anchor)),
    rotation: normalizeQuaternion(multiplyQuaternions(preferred.rotation, turn)),
  };
}

/** How long a fit on offer holds (see PANEL): how far the finger may move the panel, and turn it, since the offer was taken, and how much nearer another fit as good must be. */
export interface HoldWindow {
  holdReach: number;
  holdTurn: number;
  offerMargin: number;
}

/**
 * A fit as offered: the pose it seats the panel at, which pairs it seats (`key`, the same for
 * the same pairs), whether it is where it goes, its pairs, and where the finger had the panel
 * when it was first offered (`taken`).
 */
export type Offered = Pose & { key: string; preferred?: boolean; pairs?: readonly FitPair[]; taken?: Pose };

/**
 * The fit on offer with the carried panel at `finger`, given the one on offer now (`current`)
 * and the best the search finds from there (`next`). The current one holds, pose and all —
 * hysteresis, so a trembling finger, the line easing or a target the panel nudges never flips
 * it, nor has seat assist chase it — until the finger has moved or turned the panel out of
 * `window` since it was taken, or `next` is better (where it goes, else more pairs), or as good
 * and `offerMargin` nearer the finger. What it seats is judged afresh at release (the router).
 */
export function heldOffer<T extends Offered>(current: T | null, next: T | null, finger: Pose, window: HoldWindow): T | null {
  const fresh = (offer: T | null): T | null => offer && { ...offer, taken: finger };
  if (!current?.taken) return fresh(next);
  const { taken } = current;
  if (length(sub(finger.position, taken.position)) > window.holdReach || turnBetween(finger.rotation, taken.rotation) > window.holdTurn) return fresh(next);
  if (!next) return current;
  // The same fit found again: as offered, unless it has since come to be where it goes.
  if (next.key === current.key) return next.preferred && !current.preferred ? { ...next, taken } : current;
  if (!!next.preferred !== !!current.preferred) return next.preferred ? fresh(next) : current;
  const pairs = (offer: T) => offer.pairs?.length ?? 0;
  if (pairs(next) !== pairs(current)) return pairs(next) > pairs(current) ? fresh(next) : current;
  const off = (offer: T) => length(sub(offer.position, finger.position));
  return off(next) + window.offerMargin < off(current) ? fresh(next) : current;
}

// `offset` within `across` of unit `axis`'s line and `along` along it.
function alongAxis(offset: Vec3, axis: Vec3, across: number, along: number) {
  const slide = dot(offset, axis);
  return Math.abs(slide) <= along && length(sub(offset, scale(axis, slide))) <= across;
}

/**
 * True when `fit` puts the panel where one of `preferred` has it: turned within matchAngle,
 * and off it within matchTolerance across its seed end's axis and preferSlide along it (the
 * dowels may not yet be pushed home).
 */
export function isPreferred(fit: Fit, preferred: readonly Pose[], window: PreferWindow) {
  const axis = fit.pairs[0].end.axis;
  return preferred.some(
    (pose) => turnBetween(fit.pose.rotation, pose.rotation) <= window.matchAngle && alongAxis(sub(fit.pose.position, pose.position), axis, window.matchTolerance, window.preferSlide),
  );
}

/** `fits` best first, each marked: where it goes first, then the most pairs, then the nearest. Every fit stays on offer. */
export function rankFits<H extends WorldConnector, E extends WorldConnector>(fits: readonly Fit<H, E>[], preferred: readonly Pose[], window: PreferWindow) {
  return fits
    .map((fit) => ({ ...fit, preferred: isPreferred(fit, preferred, window) }))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.pairs.length - a.pairs.length || a.distance - b.distance);
}

/**
 * The ends a panel where it goes would sit on: of `ends`, each the nearest compatible one to
 * a hole of `holes` (the panel's, world space at that pose), axis against axis within
 * matchAngle, within matchTolerance across it and preferSlide along it. One end per hole.
 */
export function preferredTargets<E extends WorldConnector>(holes: readonly WorldConnector[], ends: readonly E[], window: PreferWindow): E[] {
  const out: E[] = [];
  for (const hole of holes) {
    let best: { end: E; distance: number } | null = null;
    for (const end of ends) {
      if (out.includes(end) || !areCompatible(hole.type, end.type) || misalignment(hole.axis, end.axis) > window.matchAngle) continue;
      const offset = sub(end.position, hole.position);
      if (!alongAxis(offset, end.axis, window.matchTolerance, window.preferSlide)) continue;
      const distance = length(offset);
      if (!best || distance < best.distance) best = { end, distance };
    }
    if (best) out.push(best.end);
  }
  return out;
}
