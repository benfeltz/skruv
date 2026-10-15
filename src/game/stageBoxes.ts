// Pure geometry of the diorama stage — no Three, no Rapier — so the drawn room and its
// colliders are built from the same boxes and Vitest covers them headlessly.
//
// Everything stands OUTSIDE the floor's footprint (|x| <= width/2, |z| <= depth/2), except
// the slab under y = 0, so the clamps that read ROOM (drag, lift, snap, respawn) are
// unchanged: the floor's top face is the slab's top face, at y = 0.

import { ROOM, STAGE } from '../constants.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

export type StageBoxName = 'slab' | 'backWall' | 'leftWall' | 'frontLip' | 'rightLip';

/** An axis-aligned box by its corners. `outward` is the way its invisible side may be thickened. */
export interface StageBox {
  name: StageBoxName;
  min: Vec3;
  max: Vec3;
  outward: Vec3;
}

/** The five boxes of the stage, in metres, floor top at y = 0. */
export function stageBoxes(): StageBox[] {
  const w = ROOM.width / 2;
  const d = ROOM.depth / 2;
  const { wallThickness: wt, wallHeight, slabThickness: st, lipHeight, lipThickness: lt } = STAGE;
  return [
    { name: 'slab', min: [-w - wt, -st, -d - wt], max: [w + lt, 0, d + lt], outward: [0, -1, 0] },
    { name: 'backWall', min: [-w - wt, 0, -d - wt], max: [w + lt, wallHeight, -d], outward: [0, 0, -1] },
    { name: 'leftWall', min: [-w - wt, 0, -d], max: [-w, wallHeight, d + lt], outward: [-1, 0, 0] },
    { name: 'frontLip', min: [-w, 0, d], max: [w + lt, lipHeight, d + lt], outward: [0, 0, 0] },
    { name: 'rightLip', min: [w, 0, -d], max: [w + lt, lipHeight, d], outward: [0, 0, 0] },
  ];
}

/** The box grown on its outward side until it is `thickness` thick there — where nothing is drawn. */
export function thickened({ min, max, outward, ...rest }: StageBox, thickness: number): StageBox {
  const lo = min.map((v, i) => (outward[i] < 0 ? Math.min(v, max[i] - thickness) : v)) as Vec3;
  const hi = max.map((v, i) => (outward[i] > 0 ? Math.max(v, min[i] + thickness) : v)) as Vec3;
  return { ...rest, min: lo, max: hi, outward };
}

/**
 * The boxes the physics world holds: the drawn ones, the slab and walls thickened on their
 * invisible side to `thickness` so a fast part cannot tunnel through, the walls carried up
 * to `ROOM.height` (the lift ceiling — a lifted part never goes over a wall), the lips
 * exactly as drawn so a part is stopped by what it sees.
 */
export function colliderBoxes(thickness: number): StageBox[] {
  return stageBoxes().map((box) => {
    if (box.name === 'slab') return thickened(box, thickness);
    if (box.name.endsWith('Wall')) {
      const solid = thickened(box, thickness);
      return { ...solid, max: [solid.max[0], ROOM.height, solid.max[2]] };
    }
    return box;
  });
}

/** `[size, centre]` of a box. */
export function sizeAndCentre({ min, max }: StageBox): { size: Vec3; centre: Vec3 } {
  return {
    size: max.map((v, i) => v - min[i]) as Vec3,
    centre: max.map((v, i) => (v + min[i]) / 2) as Vec3,
  };
}
