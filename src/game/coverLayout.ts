// The catalog cover's room corner (1.9.1), as numbers: where each item stands and how big the
// floor and two walls are. Pure — src/scene/catalogPages.ts draws what this lays out.

import { rotatedHalfExtents } from './dragMath.js';
import type { Size, Vec3 } from '../../tools/validate/lib/geometry.js';

/** An item's box built: the least and greatest corner of its parts, in its own frame. */
export interface Extent {
  min: Vec3;
  max: Vec3;
}

/** The extent of `parts` posed as they are, each part a box of its type's `size`. */
export function extentOf(parts: readonly { type: string; position: Vec3; rotation: readonly number[] }[], sizeOf: (type: string) => Size): Extent {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { type, position, rotation } of parts) {
    const half = rotatedHalfExtents(sizeOf(type).map((d) => d / 2), [...rotation]);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], position[i] - half[i]);
      max[i] = Math.max(max[i], position[i] + half[i]);
    }
  }
  return { min, max };
}

/** The room corner's spacing (CATALOG.cover): between items, round them, wall height per tallest item, slab thickness. */
export interface CoverSpacing {
  gap: number;
  margin: number;
  wallRise: number;
  slab: number;
}

/** One of the room corner's slabs: its name, its box, and where its centre sits. */
export interface CoverSlab {
  name: 'floor' | 'back' | 'left';
  size: Size;
  at: Vec3;
}

/**
 * The cover's room corner for items of `extents`, in order: each item's `offset` puts it on
 * the floor (y = 0), its back face on the back wall's line (z = 0), side by side along x from
 * x = 0 with `gap` between them; the floor and the back and left walls reach `margin` past
 * them, the walls `wallRise` times the tallest item high, every slab `slab` thick, outside
 * the corner's lines.
 */
export function coverLayout(extents: readonly Extent[], { gap, margin, wallRise, slab }: CoverSpacing) {
  const offsets: Vec3[] = [];
  let x = 0;
  let depth = 0;
  let height = 0;
  for (const { min, max } of extents) {
    offsets.push([x - min[0], -min[1], -min[2]]);
    x += max[0] - min[0] + gap;
    depth = Math.max(depth, max[2] - min[2]);
    height = Math.max(height, max[1] - min[1]);
  }
  const width = Math.max(0, x - gap) + 2 * margin;
  const floorDepth = depth + 2 * margin;
  const wall = height * wallRise;
  const room: CoverSlab[] = [
    { name: 'floor', size: [width, slab, floorDepth], at: [width / 2 - margin, -slab / 2, floorDepth / 2 - margin] },
    { name: 'back', size: [width, wall, slab], at: [width / 2 - margin, wall / 2, -margin - slab / 2] },
    { name: 'left', size: [slab, wall, floorDepth], at: [-margin - slab / 2, wall / 2, floorDepth / 2 - margin] },
  ];
  return { offsets, room };
}
