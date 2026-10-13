import { describe, expect, it } from 'vitest';
import { PART_TYPES } from '../src/game/item.js';
import { acrossOf, halfExtents, shapeOf } from '../src/game/partShapes.js';
import type { Primitive } from '../src/game/partShapes.js';
import type { Connector } from '../src/game/item.js';

const EPS = 1e-9;

// The seven universal pieces JOHNNY ships — every one gets a shape.
const SHAPED = ['allenWrench', 'screwdriver', 'dowel', 'camLockBolt', 'camLock', 'shelfPin', 'backFitting'];

const axisOf = (v: readonly number[]) => v.findIndex((c) => Math.abs(c) > 0.5);

/** The primitive whose end face `connector` sits on, facing out along the connector's axis. */
function faceUnder(primitives: Primitive[], { position, axis }: Connector): Primitive | undefined {
  const a = axisOf(axis);
  return primitives.find((p) => {
    if (p.axis !== a) return false;
    const face = p.position[a] + Math.sign(axis[a]) * (p.length / 2);
    if (Math.abs(position[a] - face) > EPS) return false;
    const [u, v] = acrossOf(p.axis);
    const du = position[u] - p.position[u];
    const dv = position[v] - p.position[v];
    return p.shape === 'cylinder'
      ? Math.hypot(du, dv) <= p.radius + EPS
      : Math.abs(du) <= p.width / 2 + EPS && Math.abs(dv) <= p.depth / 2 + EPS;
  });
}

describe('shapeOf', () => {
  it('shapes exactly the universal pieces; panels, the box and anything unlisted keep their box', () => {
    const shaped = Object.entries(PART_TYPES).filter(([, type]) => shapeOf(type) !== null).map(([name]) => name);
    expect(shaped.sort()).toEqual([...SHAPED].sort());
    expect(shapeOf({ size: [1, 1, 1], connectors: [] })).toBeNull();
  });

  it.each(SHAPED)('draws %s wholly inside its pack box', (name) => {
    const { size } = PART_TYPES[name];
    for (const primitive of shapeOf(PART_TYPES[name])!) {
      const half = halfExtents(primitive);
      for (const i of [0, 1, 2]) {
        expect(Math.abs(primitive.position[i]) + half[i]).toBeLessThanOrEqual(size[i] / 2 + EPS);
      }
    }
  });

  it.each(SHAPED)('puts every %s connector on the end face of a primitive, facing out along it', (name) => {
    const type = PART_TYPES[name];
    const primitives = shapeOf(type)!;
    for (const connector of type.connectors) expect(faceUnder(primitives, connector), connector.id).toBeDefined();
  });

  it('ends the dowel at both connectors: one cylinder end to end', () => {
    const [rod] = shapeOf(PART_TYPES.dowel)!;
    expect(shapeOf(PART_TYPES.dowel)).toHaveLength(1);
    expect(rod.shape).toBe('cylinder');
    for (const connector of PART_TYPES.dowel.connectors) expect(faceUnder([rod], connector)).toBe(rod);
  });

  it('gives the cam bolt a thinner thread under a head the box width', () => {
    const [thread, head] = shapeOf(PART_TYPES.camLockBolt)!;
    const [boltThread, hexSocket] = PART_TYPES.camLockBolt.connectors;
    expect(faceUnder([thread], boltThread)).toBe(thread);
    expect(faceUnder([head], hexSocket)).toBe(head);
    expect(head.shape === 'cylinder' && head.radius).toBeCloseTo(PART_TYPES.camLockBolt.size[0] / 2, 9);
    expect(thread.shape === 'cylinder' && head.shape === 'cylinder' && thread.radius < head.radius).toBe(true);
  });

  it('cuts a dark slot across the cam lock top, where the screwdriver goes in', () => {
    const primitives = shapeOf(PART_TYPES.camLock)!;
    const slot = PART_TYPES.camLock.connectors.find((c) => c.type === 'driveSlot')!;
    expect(faceUnder(primitives, slot)?.tone).toBe('dark');
  });

  describe('the tools', () => {
    // The pack's tips, pinned: the shapes are drawn to them, never the other way round.
    it('leaves the tips where flatpack.json puts them', () => {
      expect(PART_TYPES.allenWrench.connectors).toEqual([
        { id: 'wrenchTip-1', type: 'wrenchTip', position: [0.035, 0, 0.0125], axis: [0, 0, 1] },
      ]);
      expect(PART_TYPES.screwdriver.connectors).toEqual([
        { id: 'screwdriverTip-1', type: 'screwdriverTip', position: [0, -0.1, 0], axis: [0, -1, 0] },
      ]);
      expect(PART_TYPES.allenWrench.size).toEqual([0.07, 0.004, 0.025]);
      expect(PART_TYPES.screwdriver.size).toEqual([0.022, 0.2, 0.022]);
    });

    it('bends the Allen key into an L of hexagonal rod, the short leg ending at the tip', () => {
      const [short, long] = shapeOf(PART_TYPES.allenWrench)!;
      expect(short.shape === 'cylinder' && short.sides).toBe(6);
      expect(long.shape === 'cylinder' && long.sides).toBe(6);
      expect(short.axis).toBe(2);
      expect(long.axis).toBe(0);
      expect(short.length).toBeLessThan(long.length);
      expect(faceUnder([short], PART_TYPES.allenWrench.connectors[0])).toBe(short);
    });

    it('gives the screwdriver a metal blade and shaft under a handle in its own colour', () => {
      const [blade, shaft, handle] = shapeOf(PART_TYPES.screwdriver)!;
      expect(faceUnder([blade], PART_TYPES.screwdriver.connectors[0])).toBe(blade);
      // The tip is the blade's centre.
      expect(blade.position[0]).toBe(0);
      expect(blade.position[2]).toBe(0);
      expect([blade.tone, shaft.tone, handle.tone]).toEqual(['metal', 'metal', 'body']);
      expect(handle.shape === 'cylinder' && handle.radius).toBeCloseTo(PART_TYPES.screwdriver.size[0] / 2, 9);
      // The handle is at the top, away from the tip.
      expect(handle.position[1]).toBeGreaterThan(shaft.position[1]);
    });
  });
});

