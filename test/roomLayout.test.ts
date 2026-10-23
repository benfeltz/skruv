import { afterAll, describe, expect, it } from 'vitest';
import { BOX, CAMERA, LAYOUT, ROOM } from '../src/constants.js';
import { baseRest, boxPlacement, createPackedWorldLayout, lidRest, packedBox } from '../src/game/boxLayout.js';
import { ITEM_IDS, PART_TYPES, setItem } from '../src/game/item.js';
import type { Pose, Vec3 } from '../tools/validate/lib/geometry.js';
import { boxFootprintSize, footprintOf, framedAt, freeSpot, nearest, spots } from '../src/game/roomLayout.js';
import type { Footprint } from '../src/game/roomLayout.js';

// Where a new box goes among the worlds the room already holds, and where the camera follows.

const SMALL: [number, number] = [0.6, 0.5];
const at = (x: number, z: number) => ({ position: [x, 0, z] as [number, number, number], rotation: boxPlacement().rotation });
const around = (x: number, z: number, size = SMALL): Footprint => [x - size[0] / 2 - LAYOUT.pad, z - size[1] / 2 - LAYOUT.pad, x + size[0] / 2 + LAYOUT.pad, z + size[1] / 2 + LAYOUT.pad];

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
const point = (x: number, y: number, z: number) => ({ position: [x, y, z] as Vec3, rotation: IDENTITY, half: [0, 0, 0] as Vec3 });

describe('footprintOf', () => {
  it('is the bounds of the bodies grown by the pad', () => {
    expect(footprintOf([point(0, 1, 0), point(2, 0, -1), point(1, 5, 3)], 0.5)).toEqual([-0.5, -1.5, 2.5, 3.5]);
  });

  it("covers each body's whole box, turned, not just its centre", () => {
    // A 2 × 0.4 board, its length turned onto z by a quarter turn about y.
    const board = { position: [1, 0, 0] as Vec3, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number], half: [1, 0.1, 0.2] as Vec3 };
    const [minX, minZ, maxX, maxZ] = footprintOf([board], 0.1);
    expect([minX, minZ, maxX, maxZ].map((v) => Number(v.toFixed(9)))).toEqual([0.7, -1.1, 1.3, 1.1]);
  });
});

describe('a box picked after another', () => {
  // A world just unboxed, as the room measures it: its box, lid and every packed part.
  const boxedAt = (pose: Pose): Footprint => {
    const bodies = [
      { ...baseRest(pose), type: 'boxBase' },
      { ...lidRest(pose), type: 'boxLid' },
      ...createPackedWorldLayout(pose),
    ];
    return footprintOf(bodies.map(({ type, position, rotation }) => ({ position, rotation, half: PART_TYPES[type].size.map((d) => d / 2) as Vec3 })), LAYOUT.pad);
  };
  const boxOnly = (pose: Pose): Footprint => {
    const [sx, sz] = boxFootprintSize(packedBox());
    return [pose.position[0] - sx / 2, pose.position[2] - sz / 2, pose.position[0] + sx / 2, pose.position[2] + sz / 2];
  };
  const apart = (a: Footprint, b: Footprint) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
  afterAll(() => setItem('johnny'));

  for (const first of ITEM_IDS) {
    for (const second of ITEM_IDS.filter((id) => id !== first)) {
      it(`never lands in the first's box: ${first}, then ${second}`, () => {
        setItem(first);
        const kept = boxedAt(boxPlacement());
        const firstBox = boxOnly(boxPlacement());
        setItem(second);
        const at = freeSpot([kept], boxFootprintSize(packedBox()));
        expect(apart(firstBox, boxOnly(at)), `${second} at ${at.position}`).toBe(true);
        // A free spot was found, not the least crowded taken one.
        expect(apart(kept, boxedAt(at))).toBe(true);
      });
    }
  }
});

