// Pure cutaway rule for the diorama — no Three, no DOM — so Vitest covers it headlessly.
//
// A wall is drawn only while the eye is on its inner side: from behind it, the wall would
// stand between the camera and the room, so it is hidden (its ink lines with it).

import { stageBoxes } from '../game/stageBoxes.js';
import type { StageBox } from '../game/stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

/** A wall by its inner face: a point on it and the unit normal pointing into the room. */
export interface Wall {
  point: Vec3;
  inward: Vec3;
}

// A wall box's inner face: the face opposite its outward side, normal pointing the other way.
function innerFace({ min, max, outward }: StageBox): Wall {
  const point = outward.map((o, i) => (o < 0 ? max[i] : o > 0 ? min[i] : 0)) as Vec3;
  return { point, inward: outward.map((o) => 0 - o) as Vec3 };
}

const boxNamed = (name: string) => stageBoxes().find((box) => box.name === name)!;

/** The two walls the stage has, from the same boxes the room draws: back (−z) and left (−x). */
export const STAGE_WALLS = {
  back: innerFace(boxNamed('backWall')),
  left: innerFace(boxNamed('leftWall')),
} satisfies Record<string, Wall>;

/**
 * Whether `eye` is on the outer side of the wall's inner face — behind it, or inside its
 * thickness — and so the wall is cut away; exactly on the face counts as visible.
 */
export function wallHidden(eye: Vec3, { point, inward }: Wall): boolean {
  return (eye[0] - point[0]) * inward[0] + (eye[1] - point[1]) * inward[1] + (eye[2] - point[2]) * inward[2] < 0;
}
