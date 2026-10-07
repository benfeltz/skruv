import { describe, expect, it } from 'vitest';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import { CAMERA_LIMITS, RESET, ROOM } from '../src/constants.js';
import { boxPlacement, createPackedWorldLayout, lidRest, PACKED_BOX as BOX, respawnSpots } from '../src/game/boxLayout.js';
import { MANIFEST, PACKING, PART_TYPES } from '../src/game/item.js';

// The flatpack in the room: the pack's packed placements carried to where the box stands,
// the lid closed over them, and the patch recovered parts are set down in.

const [width, height, length] = BOX.inner;
const EPS = 1e-9;

// Box-local extents of a part as packed: footprint across x/z, its own height up y.
const extents = (p) => {
  const half = PART_TYPES[p.type].size.map((d) => d / 2);
  return [0, 1, 2].map((axis) =>
    [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(p.rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)))[axis]), 0),
  );
};

describe('the box as packed', () => {
  it('takes its inside, walls and lid from the pack, and its place from the room', () => {
    expect(BOX).toMatchObject({ inner: PACKING.boxInner, wall: PACKING.wall, floor: PACKING.floor, lidThickness: PACKING.lid.thickness });
    expect(BOX.position).toEqual([0, 0, 0.6]);
    expect(BOX.yaw).toBeCloseTo(Math.PI / 2, 12);
  });

  it('spawns every manifest instance, typed, carried by the box placement', () => {
    const world = createPackedWorldLayout();
    expect(world.map(({ id, type }) => ({ id, type }))).toEqual(MANIFEST);
    const { position, rotation } = boxPlacement();
    PACKING.placements.forEach((local, i) => {
      const expected = rotateVector(rotation, local.position).map((v, k) => v + position[k]);
      expected.forEach((v, k) => expect(world[i].position[k]).toBeCloseTo(v, 12));
    });
  });
});

describe('the box in the room', () => {
  const world = createPackedWorldLayout();

  it('closes the lid on the walls, just over the parts, sized to cover the box', () => {
    expect(PART_TYPES.boxLid.size).toEqual([width + 2 * BOX.wall, BOX.lidThickness, length + 2 * BOX.wall]);
    const lid = lidRest();
    const top = Math.max(...world.map((p) => p.position[1] + extents(p)[1]));
    expect(lid.position[1] - BOX.lidThickness / 2).toBeCloseTo(BOX.floor + height, 9);
    expect(lid.position[1] - BOX.lidThickness / 2).toBeGreaterThanOrEqual(top - EPS);
    expect(lid.position[0]).toBeCloseTo(BOX.position[0], 9);
    expect(lid.position[2]).toBeCloseTo(BOX.position[2], 9);
  });

  it('stands inside the room, clear of the camera-target margin', () => {
    const { position, rotation } = boxPlacement();
    const margin = CAMERA_LIMITS.targetMargin;
    for (const corner of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const local = [corner[0] * (width / 2 + BOX.wall), 0, corner[1] * (length / 2 + BOX.wall)];
      const [x, , z] = rotateVector(rotation, local).map((v, i) => v + position[i]);
      expect(Math.abs(x)).toBeLessThanOrEqual(ROOM.width / 2 - margin);
      expect(Math.abs(z)).toBeLessThanOrEqual(ROOM.depth / 2 - margin);
    }
  });

  it('keeps the lid and the panels out of the manifest checks: the lid is no furniture', () => {
    expect(MANIFEST.some((p) => p.type === 'boxLid')).toBe(false);
  });
});

describe('respawnSpots (1.5 recovery; PR #12 review)', () => {
  const { position, rotation } = boxPlacement();
  const toLocal = (p) => rotateVector([-rotation[0], -rotation[1], -rotation[2], rotation[3]], p.map((v, i) => v - position[i]));
  // World axis-aligned box of a part at a spot (quarter turns only).
  const worldBox = (type, spot) => {
    const e = extents({ type, rotation: spot.rotation });
    return { min: spot.position.map((v, i) => v - e[i]), max: spot.position.map((v, i) => v + e[i]) };
  };
  const overlap3 = (a, b) => [0, 1, 2].every((i) => a.min[i] < b.max[i] - EPS && b.min[i] < a.max[i] - EPS);

  // The worst case: everything at once, the biggest panels included.
  const types = [...MANIFEST.map((p) => p.type), 'boxLid'];
  const spots = respawnSpots(types);

  it('sets every part down lying flat, its underside above the floor by the drop clearance', () => {
    expect(spots).toHaveLength(types.length);
    types.forEach((type, i) => {
      const box = worldBox(type, spots[i]);
      const [thin] = [...PART_TYPES[type].size].sort((a, b) => a - b);
      expect(box.max[1] - box.min[1], type).toBeCloseTo(thin, 9);
      expect(box.min[1], type).toBeGreaterThanOrEqual(RESET.respawn.height - EPS);
    });
  });

  it('keeps a side panel or the back clear of the floor: never stood on end into it', () => {
    for (const type of ['sidePanel', 'backPanel']) {
      const [spot] = respawnSpots([type]);
      expect(worldBox(type, spot).min[1]).toBeCloseTo(RESET.respawn.height, 9);
    }
  });

  it('keeps every part clear of the box walls and inside the room', () => {
    types.forEach((type, i) => {
      const box = worldBox(type, spots[i]);
      const corners = [box.min, box.max].flatMap((a) => [box.min, box.max].map((b) => [a[0], 0, b[2]]));
      for (const c of corners) expect(toLocal(c)[0], type).toBeGreaterThan(width / 2 + BOX.wall);
      expect(box.min[0]).toBeGreaterThan(-ROOM.width / 2);
      expect(box.max[0]).toBeLessThan(ROOM.width / 2);
      expect(box.min[2]).toBeGreaterThan(-ROOM.depth / 2);
      expect(box.max[2]).toBeLessThan(ROOM.depth / 2);
    });
  });

  it('never overlaps two parts set down in the same sweep', () => {
    const boxes = types.map((type, i) => worldBox(type, spots[i]));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap3(boxes[i], boxes[j]), `${types[i]} vs ${types[j]}`).toBe(false);
    }
  });
});
