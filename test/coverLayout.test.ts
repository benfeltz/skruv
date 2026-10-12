import { describe, expect, it } from 'vitest';
import { coverLayout, extentOf } from '../src/game/coverLayout.js';
import type { Size, Vec3 } from '../tools/validate/lib/geometry.js';

// The catalog cover's room corner (1.9.1), headless: items stood on the floor against the
// back wall, side by side, the floor and walls round them. How it looks drawn is a manual check.

const UPRIGHT = [0, 0, 0, 1];
const QUARTER_Y = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const sizes: Record<string, Size> = { slab: [2, 1, 0.5] };
const sizeOf = (type: string) => sizes[type];

describe('extentOf', () => {
  it('spans the posed boxes, a turned one by its turned size', () => {
    expect(extentOf([{ type: 'slab', position: [0, 0.5, 0], rotation: UPRIGHT }], sizeOf)).toEqual({ min: [-1, 0, -0.25], max: [1, 1, 0.25] });
    const turned = extentOf([{ type: 'slab', position: [0, 0.5, 0], rotation: QUARTER_Y }], sizeOf);
    expect(turned.min.map((v) => +v.toFixed(9))).toEqual([-0.25, 0, -1]);
    expect(turned.max.map((v) => +v.toFixed(9))).toEqual([0.25, 1, 1]);
  });

  it('takes in every part', () => {
    const { min, max } = extentOf(
      [
        { type: 'slab', position: [0, 0.5, 0], rotation: UPRIGHT },
        { type: 'slab', position: [3, 2.5, 1], rotation: UPRIGHT },
      ],
      sizeOf,
    );
    expect(min).toEqual([-1, 0, -0.25]);
    expect(max).toEqual([4, 3, 1.25]);
  });
});

describe('coverLayout', () => {
  const spacing = { gap: 0.5, margin: 0.6, wallRise: 1.5, slab: 0.03 };
  const a = { min: [-1, -2, -0.5] as Vec3, max: [1, 0, 0.5] as Vec3 }; // 2 wide, 2 tall, 1 deep
  const b = { min: [0, 0, 0] as Vec3, max: [3, 1, 2] as Vec3 }; // 3 wide, 1 tall, 2 deep

  it('stands each item on the floor, its back on the back wall, side by side with gaps', () => {
    const { offsets } = coverLayout([a, b], spacing);
    // + 0 folds a signed zero (-min of 0) into 0.
    expect(offsets.map((offset) => offset.map((v) => v + 0))).toEqual([
      [1, 2, 0.5],
      [2.5, 0, 0],
    ]);
    // Moved, each item's least corner sits at its slot: x, floor, back wall.
    expect(a.min.map((v, i) => v + offsets[0][i])).toEqual([0, 0, 0]);
    expect(b.min.map((v, i) => v + offsets[1][i])).toEqual([2.5, 0, 0]);
  });

  it('sizes the floor and walls round them: margin past the row and the deepest, walls wallRise × the tallest', () => {
    const { room } = coverLayout([a, b], spacing);
    const width = 2 + 0.5 + 3 + 2 * 0.6;
    const depth = 2 + 2 * 0.6;
    const wall = 2 * 1.5;
    const [floor, back, left] = room;
    expect(floor).toEqual({ name: 'floor', size: [width, 0.03, depth], at: [width / 2 - 0.6, -0.015, depth / 2 - 0.6] });
    expect(back).toEqual({ name: 'back', size: [width, wall, 0.03], at: [width / 2 - 0.6, wall / 2, -0.6 - 0.015] });
    expect(left).toEqual({ name: 'left', size: [0.03, wall, depth], at: [-0.6 - 0.015, wall / 2, depth / 2 - 0.6] });
  });

  it('with no items, still lays a margin-wide corner', () => {
    const { offsets, room } = coverLayout([], spacing);
    expect(offsets).toEqual([]);
    expect(room[0].size).toEqual([1.2, 0.03, 1.2]);
    expect(room[1].size[1]).toBe(0);
  });
});
