import { describe, expect, it } from 'vitest';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, contains, placeLayout, rotateVector } from '../tools/validate/lib/geometry.js';
import { FASTENER, ROOM } from '../src/constants.js';
import { capture } from '../src/game/assembly.js';
import { createAssembledLayout } from '../src/game/assembledLayout.js';
import { MANIFEST, MANIFEST_QUANTITIES, PART_TYPES } from '../src/game/catalog.js';

// Pose integrity: the geometry of a correctly built JOHNNY, checked pair by pair. This
// validates OUR catalog and layout — a wrong hole shows up here before any human sees it —
// never a player's build.

const layout = createAssembledLayout();
const poseOf = new Map(layout.parts.map((p) => [p.id, p]));
const world = (id, index) => connectorInWorld(PART_TYPES[poseOf.get(id).type].connectors[index], poseOf.get(id));
const MM = 1e-6;
const expectVec = (actual, expected, tolerance = MM) => {
  const gap = Math.hypot(...actual.map((v, i) => v - expected[i]));
  expect(gap).toBeLessThanOrEqual(tolerance);
};
const panels = layout.parts.filter((p) => p.role !== 'hardware');
const role = (r) => layout.parts.filter((p) => p.role === r);

// Spares and tools stay in the box; everything else goes into the shelf.
const SPARES = { dowel: 2, camLock: 2 };
const TOOLS = ['allenWrench', 'screwdriver'];

describe('every part placed exactly once', () => {
  it('places every manifest instance but the spares and tools, once each', () => {
    const ids = layout.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [type, quantity] of Object.entries(MANIFEST_QUANTITIES)) {
      const expected = TOOLS.includes(type) ? 0 : quantity - (SPARES[type] ?? 0);
      expect(layout.parts.filter((p) => p.type === type)).toHaveLength(expected);
    }
    for (const { id, type } of layout.parts) expect(MANIFEST).toContainEqual({ id, type });
  });

  it('names one panel per role, two shelves', () => {
    for (const r of ['leftSide', 'rightSide', 'plinth', 'bottom', 'fixed', 'top', 'back']) expect(role(r)).toHaveLength(1);
    expect(role('shelf')).toHaveLength(2);
  });

  it('gives every part a unit rotation', () => {
    for (const { rotation } of layout.parts) expect(Math.hypot(...rotation)).toBeCloseTo(1, 9);
  });
});

