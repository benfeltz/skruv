// Which tool connectors a fastener offers. Pure — joints and connector records in, sets and
// booleans out; geometry the graph doesn't hold (which bolt head a cam would catch) is
// injected by the caller.
//
//   seat target  a connector a tool may seat on at all: a bolt head or cam slot only once
//                its bolt or cam lock is seated in its hole — a tool on loose hardware is a
//                dead end (nothing turns)
//   workable     a seat target the tool can turn right now: an unscrewed seated bolt for
//                the Allen key; an unlocked seated cam lock with a screwed bolt in reach for
//                the screwdriver. Only these light up, which also teaches the build order.
//   ring         how brightly a workable target lights for the finger: by on-screen
//                distance (what looks close is close, on a phone), capped by a 3D distance
//                from the tool's tip so nothing across the room lights.

import { CONNECTOR, KIND } from '../../tools/validate/lib/vocabulary.js';
import { isCrankKind, isFastened, STATE } from './fasteners.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';
import type { AssemblyJoint, PartId } from './assembly.js';
import type { ScreenPoint } from './dragMath.js';

/** A tool's working end. */
export const TOOL_TIPS: readonly ConnectorType[] = Object.freeze([CONNECTOR.WRENCH_TIP, CONNECTOR.SCREWDRIVER_TIP]);

/** What a tool's tip seats on. */
export const TOOL_TARGETS: readonly ConnectorType[] = Object.freeze([CONNECTOR.BOLT_HEAD, CONNECTOR.CAM_SLOT]);

/** A connector as these rules read it: its type and the part it is on. */
export interface TargetConnector {
  type: ConnectorType;
  part: { id: PartId };
}

/** The bolt a cam lock would catch (`capture` over screwed bolt heads), or null. */
export type Captured = (cam: PartId) => PartId | null;

export const isToolTip = (type: ConnectorType) => TOOL_TIPS.includes(type);

export const isToolTarget = (type: ConnectorType) => TOOL_TARGETS.includes(type);

/** Hardware seated in its hole: the ids with a bolt or cam seat joint. */
export function seatedHardware(joints: Iterable<AssemblyJoint>) {
  const seated = new Set<PartId>();
  for (const j of joints) if (isCrankKind(j.kind)) seated.add(j.hardware);
  return seated;
}

/** Any connector but a tool target; a bolt head or cam slot only on seated hardware. */
export const isSeatTarget = (connector: TargetConnector, seated: ReadonlySet<PartId>) =>
  !isToolTarget(connector.type) || seated.has(connector.part.id);

/** A seat target the matching tool can turn right now — see the header. */
export function isWorkable(connector: TargetConnector, joints: Iterable<AssemblyJoint>, captured: Captured) {
  const seat = seatOf(connector, joints);
  if (!seat) return false;
  if (connector.type === CONNECTOR.BOLT_HEAD) return !isFastened(seat.fastener);
  return seat.fastener.state !== STATE.LOCKED && captured(seat.hardware) !== null;
}

// The bolt or cam seat joint a target connector's part sits in, or null (loose, or not a target).
function seatOf({ type, part }: TargetConnector, joints: Iterable<AssemblyJoint>) {
  const kind = type === CONNECTOR.BOLT_HEAD ? KIND.BOLT : type === CONNECTOR.CAM_SLOT ? KIND.CAM : null;
  if (!kind) return null;
  for (const j of joints) if (j.hardware === part.id && j.kind === kind) return j;
  return null;
}

/** A target ring: its target, how brightly it lights (0..1) and how far it is from the finger (CSS px). */
export interface RingStrength<T> {
  target: T;
  strength: number;
  offset: number;
}

/**
 * Ring strengths for `targets` (workable ones — the caller filters), nearest the finger
 * first. `project` maps a world point to client px. A target lights within `screenRadius`
 * px of `finger`, fading linearly out to it, and only within `maxDistance` metres of the
 * tool's `tip`; the nearest lit one is at full strength.
 */
export function ringStrengths<T extends { position: Vec3 }>(
  targets: Iterable<T>,
  finger: ScreenPoint,
  project: (position: Vec3) => ScreenPoint,
  tip: Vec3,
  { screenRadius, maxDistance }: { screenRadius: number; maxDistance: number },
): RingStrength<T>[] {
  const rings = [...targets].map((target) => {
    const [x, y] = project(target.position);
    const offset = Math.hypot(x - finger[0], y - finger[1]);
    const reach = Math.hypot(target.position[0] - tip[0], target.position[1] - tip[1], target.position[2] - tip[2]);
    const strength = reach > maxDistance ? 0 : Math.max(0, 1 - offset / screenRadius);
    return { target, strength, offset };
  });
  rings.sort((a, b) => a.offset - b.offset);
  const nearest = rings.find((ring) => ring.strength > 0);
  if (nearest) nearest.strength = 1;
  return rings;
}
