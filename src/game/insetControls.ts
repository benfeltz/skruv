// The controls on the detail inset: which one a subject gets, how it looks, and where its sub-bubble is attached to the
// circle — the way the manual attaches its tool bubble to a detail inset (src/scene/bookletPages.ts). Pure — CSS px
// [x, y] (y down) in, plain records out; src/ui/insetControls.ts draws, src/scene/insetPanel.ts composes.

import { INSET } from '../constants.js';
import { isTapKind } from './fasteners.js';
import type { InsetSubject } from './insetModel.js';
import type { InsetFrame } from './insetView.js';
import type { ScreenPoint } from './dragMath.js';

/** The spinner turns whatever its subject's `grip` is — a tool or a part circled by hand; the push control seats a dowel, pin or fitting. */
export type ControlKind = 'turn' | 'push';

/**
 * Which way a clockwise sweep of the spinner turns the tool: tightening, as the spinner faces the player. The widget
 * and its tests both read this one sign.
 */
export const RING_SIGN = 1;

/** The control a subject gets: the spinner for a turn (a tool's or a hand's, whatever its `grip` is), the push for a dowel, pin or fitting, none for an offered seat. */
export function controlFor(subject: InsetSubject): ControlKind | null {
  if (subject.joint < 0) return null;
  if (subject.grip !== null) return 'turn';
  return isTapKind(subject.kind) ? 'push' : null;
}

/** The spinner's fill and which arrowheads it shows: how far in, and whether each way can still turn. */
export const turnLook = ({ progress, tighten, loosen }: InsetSubject) => ({ progress, tighten, loosen });

/** The push control's look: filled green once pressed home, its arrowhead the way it can still go (down while seated, up once home). */
export const pushLook = ({ pressed }: InsetSubject) => ({ seated: pressed, head: pressed ? ('out' as const) : ('in' as const) });

/** The sweep the spinner was given, as the radians the tool turns (positive tightens). */
export const ringRadians = (sweep: number) => RING_SIGN * sweep;

/** A sub-bubble on screen: its `centre` and `radius` in CSS px. */
export interface Bubble {
  centre: ScreenPoint;
  radius: number;
}

/**
 * Where a control's bubble is attached to the circle: as the manual's tool bubble is to its inset, a fixed share of
 * the circle's radius, centred that share of the radius out along the lower-right diagonal — partly on the rim,
 * partly off it. Never smaller than `bubble.min`, so it is a finger's size.
 */
export function bubbleOf({ centre, radius }: InsetFrame, { bubble } = INSET.controls): Bubble {
  return { centre: [centre[0] + radius * bubble.at, centre[1] + radius * bubble.at], radius: Math.max(radius * bubble.share, bubble.min) };
}

/** How far the bubble reaches past the circle's rim to the right, CSS px: what the circle leaves room for at the screen's edge. */
export function bubbleOverhang({ radius }: InsetFrame) {
  const { centre: [x], radius: r } = bubbleOf({ centre: [0, 0], radius });
  return Math.max(0, x + r - radius);
}
