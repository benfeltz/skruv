import { describe, expect, it } from 'vitest';
import { COLORS } from '../src/constants.js';
import { CONNECTOR, MANIFEST, MANIFEST_QUANTITIES, PART_TYPES } from '../src/game/catalog.js';

// The Design doc's manifest table, restated independently so a catalog edit can't
// silently change what ships in the box.
const DESIGN_MANIFEST = {
  sidePanel: 2,
  topBottomPanel: 2,
  fixedShelf: 1,
  adjustableShelf: 2,
  backPanel: 1,
  dowel: 12,
  camLockBolt: 8,
  camLock: 8,
  shelfPin: 8,
  nail: 8,
  allenWrench: 1,
};

const EPSILON = 1e-9;
const types = Object.entries(PART_TYPES);
const connectors = types.flatMap(([name, part]) => part.connectors.map((c) => [name, part, c]));

const countHoles = (type) =>
  MANIFEST.reduce(
    (sum, { type: part }) => sum + PART_TYPES[part].connectors.filter((c) => c.type === type).length,
    0,
  );

describe('manifest', () => {
  it('matches the Design manifest quantities exactly', () => {
    expect(MANIFEST_QUANTITIES).toEqual(DESIGN_MANIFEST);
  });

  it('expands to one instance per physical part, 53 in all', () => {
    expect(MANIFEST).toHaveLength(53);
    for (const [type, quantity] of Object.entries(DESIGN_MANIFEST)) {
      expect(MANIFEST.filter((p) => p.type === type)).toHaveLength(quantity);
    }
  });

  it('gives every instance a unique id', () => {
    expect(new Set(MANIFEST.map((p) => p.id)).size).toBe(MANIFEST.length);
  });

  it('only references defined part types', () => {
    for (const { type } of MANIFEST) expect(PART_TYPES).toHaveProperty(type);
  });
});

describe('part types', () => {
  it.each(types)('%s has positive size and mass', (_, part) => {
    expect(part.size).toHaveLength(3);
    for (const d of part.size) expect(d).toBeGreaterThan(0);
    expect(part.mass).toBeGreaterThan(0);
  });

  it.each(types)('%s uses a colour defined in constants', (_, part) => {
    expect(COLORS).toHaveProperty(part.color);
  });
});

describe('connectors', () => {
  const knownTypes = new Set(Object.values(CONNECTOR));

  it.each(connectors)('%s connector uses a known type', (_, __, c) => {
    expect(knownTypes.has(c.type)).toBe(true);
  });

  it.each(connectors)('%s connector lies within the part bounds', (_, part, c) => {
    c.position.forEach((value, i) => {
      expect(Math.abs(value)).toBeLessThanOrEqual(part.size[i] / 2 + EPSILON);
    });
  });

  it.each(connectors)('%s connector axis is unit length', (_, __, c) => {
    expect(Math.hypot(...c.axis)).toBeCloseTo(1, 9);
  });

  // Hole counts only — which hole takes which fastener is PR 4's mating table.
  it('has enough holes for every fastener in the box', () => {
    expect(countHoles(CONNECTOR.DOWEL_HOLE)).toBe(2 * DESIGN_MANIFEST.dowel);
    expect(countHoles(CONNECTOR.CAM_BOLT_HOLE)).toBe(DESIGN_MANIFEST.camLockBolt);
    expect(countHoles(CONNECTOR.CAM_LOCK_RECESS)).toBe(DESIGN_MANIFEST.camLock);
    expect(countHoles(CONNECTOR.SHELF_PIN_HOLE)).toBe(DESIGN_MANIFEST.shelfPin);
    expect(countHoles(CONNECTOR.NAIL_HOLE)).toBe(DESIGN_MANIFEST.nail);
  });
});
