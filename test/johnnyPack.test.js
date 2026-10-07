import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { connectorInWorld, rotateVector } from '../tools/validate/lib/geometry.js';
import { CONNECTOR, CONTRACT, isFastenerEnd, KIND } from '../tools/validate/lib/vocabulary.js';
import { COLORS, ROOM } from '../src/constants.js';
import { ASSEMBLED, IDENTITY, MANIFEST, PACKING, PART_TYPES, SPARES } from '../src/game/item.js';

// JOHNNY's own facts, on the shipped pack. The generic integrity rules (bounds, every part
// placed once, mated pairs coincident, captures, step coverage, counts, packing fit) are the
// validator's and run here too; what follows is what only this item promises.

const JSON_PACK = JSON.parse(readFileSync(new URL('../items/johnny/flatpack.json', import.meta.url), 'utf8'));
const layout = ASSEMBLED;
const poseOf = new Map(layout.parts.map((p) => [p.id, p]));
const world = (id, index) => connectorInWorld(PART_TYPES[poseOf.get(id).type].connectors[index], poseOf.get(id));
const MM = 1e-6;
const expectVec = (actual, expected, tolerance = MM) => {
  const gap = Math.hypot(...actual.map((v, i) => v - expected[i]));
  expect(gap).toBeLessThanOrEqual(tolerance);
};
const role = (r) => layout.parts.filter((p) => p.role === r);
const panels = layout.parts.filter((p) => p.role !== 'hardware');
const quantities = Object.fromEntries([...new Set(MANIFEST.map((p) => p.type))].map((type) => [type, MANIFEST.filter((p) => p.type === type).length]));

// The Design doc's manifest table, restated independently so a pack edit can't silently
// change what ships in the box. Dowels and cam locks include the bag's spares.
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
const SPARE_COUNTS = { dowel: 2, camLock: 2 };
// Holes drilled but never filled (1.5): each side's plinth hole at its rear edge — the
// side is reversible, so both edges are drilled and the plinth takes the front pair.
const UNFILLED = { dowelHole: 2 };
const countHoles = (type) => MANIFEST.reduce((sum, p) => sum + PART_TYPES[p.type].connectors.filter((c) => c.type === type).length, 0);

describe('the shipped pack passes the validator', () => {
  it('has no semantic errors', () => {
    expect(checkPack(JSON_PACK)).toEqual([]);
  });
});

describe('manifest', () => {
  it('matches the Design manifest quantities exactly, 61 instances in all', () => {
    expect(quantities).toEqual(DESIGN_MANIFEST);
    expect(MANIFEST).toHaveLength(61);
  });

  it('sets two dowels and two cam locks aside as spares, numbered last — no spare bolts', () => {
    expect([...SPARES]).toEqual(['dowel-15', 'dowel-16', 'camLock-9', 'camLock-10']);
    expect(JSON_PACK.parts.dowel).toMatchObject({ quantity: 14, spares: 2 });
    expect(JSON_PACK.parts.camLock).toMatchObject({ quantity: 8, spares: 2 });
    expect(JSON_PACK.parts.camLockBolt.spares).toBeUndefined();
    expect((countHoles(CONNECTOR.DOWEL_HOLE) - UNFILLED.dowelHole) / 2 + SPARE_COUNTS.dowel).toBe(quantities.dowel);
    expect(countHoles(CONNECTOR.CAM_LOCK_RECESS) + SPARE_COUNTS.camLock).toBe(quantities.camLock);
    expect(quantities.camLockBolt).toBe(countHoles(CONNECTOR.CAM_BOLT_HOLE));
  });

  it('never puts the lid in the manifest: it is no furniture', () => {
    expect(MANIFEST.some((p) => p.type === 'boxLid')).toBe(false);
  });

  it('names the product JOHNNY by SKRUV', () => {
    expect(IDENTITY).toMatchObject({ product: 'JOHNNY', maker: 'SKRUV', documentCode: 'SK-0000451-1' });
  });
});