describe('pose integrity: mated connectors coincide', () => {
  it.each(layout.joints.map((j) => [`${j.hardware}#${j.hardwareConnector} in ${j.host}#${j.hostConnector}`, j]))(
    '%s sits its sink deep, axis reversed against the hole',
    (_, joint) => {
      const end = world(joint.hardware, joint.hardwareConnector);
      const hole = world(joint.host, joint.hostConnector);
      const sink = FASTENER.sinkDepth[joint.kind];
      expect(sink).toBeGreaterThan(0);
      expectVec(end.position, hole.position.map((v, i) => v - hole.axis[i] * sink));
      expectVec(end.axis, hole.axis.map((v) => -v));
    },
  );

  it('fills every hole at most once', () => {
    const keys = layout.joints.flatMap((j) => [`${j.hardware}#${j.hardwareConnector}`, `${j.host}#${j.hostConnector}`]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pairs only type-compatible connectors, of the kind each joint names', () => {
    for (const j of layout.joints) {
      const end = PART_TYPES[poseOf.get(j.hardware).type].connectors[j.hardwareConnector];
      const hole = PART_TYPES[poseOf.get(j.host).type].connectors[j.hostConnector];
      expect([end.type, hole.type]).not.toContain(undefined);
      expect(j.kind).not.toBeNull();
    }
  });

  // Through a dowel, the two holes it joins meet face to face: the panels close up flush.
  it('brings the two holes each dowel joins face to face', () => {
    const dowels = new Map();
    for (const j of layout.joints.filter((j) => j.kind === KIND.DOWEL)) {
      if (!dowels.has(j.hardware)) dowels.set(j.hardware, []);
      dowels.get(j.hardware).push(world(j.host, j.hostConnector));
    }
    expect(dowels.size).toBe(MANIFEST_QUANTITIES.dowel - SPARES.dowel);
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

  it('seats every bolt in a side and gives every cam a captured bolt head within reach', () => {
    const headIndex = PART_TYPES.camLockBolt.connectors.findIndex((c) => c.type === CONNECTOR.BOLT_HEAD);
    const bolts = layout.joints.filter((j) => j.kind === KIND.BOLT);
    const heads = bolts.map((j) => ({ id: j.hardware, position: world(j.hardware, headIndex).position }));
    for (const b of bolts) expect(['leftSide', 'rightSide']).toContain(poseOf.get(b.host).role);
    const cams = layout.joints.filter((j) => j.kind === KIND.CAM);
    expect(cams).toHaveLength(MANIFEST_QUANTITIES.camLock - SPARES.camLock);
    for (const cam of cams) {
      const recess = world(cam.host, cam.hostConnector);
      expect(cam.captured).not.toBeNull();
      expect(capture(recess, heads)?.id).toBe(cam.captured);
      const head = heads.find((h) => h.id === cam.captured).position;
      expect(Math.hypot(...head.map((v, i) => v - recess.position[i]))).toBeLessThanOrEqual(FASTENER.captureRadius);
    }
    // One cam per bolt.
    expect(new Set(cams.map((c) => c.captured)).size).toBe(cams.length);
  });

  // The cam ties its panel to the side that panel's end is doweled to — not across.
  it('catches each cam\'s bolt in the side its own panel end is doweled to', () => {
    const boltHost = new Map(layout.joints.filter((j) => j.kind === KIND.BOLT).map((j) => [j.hardware, j.host]));
    for (const cam of layout.joints.filter((j) => j.kind === KIND.CAM)) {
      const side = poseOf.get(boltHost.get(cam.captured));
      const recess = world(cam.host, cam.hostConnector).position;
      expect(Math.sign(recess[0])).toBe(Math.sign(side.position[0]));
    }
  });

  it('lands every back fitting\'s tip inside the panel behind the back', () => {
    const fittings = layout.joints.filter((j) => j.kind === KIND.FITTING);
    expect(fittings).toHaveLength(MANIFEST_QUANTITIES.backFitting);
    for (const f of fittings) {
      expect(poseOf.get(f.host).role).toBe('back');
      expect(f.through).not.toBeNull();
      const through = poseOf.get(f.through);
      expect(['leftSide', 'rightSide', 'bottom', 'top']).toContain(through.role);
      expect(contains(PART_TYPES[through.type].size, through, world(f.hardware, f.hardwareConnector).position)).toBe(true);
    }
  });

  it('puts a shelf pin in every pin hole', () => {
    expect(layout.joints.filter((j) => j.kind === KIND.PIN)).toHaveLength(MANIFEST_QUANTITIES.shelfPin);
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
        const o = overlap(boxOf(panels[i]), boxOf(panels[k]));
        // Touching is fine; any axis with no positive overlap keeps them apart.
        expect(Math.min(...o), `${panels[i].id} vs ${panels[k].id}`).toBeLessThanOrEqual(MM);
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
    const top = Math.max(...layout.parts.map((p) => boxOf(p).max[1]));
    expect(top).toBeLessThan(ROOM.height);
  });
});

describe('placeLayout', () => {
  it('carries every pose by one rigid placement, keeping the joints coincident', () => {
    const turn = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const placed = placeLayout(layout.parts, { position: [1, 0, -2], rotation: turn });
    const at = new Map(placed.map((p) => [p.id, p]));
    for (const j of layout.joints.slice(0, 6)) {
      const end = connectorInWorld(PART_TYPES[at.get(j.hardware).type].connectors[j.hardwareConnector], at.get(j.hardware));
      const hole = connectorInWorld(PART_TYPES[at.get(j.host).type].connectors[j.hostConnector], at.get(j.host));
      expectVec(end.position, hole.position.map((v, i) => v - hole.axis[i] * FASTENER.sinkDepth[j.kind]));
    }
  });
});