describe('the double-ended stud (1.9.2)', () => {
  // BLANK's stud is the pack's, not JOHNNY's: the shape is keyed by its stud-end connector, so
  // any item's stud gets it. Sized as the pack sizes it, run through the same builder.
  const stud = {
    size: [0.006, 0.04, 0.006] as [number, number, number],
    connectors: [
      { id: 'studEnd-1', type: 'studEnd', position: [0, 0.02, 0], axis: [0, 1, 0] },
      { id: 'studEnd-2', type: 'studEnd', position: [0, -0.02, 0], axis: [0, -1, 0] },
      { id: 'hexSocket-1', type: 'hexSocket', position: [0, 0.02, 0], axis: [0, 1, 0] },
      { id: 'hexSocket-2', type: 'hexSocket', position: [0, -0.02, 0], axis: [0, -1, 0] },
    ] as Connector[],
  };

  it('is a rod with a dark hexagonal socket plug at each end — not a plain box', () => {
    const primitives = shapeOf(stud)!;
    expect(primitives).not.toBeNull();
    const plugs = primitives.filter((p) => p.tone === 'dark');
    expect(plugs).toHaveLength(2);
    for (const plug of plugs) expect(plug).toMatchObject({ shape: 'cylinder', sides: 6 });
    expect(primitives.filter((p) => p.tone === 'body')).toHaveLength(1);
  });

  it('draws inside its box, with every connector on a primitive end face', () => {
    const primitives = shapeOf(stud)!;
    for (const primitive of primitives) {
      const half = halfExtents(primitive);
      for (const i of [0, 1, 2]) expect(Math.abs(primitive.position[i]) + half[i]).toBeLessThanOrEqual(stud.size[i] / 2 + EPS);
    }
    for (const connector of stud.connectors) expect(faceUnder(primitives, connector), connector.id).toBeDefined();
  });
});

describe('the wood screw (1.9.3.1)', () => {
  // No shipped pack carries a screw yet: sized as a pack would size one, thread end down and
  // its drive slot on the head end, run through the builder its thread connector names.
  const screw = {
    size: [0.004, 0.03, 0.004] as [number, number, number],
    connectors: [
      { id: 'screwThread-1', type: 'screwThread', position: [0, -0.015, 0], axis: [0, -1, 0] },
      { id: 'driveSlot-1', type: 'driveSlot', position: [0, 0.015, 0], axis: [0, 1, 0] },
    ] as Connector[],
  };

  it('is a thin metal thread under a head the box width, a dark slot across the head', () => {
    const [thread, head, slot] = shapeOf(screw)!;
    expect(thread.tone).toBe('metal');
    expect(head.shape === 'cylinder' && head.radius).toBeCloseTo(screw.size[0] / 2, 9);
    expect(thread.shape === 'cylinder' && head.shape === 'cylinder' && thread.radius < head.radius).toBe(true);
    expect(faceUnder([thread], screw.connectors[0])).toBe(thread);
    expect(faceUnder([head, slot], screw.connectors[1])?.tone).toBe('dark');
  });

  it('draws inside its box, with every connector on a primitive end face', () => {
    const primitives = shapeOf(screw)!;
    for (const primitive of primitives) {
      const half = halfExtents(primitive);
      for (const i of [0, 1, 2]) expect(Math.abs(primitive.position[i]) + half[i]).toBeLessThanOrEqual(screw.size[i] / 2 + EPS);
    }
    for (const connector of screw.connectors) expect(faceUnder(primitives, connector), connector.id).toBeDefined();
  });
});
