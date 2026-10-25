// A drawer on its runners, in numbers. Pure: plain arrays in and out, no Three, Rapier or
// DOM, so Vitest covers it headlessly. The travel is how far the slide's host moves from
// closed to open; the assembly and the gesture router share these four functions.

import { rotateVector, sub } from '../../tools/validate/lib/geometry.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { AssembledPart } from '../../tools/validate/lib/pack.js';
import type { ScreenPoint } from './dragMath.js';

/**
 * A part's travel in its own frame: its open position less its closed one, turned back by
 * the part's closed rotation. Null without an open
 * pose, which is how a part that never slides says so.
 */
export function localTravel(part: Pick<AssembledPart, 'position' | 'rotation' | 'open'>): Vec3 | null {
  if (!part.open) return null;
  const [x, y, z, w] = part.rotation;
  const inverse: Quat = [-x, -y, -z, w];
  return rotateVector(inverse, sub(part.open.position, part.position));
}

/** A part's travel in the pack's frame: its open position less its closed one. Null without an open pose. */
export function worldTravel(part: Pick<AssembledPart, 'position' | 'open'>): Vec3 | null {
  return part.open ? sub(part.open.position, part.position) : null;
}

/** A position along the travel held to the drawer's limits `[0, travel]`. */
export const clampTravel = (t: number, travel: number) => Math.min(Math.max(t, 0), travel);

/** Whether a position is past the open limit by more than `pullOut`: the drawer comes off. */
export const pastOpen = (t: number, travel: number, pullOut: number) => t > travel + pullOut;

/**
 * Pixels per metre of travel along an axis probed on screen: the on-screen distance between
 * a point and the point `probe` metres along the axis, over `probe`. Zero for a degenerate
 * axis (a drawer seen end-on), so it does not move.
 */
export function pixelsPerMetre([fx, fy]: ScreenPoint, [tx, ty]: ScreenPoint, probe: number) {
  return probe > 0 ? Math.hypot(tx - fx, ty - fy) / probe : 0;
}
