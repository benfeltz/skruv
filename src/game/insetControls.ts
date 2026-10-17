// The controls round and beside the detail inset's circle: which one a subject gets, how it looks, where the turn
// ring encircles the circle and where the push arrow sits beside it, clear of the control cluster. Pure — CSS px [x, y] (y down) and world
// vectors in, plain records out; src/ui/insetControls.ts draws, src/scene/insetPanel.ts composes.

import { INSET } from '../constants.js';
import { isTapKind } from './fasteners.js';
import { sub } from '../../tools/validate/lib/geometry.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import type { InsetSubject } from './insetModel.js';
import type { InsetFrame, InsetLayout, InsetPose } from './insetView.js';
import type { ScreenPoint } from './dragMath.js';

/** The ring encircles the circle; the arrow sits beside it. */
export type ControlKind = 'turn' | 'push';

/** A box on screen, CSS px. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Slot = (typeof INSET.controls.slots)[InsetLayout][number];
type Controls = typeof INSET.controls;

/**
 * Which way a clockwise sweep of the ring turns the tool: tightening, as the ring faces the player. The widget and
 * its tests both read this one sign.
 */
export const RING_SIGN = 1;

/** The control a subject gets: a ring for a tool's turn, an arrow for a dowel, pin or fitting, none for an offered seat. */
export function controlFor(subject: InsetSubject): ControlKind | null {
  if (subject.joint < 0) return null;
  if (subject.tool !== null) return 'turn';
  return isTapKind(subject.kind) ? 'push' : null;
}

/** The ring's fill and which arrowheads it shows: how far in, and whether each way can still turn. */
export const turnLook = ({ progress, tighten, loosen }: InsetSubject) => ({ progress, tighten, loosen });

/** The arrow's look: green once pressed home, its head pointing the way it can still go (in while seated, out once home). */
export const pushLook = ({ pressed }: InsetSubject) => ({ seated: pressed, head: pressed ? ('out' as const) : ('in' as const) });

/** The sweep the ring was given, as the radians the tool turns (positive tightens). */
export const ringRadians = (sweep: number) => RING_SIGN * sweep;

/**
 * The turn ring round the circle: it shares the circle's centre, its line `gap` outside the rim; `inner` and
 * `outer` bound its grab band, the inner edge never inside the rim — a press on the circle is the picture's.
 */
export function ringGeometry({ radius }: InsetFrame, { ring }: Controls = INSET.controls) {
  const line = radius + ring.gap;
  return { radius: line, inner: Math.max(radius, line - ring.band), outer: line + ring.band };
}

/** Whether a press is on the ring's grab band round the circle: outside the rim, never on the picture or the room's far side of the band. */
export function ringGrab([x, y]: ScreenPoint, frame: InsetFrame) {
  const { inner, outer } = ringGeometry(frame);
  const distance = Math.hypot(x - frame.centre[0], y - frame.centre[1]);
  return distance >= inner && distance <= outer;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The hole's into-axis as the inset's camera sees it: a screen vector [x, y] (y down) along which the tool's tip
 * points and against which its handle lies. Zero when the axis runs straight along the view.
 */
export function toolScreenDirection(axis: Vec3, { position, target, up }: InsetPose): ScreenPoint {
  const right = cross(sub(target, position), up);
  const span = Math.hypot(...right) * Math.hypot(...up) || 1;
  return [dot(axis, right) / span, -dot(axis, up) / (Math.hypot(...up) || 1)];
}

// Half the side of the arrow's placement box: the reach of what takes a press — its grab box — not just what is drawn.
const halfOf = ({ arrow }: Controls) => Math.max(arrow.length / 2, Math.max(arrow.width, arrow.head) / 2) + arrow.band;

// The slot's centre: the circle's, moved out past its rim, the gap and the control's half-size.
function slotCentre({ centre, radius }: InsetFrame, slot: Slot, controls: Controls): ScreenPoint {
  const reach = radius + controls.gap + halfOf(controls);
  if (slot === 'below') return [centre[0], centre[1] + reach];
  return [centre[0] + (slot === 'left' ? -reach : reach), centre[1]];
}

const collides = (box: ScreenBox, other: ScreenBox, grow: number) =>
  box.left < other.right + grow && box.right > other.left - grow && box.top < other.bottom + grow && box.bottom > other.top - grow;

const within = (box: ScreenBox, bounds: ScreenBox) => box.left >= bounds.left && box.top >= bounds.top && box.right <= bounds.right && box.bottom <= bounds.bottom;

/** What a control keeps clear of and inside: boxes it must not touch (the control cluster, grown by `clusterGap`), and the screen it must fit in. */
export interface Placement {
  obstacles: readonly ScreenBox[];
  bounds: ScreenBox;
}

// The slots the layout offers, the one on the tip's side first, the rest in order.
function slotOrder(layout: InsetLayout, [x, y]: ScreenPoint, controls: Controls): Slot[] {
  const offered: Slot[] = [...controls.slots[layout]];
  // Landscape prefers below for a tip pointing down; portrait keeps to the sides, below only as the last resort.
  const wanted: Slot = layout === 'landscape' && y > Math.abs(x) ? 'below' : x < 0 ? 'left' : 'right';
  return offered.includes(wanted) ? [wanted, ...offered.filter((slot) => slot !== wanted)] : offered;
}

/**
 * Where the push arrow's centre goes beside the circle: the first slot, tip's side first, whose box keeps `clusterGap`
 * clear of every obstacle and lies inside the screen. If no slot does the last is used — a control is never left out.
 */
export function controlSlot(frame: InsetFrame, layout: InsetLayout, tipDirection: ScreenPoint, { obstacles, bounds }: Placement, controls: Controls = INSET.controls) {
  const half = halfOf(controls);
  const centres = slotOrder(layout, tipDirection, controls).map((slot) => slotCentre(frame, slot, controls));
  const free = centres.find(([x, y]) => {
    const box = { left: x - half, top: y - half, right: x + half, bottom: y + half };
    return within(box, bounds) && obstacles.every((obstacle) => !collides(box, obstacle, controls.clusterGap));
  });
  return { centre: free ?? centres[centres.length - 1] };
}