describe('part types', () => {
  it.each(Object.entries(PART_TYPES))('%s uses a colour defined in constants', (_, part) => {
    expect(COLORS).toHaveProperty(part.color);
  });

  it('gives every part type a stable, unique five-digit part number', () => {
    const numbers = Object.values(PART_TYPES).map((p) => p.partNumber);
    for (const n of numbers) expect(n).toMatch(/^\d{5}$/);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(PART_TYPES.dowel.partNumber).toBe('10106');
    expect(PART_TYPES.camLock.partNumber).toBe('11701');
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

  it('has enough holes for every fastener in the box, spares aside', () => {
    expect(countHoles(CONNECTOR.DOWEL_HOLE) - UNFILLED.dowelHole).toBe(2 * (DESIGN_MANIFEST.dowel - SPARE_COUNTS.dowel));
    expect(countHoles(CONNECTOR.CAM_BOLT_HOLE)).toBe(DESIGN_MANIFEST.camLockBolt);
    expect(countHoles(CONNECTOR.CAM_LOCK_RECESS)).toBe(DESIGN_MANIFEST.camLock - SPARE_COUNTS.camLock);
    expect(countHoles(CONNECTOR.SHELF_PIN_HOLE)).toBe(DESIGN_MANIFEST.shelfPin);
    expect(countHoles(CONNECTOR.BACK_FITTING_HOLE)).toBe(DESIGN_MANIFEST.backFitting);
  });
});

describe('real-manual truth pass (1.5)', () => {
  it('ships no nails: no nail part, no nail connector types', () => {
    expect(PART_TYPES).not.toHaveProperty('nail');
    for (const type of Object.values(CONNECTOR)) expect(type).not.toMatch(/nail/i);
  });

  it('fixes the back with push-pin fittings: a tip that goes in a back-panel hole', () => {
    expect(PART_TYPES.backFitting.connectors.map((c) => c.type)).toEqual([CONNECTOR.BACK_FITTING_TIP]);
    const holes = PART_TYPES.backPanel.connectors;
    expect(holes.every((c) => c.type === CONNECTOR.BACK_FITTING_HOLE)).toBe(true);
    for (const hole of holes) {
      expect(hole.axis).toEqual([0, 0, -1]);
      expect(hole.position[2]).toBeCloseTo(-PART_TYPES.backPanel.size[2] / 2, 9);
    }
  });

  it('adds a plinth strip with a dowel hole in each end, and matching holes low in each side', () => {
    const { plinth, sidePanel, topBottomPanel } = PART_TYPES;
    expect(quantities.plinth).toBe(1);
    expect(plinth.size[0]).toBe(topBottomPanel.size[0]);
    const ends = plinth.connectors.filter((c) => c.type === CONNECTOR.DOWEL_HOLE);
    expect(ends.map((c) => c.position[0]).sort()).toEqual([-plinth.size[0] / 2, plinth.size[0] / 2]);
    // The side's plinth holes are its last two connectors, so every earlier index stays put.
    const pair = sidePanel.connectors.slice(-2);
    const bottomPanelY = Math.min(...sidePanel.connectors.slice(0, -2).filter((c) => c.type === CONNECTOR.DOWEL_HOLE).map((c) => c.position[1]));
    for (const hole of pair) {
      expect(hole.type).toBe(CONNECTOR.DOWEL_HOLE);
      expect(hole.position[1]).toBeLessThan(bottomPanelY - topBottomPanel.size[1] / 2);
      expect(hole.position[1] - plinth.size[1] / 2).toBeCloseTo(-sidePanel.size[1] / 2, 9);
    }
    expect(pair[0].position[2]).toBeCloseTo(-pair[1].position[2], 9);
  });

  // The back panel sits flush with the carcass top. A fitting on its vertical centre line
  // misses the full-height sides, so it must land in a horizontal panel.
  it('lands every centre-line back fitting in a horizontal panel', () => {
    const centre = layout.joints.filter((j) => j.kind === KIND.FITTING && PART_TYPES.backPanel.connectors[j.hostConnector].position[0] === 0);
    expect(centre.length).toBeGreaterThan(0);
    for (const f of centre) expect(['bottom', 'fixed', 'top']).toContain(poseOf.get(f.through).role);
  });
});

describe('the built JOHNNY', () => {
  it('derives 60 joints: 28 dowel, 8 bolt, 8 cam, 8 pin, 8 fitting', () => {
    const count = (kind) => layout.joints.filter((j) => j.kind === kind).length;
    expect(layout.joints).toHaveLength(60);
    expect([count(KIND.DOWEL), count(KIND.BOLT), count(KIND.CAM), count(KIND.PIN), count(KIND.FITTING)]).toEqual([28, 8, 8, 8, 8]);
  });

  it('names one panel per role, two shelves', () => {
    for (const r of ['leftSide', 'rightSide', 'plinth', 'bottom', 'fixed', 'top', 'back']) expect(role(r)).toHaveLength(1);
    expect(role('shelf')).toHaveLength(2);
  });

  it('gives every part a unit rotation', () => {
    for (const { rotation } of layout.parts) expect(Math.hypot(...rotation)).toBeCloseTo(1, 9);
  });

  // Through a dowel, the two holes it joins meet face to face: the panels close up flush.
  it('brings the two holes each dowel joins face to face', () => {
    const dowels = new Map();
    for (const j of layout.joints.filter((j) => j.kind === KIND.DOWEL)) {
      if (!dowels.has(j.hardware)) dowels.set(j.hardware, []);
      dowels.get(j.hardware).push(world(j.host, j.hostConnector));
    }
    expect(dowels.size).toBe(DESIGN_MANIFEST.dowel - SPARE_COUNTS.dowel);
    for (const [, holes] of dowels) {
      expect(holes).toHaveLength(2);
      expectVec(holes[0].position, holes[1].position);
      expectVec(holes[0].axis, holes[1].axis.map((v) => -v));
    }
  });

  it('joins every side to every horizontal part through two dowels or more', () => {
    const dowelsIn = (id) => new Set(layout.joints.filter((j) => j.kind === KIND.DOWEL && j.host === id).map((j) => j.hardware));
    const between = (a, b) => [...dowelsIn(a)].filter((d) => dowelsIn(b).has(d)).length;
    for (const side of [...role('leftSide'), ...role('rightSide')]) {
      for (const r of ['bottom', 'fixed', 'top']) expect(between(role(r)[0].id, side.id)).toBeGreaterThanOrEqual(2);
      expect(between(role('plinth')[0].id, side.id)).toBe(1);
    }
  });

  it('seats every bolt in a side, and catches one bolt per cam within reach', () => {
    const bolts = layout.joints.filter((j) => j.kind === KIND.BOLT);
    for (const b of bolts) expect(['leftSide', 'rightSide']).toContain(poseOf.get(b.host).role);
    const headIndex = PART_TYPES.camLockBolt.connectors.findIndex((c) => c.type === CONNECTOR.BOLT_HEAD);
    const cams = layout.joints.filter((j) => j.kind === KIND.CAM);
    expect(cams).toHaveLength(DESIGN_MANIFEST.camLock - SPARE_COUNTS.camLock);
    for (const cam of cams) {
      const head = world(cam.captured, headIndex).position;
      expect(Math.hypot(...head.map((v, i) => v - world(cam.host, cam.hostConnector).position[i]))).toBeLessThanOrEqual(CONTRACT.captureRadius);
    }
    expect(new Set(cams.map((c) => c.captured)).size).toBe(cams.length);
  });

  // The cam ties its panel to the side that panel's end is doweled to — not across.
  it('catches each cam\'s bolt in the side its own panel end is doweled to', () => {
    const boltHost = new Map(layout.joints.filter((j) => j.kind === KIND.BOLT).map((j) => [j.hardware, j.host]));
    for (const cam of layout.joints.filter((j) => j.kind === KIND.CAM)) {
      const side = poseOf.get(boltHost.get(cam.captured));
      expect(Math.sign(world(cam.host, cam.hostConnector).position[0])).toBe(Math.sign(side.position[0]));
    }
  });

  it('presses every back fitting through the back into a side or horizontal panel', () => {
    for (const f of layout.joints.filter((j) => j.kind === KIND.FITTING)) {
      expect(poseOf.get(f.host).role).toBe('back');
      expect(['leftSide', 'rightSide', 'bottom', 'top']).toContain(poseOf.get(f.through).role);
    }
  });

  it('moves a dowel into its first panel, and the second panel onto the dowel', () => {
    for (const j of layout.joints.filter((j) => j.kind === KIND.DOWEL)) {
      expect(j.mover).toBe(j.hardwareConnector === 0 ? j.hardware : j.host);
    }
  });
});

describe('the carcass as a whole', () => {
  // World axis-aligned boxes — every panel is turned by quarter turns only.
  const boxOf = (p) => {
    const half = PART_TYPES[p.type].size.map((d) => d / 2);
    const extents = [0, 1, 2].map((axis) =>
      [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(p.rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)))[axis]), 0),
    );
    return { min: p.position.map((v, i) => v - extents[i]), max: p.position.map((v, i) => v + extents[i]) };
  };
  const overlap = (a, b) => [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]));

  it('stands on the floor: nothing below it, the sides on it', () => {
    for (const p of layout.parts) expect(boxOf(p).min[1]).toBeGreaterThanOrEqual(-MM);
    for (const side of [...role('leftSide'), ...role('rightSide')]) expect(boxOf(side).min[1]).toBeCloseTo(0, 9);
    expect(boxOf(role('plinth')[0]).min[1]).toBeCloseTo(0, 9);
  });

  it('never has two panels passing through each other', () => {
    for (let i = 0; i < panels.length; i++) {
      for (let k = i + 1; k < panels.length; k++) {
        expect(Math.min(...overlap(boxOf(panels[i]), boxOf(panels[k]))), `${panels[i].id} vs ${panels[k].id}`).toBeLessThanOrEqual(MM);
      }
    }
  });

  it('rests each shelf on its pins: on top of them, and over them in width', () => {
    const pins = layout.parts.filter((p) => p.type === 'shelfPin').map(boxOf);
    for (const shelf of role('shelf').map(boxOf)) {
      const under = pins.filter((pin) => Math.abs(pin.max[1] - shelf.min[1]) <= MM);
      expect(under).toHaveLength(4);
      for (const pin of under) {
        const o = overlap(shelf, { ...pin, max: [pin.max[0], shelf.min[1] + 1, pin.max[2]] });
        expect(o[0]).toBeGreaterThan(0);
        expect(o[2]).toBeGreaterThan(0);
      }
    }
  });

  it('turns the bottom panel\'s cam recesses up into the carcass', () => {
    const bottom = role('bottom')[0];
    const recesses = PART_TYPES[bottom.type].connectors.flatMap((c, i) => (c.type === CONNECTOR.CAM_LOCK_RECESS ? [i] : []));
    for (const i of recesses) expect(world(bottom.id, i).axis[1]).toBeCloseTo(1, 9);
  });

  it('fits the room standing', () => {
    expect(Math.max(...layout.parts.map((p) => boxOf(p).max[1]))).toBeLessThan(ROOM.height);
  });
});

