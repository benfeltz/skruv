// Turn ring: the dial a seated tool shows round the head of the fastener it drives — which
// tools get one, where a finger grabs it, which way its arrows point and how full its arc
// is. Pure — screen points [x, y] in CSS px (y down), world directions [x, y, z]; the router
// projects, src/ui/turnRing.ts draws.

import { TURN_RING } from '../constants.js';
import { isCrankKind, isFastened, isHandTurned } from './fasteners.js';
import { tightenSign } from './crankMath.js';
import { KIND } from '../../tools/validate/lib/vocabulary.js';
import type { AssemblyJoint } from './assembly.js';
import type { Fastener } from './fasteners.js';
import type { ScreenPoint } from './dragMath.js';

/** A fastener seat being turned, and by what: a seated tool, or (null) the finger on the part itself. */
export interface Engagement {
  tool: AssemblyJoint | null;
  target: AssemblyJoint;
}

/** The part whose press this engagement is: the tool, or the hand-turned part itself. */
export const engagedPart = ({ tool, target }: Engagement) => (tool ? tool.hardware : target.mover);

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
 * The seated tools that get a dial: each tool joint whose host has a bolt, stud or cam seat,
 * as `crankTarget` pairs them — for as long as the tool is seated, home or not, so a tool put
 * on a fastener already partly or fully in shows where it stands. Then every hand-turned
 * part not yet home (a leg on its stud), one dial each, tool null — a part set onto several
 * studs at once (a top on four) turns them together and shows one, on its first: home, it
 * has nothing left to show.
 */
export function dialEngagements(
  joints: readonly AssemblyJoint[],
  // What a tool turns: the graph's `crankTarget` (the far end of a stud), by default the host's first crank seat.
  targetOf: (tool: AssemblyJoint) => AssemblyJoint | null = (tool) => joints.find((j) => j.hardware === tool.host && isCrankKind(j.kind)) ?? null,
): Engagement[] {
  const tooled = joints.flatMap((tool) => {
    if (tool.kind !== KIND.TOOL) return [];
    const target = targetOf(tool);
    return target ? [{ tool, target }] : [];
  });
  const driven = new Set(tooled.map(({ target }) => target));
  const byHand: Engagement[] = [];
  const turned = new Set<string>();
  for (const target of joints) {
    if (!isHandTurned(target) || driven.has(target) || isHome(target.fastener) || turned.has(target.mover)) continue;
    turned.add(target.mover);
    byHand.push({ tool: null, target });
  }
  return [...tooled, ...byHand];
}

/** All the way home: fastened and fully turned — a screwed bolt backed off partway is not. */
export const isHome = (fastener: Fastener) => isFastened(fastener) && fastener.progress >= 1;

/**
 * Of the dials whose grab band takes `point`, the one a press there means: one whose
 * fastener is still to go home before one that is (JOHNNY's cam ring all but covers the bolt
 * head's), then the one whose ring line is nearest the press. Null if no band takes it.
 */
export function pickDial<T extends { centre: ScreenPoint; home: boolean }>(point: ScreenPoint, dials: readonly T[], ring: { radius: number; band: number } = TURN_RING): T | null {
  const off = (dial: T) => Math.abs(Math.hypot(point[0] - dial.centre[0], point[1] - dial.centre[1]) - ring.radius);
  const hits = dials.filter((dial) => dialHit(point, dial.centre, ring));
  hits.sort((a, b) => Number(a.home) - Number(b.home) || off(a) - off(b));
  return hits[0] ?? null;
}

/**
 * Turned all the way yet not home — a cam with no screwed bolt to catch: its arc is full,
 * but must not read as done.
 */
export const isStalled = (fastener: Fastener) => fastener.progress >= 1 && !isFastened(fastener);
