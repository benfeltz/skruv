import { describe, expect, it } from 'vitest';
import { CAMERA_LIMITS, DEV_LAYOUT, ROOM } from '../src/constants.js';
import { MANIFEST, PART_TYPES } from '../src/game/catalog.js';
import { createDevLayout } from '../src/game/devLayout.js';

const layout = createDevLayout();

const bounds = ({ position: [x, , z], footprint: [w, d] }) => ({
  minX: x - w / 2,
  maxX: x + w / 2,
  minZ: z - d / 2,
  maxZ: z + d / 2,
});

describe('createDevLayout', () => {
  it('places every manifest instance exactly once', () => {
    expect(layout.map((p) => p.id)).toEqual(MANIFEST.map((p) => p.id));
  });

  it('keeps every part inside the room, clear of the walls', () => {
    const margin = CAMERA_LIMITS.wallMargin;
    for (const part of layout) {
      const b = bounds(part);
      expect(b.minX).toBeGreaterThanOrEqual(-ROOM.width / 2 + margin);
      expect(b.maxX).toBeLessThanOrEqual(ROOM.width / 2 - margin);
      expect(b.minZ).toBeGreaterThanOrEqual(-ROOM.depth / 2 + margin);
      expect(b.maxZ).toBeLessThanOrEqual(ROOM.depth / 2 - margin);
    }
  });

  it('starts every part just above the floor', () => {
    for (const { position, type } of layout) {
      const thinnest = Math.min(...PART_TYPES[type].size);
      expect(position[1]).toBeCloseTo(thinnest / 2 + DEV_LAYOUT.dropHeight, 9);
    }
  });

  it('lays each part on its largest face', () => {
    for (const { footprint, type } of layout) {
      const [a, b, c] = [...PART_TYPES[type].size].sort((p, q) => p - q);
      expect([...footprint].sort((p, q) => p - q)).toEqual([b, c]);
      expect(a).toBeLessThanOrEqual(Math.min(...footprint));
    }
  });

  it('gives each part a unit quaternion', () => {
    for (const { rotation } of layout) expect(Math.hypot(...rotation)).toBeCloseTo(1, 9);
  });

  it('never overlaps two footprints', () => {
    const boxes = layout.map(bounds);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
        expect(overlap, `${layout[i].id} overlaps ${layout[j].id}`).toBe(false);
      }
    }
  });
});
