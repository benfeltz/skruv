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

/** Float slack when comparing a joint's distance to the gap it was moved to. */
const JOINT_EPS = 1e-9;

/** The slab's box, whose footprint the planks cover and whose top is the floor. */
export function slabBox(): StageBox<'slab'> {
  return stageBoxes().find((box) => box.name === 'slab') as StageBox<'slab'>;
}

/** The slab as drawn under the planks: the same footprint, its top lowered by the planks' thickness. */
export function floorBase(slab: StageBox<'slab'>, thickness: number = STAGE.floor.plankThickness): { min: Vec3; max: Vec3 } {
  return { min: [...slab.min], max: [slab.max[0], slab.max[1] - thickness, slab.max[2]] };
}

/** `end` moved the least distance to lie in [`lo`, `hi`] and at least `gap` from every joint of the row before. */
function clearOfJoints(end: number, lo: number, hi: number, previous: number[], gap: number): number {
  const clear = (c: number) => c >= lo && c <= hi && previous.every((j) => Math.abs(c - j) >= gap - JOINT_EPS);
  const candidates = [end, ...previous.flatMap((j) => [j - gap, j + gap])].filter(clear);
  return candidates.reduce((best, c) => (Math.abs(c - end) < Math.abs(best - end) ? c : best), candidates[0] ?? end);
}

/**
 * One row's boards between `z0` and `z1`: a seeded short first board, then seeded lengths, every butt joint kept
 * `jointGap` from the row before's, and a leftover under `minEnd` folded into the last board so the row reaches the edge.
 */
function rowPlanks(slab: StageBox<'slab'>, floor: Floor, tones: number, z0: number, z1: number, next: () => number, above: number[]): Plank[] {
  const [minLength, maxLength] = floor.plankLength;
  const planks: Plank[] = [];
  const edge = slab.max[0];
  let x = slab.min[0];
  let previous = -1;
  let [lo, hi] = [floor.minEnd, minLength];
  while (x < edge) {
    let end = clearOfJoints(x + lo + (hi - lo) * next(), x + lo, x + hi, above, floor.jointGap);
    if (end > edge - floor.minEnd) end = edge;
    let tone = Math.floor(next() * tones);
    if (tone === previous && tones > 1) tone = (tone + 1 + Math.floor(next() * (tones - 1))) % tones;
    planks.push({ min: [x, -floor.plankThickness, z0], max: [end, 0, z1], tone });
    previous = tone;
    x = end;
    [lo, hi] = [minLength, maxLength];
  }
  return planks;
}

/** The whole floor: rows of `plankWidth` from the slab's near edge, the last trimmed to the far edge. */
export function floorPlanks(slab: StageBox<'slab'> = slabBox(), floor: Floor = STAGE.floor, tones: number = STAGE.floor.tones.length): Plank[] {
  const next = seeded(floor.seed);
  const planks: Plank[] = [];
  let above: number[] = [];
  for (let z = slab.min[2]; z < slab.max[2]; z += floor.plankWidth) {
    const row = rowPlanks(slab, floor, tones, z, Math.min(z + floor.plankWidth, slab.max[2]), next, above);
    above = row.slice(0, -1).map((p) => p.max[0]);
    planks.push(...row);
  }
  return planks;
}
