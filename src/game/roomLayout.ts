// Where things stand in a room of several worlds (1.9.9.2). Pure — footprints and spots in,
// footprints and spots out — so Vitest checks it headlessly. A kept world stays exactly where
// it is; a new box takes the first free spot, and the camera follows it. The spots are the
// room's, not the world's: the first pick lands on the default spot, `boxPlacement()`.

import { LAYOUT, ROOM } from '../constants.js';
import { boxPlacement } from './boxLayout.js';
import type { PackedBox } from './boxLayout.js';
import type { Pose, Vec3 } from '../../tools/validate/lib/geometry.js';

/** A rectangle on the floor: `[minX, minZ, maxX, maxZ]`. */
export type Footprint = [number, number, number, number];

/** A camera pose: where it stands and what it looks at. */
export interface View {
  position: Vec3;
  target: Vec3;
}

/** The `[minX, minZ, maxX, maxZ]` of `positions`, grown by `pad` on every side. */
export function footprintOf(positions: Vec3[], pad: number): Footprint {
  const xs = positions.map(([x]) => x);
  const zs = positions.map(([, , z]) => z);
  return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
}

/** The `[x, z]` extent of a box on the floor at its placed yaw: its outside, turned. */
export function boxFootprintSize(box: Pick<PackedBox, 'inner' | 'wall' | 'yaw'>): [number, number] {
  const width = box.inner[0] + 2 * box.wall;
  const length = box.inner[2] + 2 * box.wall;
  const [cos, sin] = [Math.abs(Math.cos(box.yaw)), Math.abs(Math.sin(box.yaw))];
  return [width * cos + length * sin, width * sin + length * cos];
}

/** The footprint of a box of `size` standing at `at`, padded. */
function boxFootprintAt(at: Vec3, size: [number, number]): Footprint {
  const [halfX, halfZ] = [size[0] / 2 + LAYOUT.pad, size[1] / 2 + LAYOUT.pad];
  return [at[0] - halfX, at[2] - halfZ, at[0] + halfX, at[2] + halfZ];
}

/** The area two footprints share. */
function overlap(a: Footprint, b: Footprint): number {
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const depth = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return width > 0 && depth > 0 ? width * depth : 0;
}

/**
 * The candidate box placements, in order: the default spot, then the same spot shifted along the
 * room's width by +pitch, -pitch, +2 pitch, … while the box (of `size`) stays inside the room
 * less the margin; then a second row `rowDepth` further back, and so on until a row leaves the room.
 */
export function spots(size: [number, number], box: Pose = boxPlacement()): Pose[] {
  const [x, y, z] = box.position;
  const [reachX, reachZ] = [ROOM.width / 2 - LAYOUT.margin - size[0] / 2, ROOM.depth / 2 - LAYOUT.margin - size[1] / 2];
  const fits = ([x, , z]: Vec3) => Math.abs(x) <= reachX && Math.abs(z) <= reachZ;
  const out: Pose[] = [box];
  const reach = Math.ceil(ROOM.width / LAYOUT.pitch);
  for (let row = 0; ; row++) {
    const rowZ = z - row * LAYOUT.rowDepth;
    const inRow: Pose[] = [];
    for (let step = row === 0 ? 1 : 0; step <= reach; step++) {
      for (const sign of step === 0 ? [1] : [1, -1]) {
        const at: Vec3 = [x + sign * step * LAYOUT.pitch, y, rowZ];
        if (fits(at)) inRow.push({ position: at, rotation: box.rotation });
      }
    }
    if (row > 0 && inRow.length === 0) break;
    out.push(...inRow);
  }
  return out;
}

/**
 * Where a box of `size` goes among `occupied` footprints: the first spot whose footprint
 * overlaps none of them; if none is free, the spot with the least total overlap.
 */
export function freeSpot(occupied: Footprint[], size: [number, number], box: Pose = boxPlacement()): Pose {
  const crowding = (spot: Pose) => occupied.reduce((sum, other) => sum + overlap(boxFootprintAt(spot.position, size), other), 0);
  const candidates = spots(size, box);
  return candidates.find((spot) => crowding(spot) === 0) ?? candidates.reduce((best, spot) => (crowding(spot) < crowding(best) ? spot : best));
}

/** `view` carried by the offset of the spot `at` from the default spot, so the new box sits where the first box sat. */
export function framedAt(at: Pose, view: View, box: Pose = boxPlacement()): View {
  const offset = at.position.map((v, i) => v - box.position[i]);
  const shift = (v: Vec3): Vec3 => [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]];
  return { position: shift(view.position), target: shift(view.target) };
}

/** The nearest of `distances`, nulls (a miss) dropped; null when all missed. */
export function nearest(distances: (number | null)[]): number | null {
  const hits = distances.filter((d): d is number => d !== null);
  return hits.length === 0 ? null : Math.min(...hits);
}
