import { describe, expect, it } from 'vitest';
import { COLORS } from '../src/constants.js';
import { CONNECTOR, MANIFEST, MANIFEST_QUANTITIES, PART_TYPES } from '../src/game/catalog.js';

// The Design doc's manifest table, restated independently so a catalog edit can't
// silently change what ships in the box. Dowels and cam locks include the bag's spares.
const DESIGN_MANIFEST = {
  sidePanel: 2,
  topBottomPanel: 2,
  fixedShelf: 1,
  adjustableShelf: 2,
  backPanel: 1,
  dowel: 14,
  camLockBolt: 8,
  camLock: 10,
  shelfPin: 8,
  nail: 8,
  allenWrench: 1,
  screwdriver: 1,
};

// Loose spares in the bag (1.4.1): extras beyond what the holes take.
const SPARES = { dowel: 2, camLock: 2 };

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

  it('expands to one instance per physical part, 58 in all', () => {
    expect(MANIFEST).toHaveLength(58);
    for (const [type, quantity] of Object.entries(DESIGN_MANIFEST)) {
      expect(MANIFEST.filter((p) => p.type === type)).toHaveLength(quantity);
    }
  });

  it('ships two spare dowels and two spare cam locks, but no spare bolts', () => {
    expect(countHoles(CONNECTOR.DOWEL_HOLE) / 2 + SPARES.dowel).toBe(MANIFEST_QUANTITIES.dowel);
    expect(countHoles(CONNECTOR.CAM_LOCK_RECESS) + SPARES.camLock).toBe(MANIFEST_QUANTITIES.camLock);
    expect(MANIFEST_QUANTITIES.camLockBolt).toBe(countHoles(CONNECTOR.CAM_BOLT_HOLE));
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
  it('has enough holes for every fastener in the box, spares aside', () => {
    expect(countHoles(CONNECTOR.DOWEL_HOLE)).toBe(2 * (DESIGN_MANIFEST.dowel - SPARES.dowel));
    expect(countHoles(CONNECTOR.CAM_BOLT_HOLE)).toBe(DESIGN_MANIFEST.camLockBolt);
    expect(countHoles(CONNECTOR.CAM_LOCK_RECESS)).toBe(DESIGN_MANIFEST.camLock - SPARES.camLock);
    expect(countHoles(CONNECTOR.SHELF_PIN_HOLE)).toBe(DESIGN_MANIFEST.shelfPin);
    expect(countHoles(CONNECTOR.NAIL_HOLE)).toBe(DESIGN_MANIFEST.nail);
  });

  it('gives every cam lock a screwdriver slot opposite its body end', () => {
    const [body, slot] = PART_TYPES.camLock.connectors;
    expect(body.type).toBe(CONNECTOR.CAM_LOCK_BODY);
    expect(slot.type).toBe(CONNECTOR.CAM_SLOT);
    body.axis.forEach((v, i) => expect(slot.axis[i] + v).toBe(0));
  });

  it('ships a screwdriver whose only connector is its tip', () => {
    expect(PART_TYPES.screwdriver.connectors.map((c) => c.type)).toEqual([CONNECTOR.SCREWDRIVER_TIP]);
  });

  // The back panel sits flush with the carcass top. A nail on its vertical centre line
  // misses the full-height sides, so it must land in a horizontal panel's thickness.
  it('lands every centre-line back-panel nail in a horizontal panel', () => {
    const { sidePanel, backPanel } = PART_TYPES;
    const thickness = PART_TYPES.topBottomPanel.size[1];
    const backCentreY = sidePanel.size[1] / 2 - backPanel.size[1] / 2;
    const panelCentres = [
      ...new Set(
        sidePanel.connectors.filter((c) => c.type === CONNECTOR.DOWEL_HOLE).map((c) => c.position[1]),
      ),
    ];
    const centreNails = backPanel.connectors.filter(
      (c) => c.type === CONNECTOR.NAIL_HOLE && c.position[0] === 0,
    );
    expect(centreNails.length).toBeGreaterThan(0);
    for (const nail of centreNails) {
      const y = nail.position[1] + backCentreY;
      expect(panelCentres.some((centre) => Math.abs(y - centre) <= thickness / 2)).toBe(true);
    }
  });
});
