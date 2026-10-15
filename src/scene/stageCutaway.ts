// Pure cutaway rule for the diorama — no Three, no DOM — so Vitest covers it headlessly.
//
// A wall is drawn only while the eye is on its inner side: from behind it, the wall would
// stand between the camera and the room, so it is hidden (its ink lines with it).

import { ROOM } from '../constants.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

/** A wall by its inner face: a point on it and the unit normal pointing into the room. */
export interface Wall {
  point: Vec3;
  inward: Vec3;
}

/** The two walls the stage has, derived from the room: back (−z) and left (−x). */
export const STAGE_WALLS = {
  back: { point: [0, 0, -ROOM.depth / 2], inward: [0, 0, 1] },
  left: { point: [-ROOM.width / 2, 0, 0], inward: [1, 0, 0] },
} satisfies Record<string, Wall>;

/** Whether `eye` is on the outer side of the wall's inner face; exactly on it counts as visible. */
export function wallHidden(eye: Vec3, { point, inward }: Wall): boolean {
  return (eye[0] - point[0]) * inward[0] + (eye[1] - point[1]) * inward[1] + (eye[2] - point[2]) * inward[2] < 0;
}
