import { describe, expect, it } from 'vitest';
import { multiplyQuaternions, placeLayout, rotateVector } from '../tools/validate/lib/geometry.js';
import { CAMERA_LIMITS, RESET, ROOM } from '../src/constants.js';
import { rotatedHalfExtents } from '../src/game/dragMath.js';
import {
  baseRest,
  boxPlacement,
  boxPoseOf,
  createPackedWorldLayout,
  lidRest,
  PACKED_BOX as BOX,
  respawnSpots,
} from '../src/game/boxLayout.js';
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

describe('the layout follows the box wherever it is dragged (1.7.1)', () => {
  const yawed = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const inverse = ([x, y, z, w]) => [-x, -y, -z, w];
  const toBoxLocal = (pose, p) => rotateVector(inverse(pose.rotation), p.map((v, i) => v - pose.position[i]));
  const typeOf = new Map(MANIFEST.map(({ id, type }) => [id, type]));
  const types = [...MANIFEST.map((p) => p.type), 'boxLid'];
  const moved = { position: [-2.5, 0, -1.2], rotation: yawed(0.7) };

  it('defaults to the box where it stands at boot: today\'s layout, exactly', () => {
    const boot = { position: [0, 0, 0.6], rotation: yawed(Math.PI / 2) };
    const local = PACKING.placements.map(({ id, position, rotation }) => ({ id, type: typeOf.get(id), position, rotation }));
    expect(createPackedWorldLayout()).toEqual(placeLayout(local, boot));
    const lidTop = BOX.floor + height + BOX.lidThickness / 2;
    expect(lidRest()).toEqual(placeLayout([{ position: [0, lidTop, 0], rotation: [0, 0, 0, 1] }], boot).map(({ position, rotation }) => ({ position, rotation }))[0]);
  });

  it('reads the box pose back off its base body, so a box at its boot spot repacks byte-identically', () => {
    const live = boxPoseOf(baseRest());
    expect(live).toEqual(boxPlacement());
    expect(createPackedWorldLayout(live)).toEqual(createPackedWorldLayout());
    expect(lidRest(live)).toEqual(lidRest());
    expect(respawnSpots(types, live)).toEqual(respawnSpots(types));
  });

  it('inverts baseRest for a moved, yawed box', () => {
    const back = boxPoseOf(baseRest(moved));
    back.position.forEach((v, i) => expect(v).toBeCloseTo(moved.position[i], 12));
    expect(back.rotation).toEqual(moved.rotation);
  });

  it('packs every part into a moved, yawed box at the same box-local pose', () => {
    const world = createPackedWorldLayout(moved);
    expect(world.map(({ id, type }) => ({ id, type }))).toEqual(MANIFEST);
    PACKING.placements.forEach((local, i) => {
      toBoxLocal(moved, world[i].position).forEach((v, k) => expect(v).toBeCloseTo(local.position[k], 9));
      multiplyQuaternions(moved.rotation, local.rotation).forEach((v, k) => expect(world[i].rotation[k]).toBeCloseTo(v, 12));
    });
    const lid = lidRest(moved);
    toBoxLocal(moved, lid.position).forEach((v, k) => expect(v).toBeCloseTo([0, BOX.floor + height + BOX.lidThickness / 2, 0][k], 9));
    expect(lid.rotation).toEqual(moved.rotation);
  });

  it('sets recovered parts down beside a moved, yawed box, on its +x long side', () => {
    const spots = respawnSpots(types, moved);
    spots.forEach((spot, i) => {
      const [hx] = rotatedHalfExtents(PART_TYPES[types[i]].size.map((d) => d / 2), multiplyQuaternions(inverse(moved.rotation), spot.rotation));
      expect(toBoxLocal(moved, spot.position)[0] - hx, types[i]).toBeGreaterThan(width / 2 + BOX.wall - EPS);
    });
  });

  it('moves the patch to the other long side when the box is dragged against a wall', () => {
    const atWall = { position: [ROOM.width / 2 - 0.6, 0, 0], rotation: [0, 0, 0, 1] };
    const spots = respawnSpots(types, atWall);
    spots.forEach((spot, i) => {
      const [hx, , hz] = rotatedHalfExtents(PART_TYPES[types[i]].size.map((d) => d / 2), spot.rotation);
      // In the patch on the box's −x side — beside the moved box, not back at the boot spot.
      const [x] = toBoxLocal(atWall, spot.position);
      expect(x + hx, types[i]).toBeLessThan(-(width / 2 + BOX.wall) + EPS);
      expect(x - hx, types[i]).toBeGreaterThan(-(width / 2 + BOX.wall + RESET.respawn.offset + RESET.respawn.depth) - EPS);
      expect(Math.abs(spot.position[0]) + hx).toBeLessThan(ROOM.width / 2);
      expect(Math.abs(spot.position[2]) + hz).toBeLessThan(ROOM.depth / 2);
    });
  });

  // PR #23 review: a box left tilted (propped on a panel) or half through a wall.
  it('lays out against a tilted box level on the floor, turned by its yaw alone', () => {
    const tilt = [Math.sin(0.1), 0, 0, Math.cos(0.1)]; // ~11° about box-local x
    const body = baseRest(moved);
    const tilted = { position: body.position.map((v, i) => v + [0, 0.05, 0][i]), rotation: multiplyQuaternions(moved.rotation, tilt) };
    const pose = boxPoseOf(tilted);
    expect(pose.position[1]).toBe(0);
    pose.rotation.forEach((v, i) => expect(v).toBeCloseTo(moved.rotation[i], 12));
    for (const [i, spot] of respawnSpots(types, pose).entries()) {
      const [, hy] = rotatedHalfExtents(PART_TYPES[types[i]].size.map((d) => d / 2), spot.rotation);
      expect(spot.position[1] - hy, types[i]).toBeGreaterThanOrEqual(RESET.respawn.height - EPS);
    }
  });

  it('holds the layout frame inside the walls for a box half through one', () => {
    const through = { position: [ROOM.width / 2 + 0.2, 0, 0], rotation: [0, 0, 0, 1] };
    const { position: [x] } = boxPoseOf(baseRest(through));
    expect(x + width / 2 + BOX.wall).toBeLessThanOrEqual(ROOM.width / 2);
  });

  it('falls back to the boot patch when the box is wedged in a corner and neither side fits', () => {
    const inCorner = { position: [ROOM.width / 2 - 0.6, 0, ROOM.depth / 2 - length / 2 - BOX.wall - 0.01], rotation: [0, 0, 0, 1] };
    expect(respawnSpots(types, inCorner)).toEqual(respawnSpots(types));
  });
});
