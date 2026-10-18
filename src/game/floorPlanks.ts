// The hardwood floor as pure data — no Three, no DOM. Stage frame, y up, the slab's top at y = 0: boards laid in a
// running bond over the slab's whole top, rows along x (the long wall), each row's butt joints staggered from the
// row before. Visual only: the physics slab is `stageBoxes()`'s, untouched; the room draws `floorBase` under these.

import { STAGE } from '../constants.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { seeded } from './seeded.js';
import { stageBoxes } from './stageBoxes.js';
import type { StageBox } from './stageBoxes.js';

/** One board: a box in the stage frame and an index into the tones. */
export interface Plank {
  min: Vec3;
  max: Vec3;
  tone: number;
}

type Floor = typeof STAGE.floor;

/** The slab's box, whose footprint the planks cover and whose top is the floor. */
export function slabBox(): StageBox<'slab'> {
  return stageBoxes().find((box) => box.name === 'slab') as StageBox<'slab'>;
}

/** The slab as drawn under the planks: the same footprint, its top lowered by the planks' thickness. */
export function floorBase(slab: StageBox<'slab'>, thickness: number = STAGE.floor.plankThickness): { min: Vec3; max: Vec3 } {
  return { min: [...slab.min], max: [slab.max[0], slab.max[1] - thickness, slab.max[2]] };
}

/** One row's boards between `z0` and `z1`: a seeded short first board, then seeded lengths, the last trimmed to the edge. */
function rowPlanks(slab: StageBox<'slab'>, floor: Floor, tones: number, z0: number, z1: number, next: () => number): Plank[] {
  const [minLength, maxLength] = floor.plankLength;
  const planks: Plank[] = [];
  let x = slab.min[0];
  let previous = -1;
  let length = minLength * next();
  while (x < slab.max[0]) {
    const end = Math.min(x + length, slab.max[0]);
    let tone = Math.floor(next() * tones);
    if (tone === previous && tones > 1) tone = (tone + 1 + Math.floor(next() * (tones - 1))) % tones;
    planks.push({ min: [x, -floor.plankThickness, z0], max: [end, 0, z1], tone });
    previous = tone;
    x = end;
    length = minLength + (maxLength - minLength) * next();
  }
  return planks;
}

/** The whole floor: rows of `plankWidth` from the slab's near edge, the last trimmed to the far edge. */
export function floorPlanks(slab: StageBox<'slab'> = slabBox(), floor: Floor = STAGE.floor, tones: number = STAGE.floor.tones.length): Plank[] {
  const next = seeded(floor.seed);
  const planks: Plank[] = [];
  for (let z = slab.min[2]; z < slab.max[2]; z += floor.plankWidth) {
    planks.push(...rowPlanks(slab, floor, tones, z, Math.min(z + floor.plankWidth, slab.max[2]), next));
  }
  return planks;
}