describe('boxFootprintSize', () => {
  it('turns the box by its yaw', () => {
    const [x, z] = boxFootprintSize({ ...packedBox(), yaw: Math.PI / 2 });
    const [width, , length] = packedBox().inner;
    expect(x).toBeCloseTo(length + 2 * packedBox().wall);
    expect(z).toBeCloseTo(width + 2 * packedBox().wall);
  });
});

describe('spots', () => {
  const all = spots(SMALL);

  it('starts at the default spot exactly', () => {
    expect(all[0]).toEqual(boxPlacement());
    expect(all[0].position).toEqual(BOX.position);
  });

  it('alternates sides along the row', () => {
    expect(all[1].position[0]).toBeCloseTo(BOX.position[0] + LAYOUT.pitch);
    expect(all[2].position[0]).toBeCloseTo(BOX.position[0] - LAYOUT.pitch);
  });

  it('keeps the box inside the room less the margin', () => {
    for (const { position: [x, , z] } of all) {
      expect(Math.abs(x) + SMALL[0] / 2).toBeLessThanOrEqual(ROOM.width / 2 - LAYOUT.margin + 1e-9);
      expect(Math.abs(z) + SMALL[1] / 2).toBeLessThanOrEqual(ROOM.depth / 2 - LAYOUT.margin + 1e-9);
    }
  });

  it('has a second row further back', () => {
    const back = all.filter((s) => s.position[2] < BOX.position[2] - 1e-9);
    expect(back.length).toBeGreaterThan(0);
    expect(back[0].position[2]).toBeCloseTo(BOX.position[2] - LAYOUT.rowDepth);
  });

  it('has fewer spots for a bigger box', () => {
    expect(spots([2.1, 0.9]).length).toBeLessThan(all.length);
  });
});

describe('freeSpot', () => {
  it('is the default spot in an empty room', () => {
    expect(freeSpot([], SMALL)).toEqual(boxPlacement());
  });

  it('moves to the first side spot when the default is taken', () => {
    const taken = [around(BOX.position[0], BOX.position[2])];
    expect(freeSpot(taken, SMALL)).toEqual(spots(SMALL).find((s) => s.position[2] === BOX.position[2] && s.position[0] !== BOX.position[0]));
  });

  it('moves to the second row when the first is full', () => {
    const row = spots(SMALL).filter((s) => s.position[2] === BOX.position[2]).map((s) => around(s.position[0], s.position[2]));
    expect(freeSpot(row, SMALL).position[2]).toBeCloseTo(BOX.position[2] - LAYOUT.rowDepth);
  });

  it('takes the least crowded spot when every spot is taken', () => {
    const everywhere = spots(SMALL).map((s) => around(s.position[0], s.position[2], [1, 1]));
    const lonely = spots(SMALL)[3];
    everywhere.push(around(lonely.position[0], lonely.position[2], [1, 1]));
    const chosen = freeSpot(everywhere, SMALL);
    expect(spots(SMALL)).toContainEqual(chosen);
  });
});

describe('framedAt', () => {
  const start = { position: [...CAMERA.startPosition] as [number, number, number], target: [...CAMERA.startTarget] as [number, number, number] };

  it('is the start view at the default spot', () => {
    expect(framedAt(boxPlacement(), start)).toEqual(start);
  });

  it('moves position and target by the spot\'s offset', () => {
    const view = framedAt(at(BOX.position[0] + 1.6, BOX.position[2] - 1.3), start);
    expect(view.position[0]).toBeCloseTo(start.position[0] + 1.6);
    expect(view.target[0]).toBeCloseTo(start.target[0] + 1.6);
    expect(view.position[2]).toBeCloseTo(start.position[2] - 1.3);
    expect(view.target[2]).toBeCloseTo(start.target[2] - 1.3);
    expect(view.position[1]).toBe(start.position[1]);
  });
});

describe('nearest', () => {
  it('is the smallest hit, misses dropped', () => {
    expect(nearest([null, 3, 1.5, null])).toBe(1.5);
  });

  it('is null when every world missed', () => {
    expect(nearest([null, null])).toBeNull();
    expect(nearest([])).toBeNull();
  });
});
