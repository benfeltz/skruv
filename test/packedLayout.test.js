import { describe, expect, it } from 'vitest';
import { BOX, CAMERA_LIMITS, RESET, ROOM } from '../src/constants.js';
import { CONNECTOR, MANIFEST, PART_TYPES } from '../src/game/catalog.js';
import { boxPlacement, createPackedLayout, createPackedWorldLayout, lidRest, respawnSpots } from '../src/game/packedLayout.js';
import { hasEscaped } from '../src/game/dragMath.js';
import { COMPATIBLE, rotateVector } from '../src/game/snapMath.js';

const layout = createPackedLayout();
const [width, height, length] = BOX.inner;
const EPS = 1e-9;

// Box-local extents of a part as packed: footprint across x/z, its own height up y.
const extents = (p) => {
  const half = PART_TYPES[p.type].size.map((d) => d / 2);
  return [0, 1, 2].map((axis) =>
    [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(p.rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)))[axis]), 0),
  );
};
const boxOf = (p) => {
  const e = extents(p);
  return { min: p.position.map((v, i) => v - e[i]), max: p.position.map((v, i) => v + e[i]) };
};
const overlaps = (a, b) => a.min[0] < b.max[0] - EPS && b.min[0] < a.max[0] - EPS && a.min[2] < b.max[2] - EPS && b.min[2] < a.max[2] - EPS;
const isHardware = (type) => PART_TYPES[type].connectors.some((c) => c.type in COMPATIBLE);
const layers = [...new Set(layout.map((p) => p.layer))].sort((a, b) => a - b);
const inLayer = (n) => layout.filter((p) => p.layer === n);

describe('createPackedLayout', () => {
  it('packs every manifest instance exactly once, in manifest order', () => {
    expect(layout.map((p) => p.id)).toEqual(MANIFEST.map((p) => p.id));
  });

  it('keeps every part inside the box\'s inner walls, floor and lid', () => {
    for (const p of layout) {
      const { min, max } = boxOf(p);
      expect(min[0], p.id).toBeGreaterThanOrEqual(-width / 2 - EPS);
      expect(max[0], p.id).toBeLessThanOrEqual(width / 2 + EPS);
      expect(min[2], p.id).toBeGreaterThanOrEqual(-length / 2 - EPS);
      expect(max[2], p.id).toBeLessThanOrEqual(length / 2 + EPS);
      expect(min[1], p.id).toBeGreaterThanOrEqual(BOX.floor - EPS);
      expect(max[1], p.id).toBeLessThanOrEqual(BOX.floor + height + EPS);
    }
  });

  it('never overlaps two footprints within a layer', () => {
    for (const n of layers) {
      const parts = inLayer(n);
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          expect(overlaps(boxOf(parts[i]), boxOf(parts[j])), `${parts[i].id} overlaps ${parts[j].id}`).toBe(false);
        }
      }
    }
  });

  it('rests every part on the box floor or on the layer under it, balanced over it', () => {
    for (const p of layout) {
      const own = boxOf(p);
      if (p.layer === 0) {
        expect(own.min[1]).toBeCloseTo(BOX.floor, 9);
        continue;
      }
      const below = inLayer(p.layer - 1).map(boxOf).filter((q) => overlaps(q, own));
      expect(below.length, `${p.id} has nothing under it`).toBeGreaterThan(0);
      for (const q of below) expect(q.max[1], p.id).toBeCloseTo(own.min[1], 9);
      // Its centre lies within the span of what holds it up, so it cannot tip off.
      for (const axis of [0, 2]) {
        expect(p.position[axis], p.id).toBeGreaterThanOrEqual(Math.min(...below.map((q) => q.min[axis])));
        expect(p.position[axis], p.id).toBeLessThanOrEqual(Math.max(...below.map((q) => q.max[axis])));
      }
    }
  });

  it('stacks heavier panels below lighter parts, and every piece of hardware on top', () => {
    for (const lower of layers) {
      for (const upper of layers.filter((n) => n > lower)) {
        const lightest = Math.min(...inLayer(lower).map((p) => PART_TYPES[p.type].mass));
        const heaviest = Math.max(...inLayer(upper).map((p) => PART_TYPES[p.type].mass));
        expect(heaviest, `layer ${upper} over ${lower}`).toBeLessThanOrEqual(lightest);
      }
    }
    const top = layers.at(-1);
    for (const p of layout) expect(p.layer === top, p.id).toBe(isHardware(p.type));
  });

  it('puts the big panels on the bottom and the hardboard back over them', () => {
    expect(inLayer(0).map((p) => p.type)).toEqual(['sidePanel', 'sidePanel']);
    expect(inLayer(1).map((p) => p.type)).toEqual(['backPanel']);
  });

  it('lays each part on its largest face, the sides with their holes up', () => {
    for (const p of layout) {
      const [thin] = [...PART_TYPES[p.type].size].sort((a, b) => a - b);
      expect(extents(p)[1] * 2).toBeCloseTo(thin, 9);
    }
    const side = layout.find((p) => p.id === 'sidePanel-1');
    const hole = PART_TYPES.sidePanel.connectors.find((c) => c.type === CONNECTOR.DOWEL_HOLE);
    expect(rotateVector(side.rotation, hole.axis)[1]).toBeCloseTo(1, 9);
  });

  it('spaces loose hardware a fingertip apart', () => {
    const hardware = layout.filter((p) => isHardware(p.type)).map(boxOf);
    for (let i = 0; i < hardware.length; i++) {
      for (let j = i + 1; j < hardware.length; j++) {
        const gap = Math.max(hardware[j].min[0] - hardware[i].max[0], hardware[i].min[0] - hardware[j].max[0], hardware[j].min[2] - hardware[i].max[2], hardware[i].min[2] - hardware[j].max[2]);
        expect(gap).toBeGreaterThanOrEqual(0.04 - EPS);
      }
    }
  });

  it('refuses a box too small for the manifest rather than spilling parts', () => {
    expect(() => createPackedLayout(MANIFEST, { ...BOX, inner: [0.5, height, length] })).toThrow();
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