describe('the packed box', () => {
  const typeOf = new Map(MANIFEST.map((p) => [p.id, p.type]));
  const placed = PACKING.placements.map((p) => ({ ...p, type: typeOf.get(p.id) }));
  const extents = (p) => {
    const half = PART_TYPES[p.type].size.map((d) => d / 2);
    return [0, 1, 2].map((axis) => [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(p.rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)))[axis]), 0));
  };
  const isHardware = (type) => PART_TYPES[type].connectors.some((c) => isFastenerEnd(c.type));
  const bottomOf = (p) => p.position[1] - extents(p)[1];

  it('packs every instance, spares included, in manifest order', () => {
    expect(placed.map((p) => p.id)).toEqual(MANIFEST.map((p) => p.id));
  });

  it('puts the big panels on the box floor and the hardboard back over them', () => {
    expect(placed.filter((p) => Math.abs(bottomOf(p) - PACKING.floor) < 1e-9).map((p) => p.type)).toEqual(['sidePanel', 'sidePanel']);
    const sideTop = Math.max(...placed.filter((p) => p.type === 'sidePanel').map((p) => p.position[1] + extents(p)[1]));
    expect(bottomOf(placed.find((p) => p.type === 'backPanel'))).toBeCloseTo(sideTop, 9);
  });

  it('lays each part on its largest face, the sides with their holes up', () => {
    for (const p of placed) {
      const [thin] = [...PART_TYPES[p.type].size].sort((a, b) => a - b);
      expect(extents(p)[1] * 2).toBeCloseTo(thin, 9);
    }
    const side = placed.find((p) => p.id === 'sidePanel-1');
    const hole = PART_TYPES.sidePanel.connectors.find((c) => c.type === CONNECTOR.DOWEL_HOLE);
    expect(rotateVector(side.rotation, hole.axis)[1]).toBeCloseTo(1, 9);
  });

  it('lays every piece of hardware on top, a fingertip apart', () => {
    const panelTop = Math.max(...placed.filter((p) => !isHardware(p.type)).map((p) => p.position[1] + extents(p)[1]));
    const hardware = placed.filter((p) => isHardware(p.type));
    for (const p of hardware) expect(bottomOf(p)).toBeCloseTo(panelTop, 9);
    const boxes = hardware.map((p) => {
      const e = extents(p);
      return { min: p.position.map((v, i) => v - e[i]), max: p.position.map((v, i) => v + e[i]) };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const gap = Math.max(boxes[j].min[0] - boxes[i].max[0], boxes[i].min[0] - boxes[j].max[0], boxes[j].min[2] - boxes[i].max[2], boxes[i].min[2] - boxes[j].max[2]);
        expect(gap).toBeGreaterThanOrEqual(0.04 - 1e-9);
      }
    }
  });
});
