import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { COLORS } from '../src/constants.js';
import { MANIFEST, MANIFEST_QUANTITIES, PART_TYPES } from '../src/game/catalog.js';

// The Design doc's manifest table, restated independently so a catalog edit can't
// silently change what ships in the box. Dowels and cam locks include the bag's spares.
const DESIGN_MANIFEST = {
  sidePanel: 2,
  topBottomPanel: 2,
  fixedShelf: 1,
  adjustableShelf: 2,
  plinth: 1,
  backPanel: 1,
  dowel: 16,
  camLockBolt: 8,
  camLock: 10,
  shelfPin: 8,
  backFitting: 8,
  allenWrench: 1,
  screwdriver: 1,
};

// Loose spares in the bag (1.4.1): extras beyond what the holes take.
const SPARES = { dowel: 2, camLock: 2 };
// Holes drilled but never filled (1.5): each side's plinth hole at its rear edge — the
// side is reversible, so both edges are drilled and the plinth takes the front pair.
const UNFILLED = { dowelHole: 2 };

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

  it('expands to one instance per physical part, 61 in all', () => {
    expect(MANIFEST).toHaveLength(61);
    for (const [type, quantity] of Object.entries(DESIGN_MANIFEST)) {
      expect(MANIFEST.filter((p) => p.type === type)).toHaveLength(quantity);
    }
  });

  it('ships two spare dowels and two spare cam locks, but no spare bolts', () => {
    expect((countHoles(CONNECTOR.DOWEL_HOLE) - UNFILLED.dowelHole) / 2 + SPARES.dowel).toBe(MANIFEST_QUANTITIES.dowel);
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
    expect(countHoles(CONNECTOR.DOWEL_HOLE) - UNFILLED.dowelHole).toBe(2 * (DESIGN_MANIFEST.dowel - SPARES.dowel));
    expect(countHoles(CONNECTOR.CAM_BOLT_HOLE)).toBe(DESIGN_MANIFEST.camLockBolt);
    expect(countHoles(CONNECTOR.CAM_LOCK_RECESS)).toBe(DESIGN_MANIFEST.camLock - SPARES.camLock);
    expect(countHoles(CONNECTOR.SHELF_PIN_HOLE)).toBe(DESIGN_MANIFEST.shelfPin);
    expect(countHoles(CONNECTOR.BACK_FITTING_HOLE)).toBe(DESIGN_MANIFEST.backFitting);
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

  // The back panel sits flush with the carcass top. A fitting on its vertical centre line
  // misses the full-height sides, so it must land in a horizontal panel's thickness.
  it('lands every centre-line back fitting in a horizontal panel', () => {
    const { sidePanel, backPanel } = PART_TYPES;
    const thickness = PART_TYPES.topBottomPanel.size[1];
    const backCentreY = sidePanel.size[1] / 2 - backPanel.size[1] / 2;
    const panelCentres = [
      ...new Set(
        sidePanel.connectors.filter((c) => c.type === CONNECTOR.DOWEL_HOLE).map((c) => c.position[1]),
      ),
    ];
    const centreFittings = backPanel.connectors.filter(
      (c) => c.type === CONNECTOR.BACK_FITTING_HOLE && c.position[0] === 0,
    );
    expect(centreFittings.length).toBeGreaterThan(0);
    for (const fitting of centreFittings) {
      const y = fitting.position[1] + backCentreY;
      expect(panelCentres.some((centre) => Math.abs(y - centre) <= thickness / 2)).toBe(true);
    }
  });
});

describe('real-manual truth pass (1.5)', () => {
  it('ships no nails: no nail part, no nail connector types', () => {
    expect(PART_TYPES).not.toHaveProperty('nail');
    expect(MANIFEST_QUANTITIES).not.toHaveProperty('nail');
    for (const type of Object.values(CONNECTOR)) expect(type).not.toMatch(/nail/i);
  });

  it('fixes the back with push-pin fittings: a tip that goes in a back-panel hole', () => {
    expect(PART_TYPES.backFitting.connectors.map((c) => c.type)).toEqual([CONNECTOR.BACK_FITTING_TIP]);
    const holes = PART_TYPES.backPanel.connectors;
    expect(holes.every((c) => c.type === CONNECTOR.BACK_FITTING_HOLE)).toBe(true);
    // Every hole opens on the back face, facing away from the carcass.
    for (const hole of holes) {
      expect(hole.axis).toEqual([0, 0, -1]);
      expect(hole.position[2]).toBeCloseTo(-PART_TYPES.backPanel.size[2] / 2, 9);
    }
  });

  it('puts a back fitting at the edge of the panel over a side panel\'s back edge', () => {
    const { sidePanel, backPanel, topBottomPanel } = PART_TYPES;
    const sideCentreX = topBottomPanel.size[0] / 2 + sidePanel.size[0] / 2;
    const edgeFittings = backPanel.connectors.filter((c) => c.position[0] !== 0);
    expect(edgeFittings.length).toBeGreaterThan(0);
    for (const fitting of edgeFittings) {
      expect(Math.abs(Math.abs(fitting.position[0]) - sideCentreX)).toBeLessThanOrEqual(sidePanel.size[0] / 2);
    }
  });

  it('adds a plinth strip with a dowel hole in each end, and matching holes low in each side', () => {
    const { plinth, sidePanel, topBottomPanel } = PART_TYPES;
    expect(MANIFEST_QUANTITIES.plinth).toBe(1);
    expect(plinth.size[0]).toBe(topBottomPanel.size[0]);
    const ends = plinth.connectors.filter((c) => c.type === CONNECTOR.DOWEL_HOLE);
    expect(ends.map((c) => c.position[0]).sort()).toEqual([-plinth.size[0] / 2, plinth.size[0] / 2]);
    // The side's plinth holes are its last two connectors, below the bottom panel's holes,
    // one at each edge so the side is reversible about its long axis.
    const pair = sidePanel.connectors.slice(-2);
    const bottomPanelY = Math.min(
      ...sidePanel.connectors.slice(0, -2).filter((c) => c.type === CONNECTOR.DOWEL_HOLE).map((c) => c.position[1]),
    );
    for (const hole of pair) {
      expect(hole.type).toBe(CONNECTOR.DOWEL_HOLE);
      expect(hole.position[1]).toBeLessThan(bottomPanelY - topBottomPanel.size[1] / 2);
      expect(hole.position[1] - plinth.size[1] / 2).toBeCloseTo(-sidePanel.size[1] / 2, 9);
    }
    expect(pair[0].position[2]).toBeCloseTo(-pair[1].position[2], 9);
  });

  it('gives every part type a stable, unique five-digit part number', () => {
    const numbers = Object.values(PART_TYPES).map((p) => p.partNumber);
    for (const n of numbers) expect(n).toMatch(/^\d{5}$/);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
