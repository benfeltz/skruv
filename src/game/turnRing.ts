// Turn ring: the dial a seated tool shows round the head of the fastener it drives — which
// tools get one, where a finger grabs it, which way its arrows point and how full its arc
// is. Pure — screen points [x, y] in CSS px (y down), world directions [x, y, z]; the router
// projects, src/ui/turnRing.ts draws.

import { TURN_RING } from '../constants.js';
import { isCrankKind, isFastened } from './fasteners.js';
import { tightenSign } from './crankMath.js';
import { KIND } from '../../tools/validate/lib/vocabulary.js';
import type { AssemblyJoint } from './assembly.js';
import type { Fastener } from './fasteners.js';
import type { ScreenPoint } from './dragMath.js';

/** A seated tool and the bolt or cam seat it drives. */
export interface Engagement {
  tool: AssemblyJoint;
  target: AssemblyJoint;
}

/**
 * Whether a screen point is on the ring's grab band round `centre`: within `band` px either
 * side of the drawn `radius`. The middle (the head, the tool itself) is not the ring.
 */
export function dialHit(point: ScreenPoint, centre: ScreenPoint, { radius, band }: { radius: number; band: number } = TURN_RING) {
  const distance = Math.hypot(point[0] - centre[0], point[1] - centre[1]);
  return Math.abs(distance - radius) <= band;
}

/** How long the progress arc is (CSS px along the ring) for `progress` 0..1 home. */
export function arcLength(progress: number, radius: number = TURN_RING.radius) {
  return Math.min(1, Math.max(0, progress)) * 2 * Math.PI * radius;
}

/**
 * Whether the arrows point clockwise on screen: tightening is a clockwise sweep when the
 * camera looks along the fastener's into-the-hole axis (crankMath's `tightenSign`), so seen
 * from the far side it is anticlockwise.
 */
export const tightensClockwise = (intoHole: number[], viewDirection: number[]) => tightenSign(intoHole, viewDirection) > 0;

/**
 * The seated tools that get a dial: each tool joint whose host has a bolt or cam seat, as
 * `crankTarget` pairs them — for as long as the tool is seated, home or not, so a tool put
 * on a fastener already partly or fully in shows where it stands.
 */
export function dialEngagements(joints: readonly AssemblyJoint[]): Engagement[] {
  return joints.flatMap((tool) => {
    if (tool.kind !== KIND.TOOL) return [];
    const target = joints.find((j) => j.hardware === tool.host && isCrankKind(j.kind));
    return target ? [{ tool, target }] : [];
  });
}

/**
 * Turned all the way yet not home — a cam with no screwed bolt to catch: its arc is full,
 * but must not read as done.
 */
export const isStalled = (fastener: Fastener) => fastener.progress >= 1 && !isFastened(fastener);
