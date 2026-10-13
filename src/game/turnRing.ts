// Turn ring: the dial a turn shows round what it turns — a seated tool's round the head it
// sits on, a hand-turned part's round its hole — which turns get one, where a finger grabs
// it, which way its arrows point and how full its arc is. One dial per `Turn` (the graph's
// record, src/game/assembly.ts); nothing here re-derives what a turn turns. Pure — screen
// points [x, y] in CSS px (y down), world directions [x, y, z]; the router projects,
// src/ui/turnRing.ts draws.

import { TURN_RING } from '../constants.js';
import { isFastened, isHome } from './fasteners.js';
import { tightenSign } from './crankMath.js';
import type { PartId, Turn } from './assembly.js';
import type { Fastener } from './fasteners.js';
import type { ScreenPoint } from './dragMath.js';


/** The part a turn's press and dial belong to: the seated tool, or the part circled by hand. */
export const gripOf = ({ grip }: Turn): PartId => (grip.kind === 'tool' ? grip.tool.hardware : grip.part);

/** How far a turn's dial is filled: its least-advanced joint's progress, 0..1. */
export const turnProgress = ({ joints }: Turn) => Math.min(...joints.map((j) => j.fastener.progress));

/** Every joint of the turn home — the dial flashes on arriving here. */
export const isTurnHome = ({ joints }: Turn) => joints.length > 0 && joints.every((j) => isHome(j.fastener));

/** Turned all the way yet not home — a cam with no screwed bolt to catch: full, but not done. */
export const isTurnStalled = ({ joints }: Turn) => joints.some((j) => isStalled(j.fastener));

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
 * Whether a turn's dial is drawn. A seated tool's, whenever it has something to turn, home or
 * not — it is the tool's own ring, grabbed to crank it. A part circled by hand shows its ring
 * only while the finger is on the part (`pressed`): the part itself is what is circled, and a
 * built table's legs carry no rings. A turn with nothing to turn (a key on a buried hex) has none.
 */
export const isDrawn = (turn: Turn, pressed: boolean) => turn.joints.length > 0 && (turn.grip.kind === 'tool' || pressed);

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
