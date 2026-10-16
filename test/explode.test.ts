import { describe, expect, it } from 'vitest';
import { BOOKLET } from '../src/constants.js';
import { explodeStep, floatOut, insetsFor, separation } from '../src/game/explode.js';
import type { ExplodeLayout } from '../src/game/explode.js';
import type { Joint } from '../src/game/item.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The explode maths on a made-up layout, so each rule is pinned by numbers you can check by
// eye: a plate lying at the origin with a dowel hole in its top face (axis +y), a dowel
// seated in it, and a side whose two holes press onto two dowels standing in the plate.
const ID: Quat = [0, 0, 0, 1];
const partTypes = {
  plate: { partNumber: 'P', connectors: [{ position: [0.1, 0.01, 0] as Vec3, axis: [0, 1, 0] as Vec3 }, { position: [-0.1, 0.01, 0] as Vec3, axis: [0, 1, 0] as Vec3 }] },
  dowel: { partNumber: 'D', connectors: [{ position: [0, 0.02, 0] as Vec3, axis: [0, -1, 0] as Vec3 }, { position: [0, -0.02, 0] as Vec3, axis: [0, 1, 0] as Vec3 }] },
  // A side standing on the dowels: its holes face down.
  side: { partNumber: 'S', connectors: [{ position: [0.1, -0.01, 0] as Vec3, axis: [0, -1, 0] as Vec3 }, { position: [-0.1, -0.01, 0] as Vec3, axis: [0, -1, 0] as Vec3 }] },
};
const at = (id: string, type: string, position: Vec3) => ({ id, type, position, rotation: ID });
const joint = (hardware: string, hardwareConnector: number, host: string, hostConnector: number, mover: string): Joint => ({
  hardware,
  hardwareConnector,
  host,
  hostConnector,
  kind: 'dowel' as Joint['kind'],
  mover,
  through: null,
  captured: null,
});
const layout: ExplodeLayout = {
  parts: [at('plate', 'plate', [0, 0, 0]), at('d1', 'dowel', [0.1, 0.01, 0]), at('d2', 'dowel', [-0.1, 0.01, 0]), at('side', 'side', [0, 0.06, 0]), at('old', 'plate', [0, -1, 0])],
  joints: [
    // 0, 1: the dowels pushed into the plate's holes.
    joint('d1', 0, 'plate', 0, 'd1'),
    joint('d2', 0, 'plate', 1, 'd2'),
    // 2, 3: the side pressed onto their upper ends.
    joint('d1', 1, 'side', 0, 'side'),
    joint('d2', 1, 'side', 1, 'side'),
  ],
};
const shown = ['plate', 'd1', 'd2', 'side', 'old'];
const at3 = (v: Vec3 | undefined, y: number): void => expect(v).toEqual([expect.closeTo(v![0]), expect.closeTo(y), expect.closeTo(v![2])]);

describe('separation (the rule)', () => {
  it('floats hardware out of its hole along the hole axis by BOOKLET.explode.hardware', () => {
    const { offsets } = separation({ joints: [0], pose: 'upright', shown }, layout, partTypes);
    expect(offsets.get('d1')).toEqual([0, BOOKLET.explode.hardware, 0]);
    expect(offsets.has('plate')).toBe(false);
  });

  it('pulls a part pressed onto hardware away against the hole axis by BOOKLET.explode.part', () => {
    const { offsets } = separation({ joints: [2], pose: 'upright', shown }, layout, partTypes);
    // The side's hole faces down; away from the dowel is up.
    expect(offsets.get('side')).toEqual([0, BOOKLET.explode.part, 0]);
  });

  it('moves a part pressed onto several dowels along their average, once', () => {
    const { offsets } = separation({ joints: [2, 3], pose: 'upright', shown }, layout, partTypes);
    expect(offsets.get('side')).toEqual([0, BOOKLET.explode.part, 0]);
  });

  it('leaves parts built earlier and hardware seated earlier where they are', () => {
    const { offsets } = separation({ joints: [2, 3], pose: 'upright', shown }, layout, partTypes);
    for (const id of ['plate', 'old', 'd1', 'd2']) expect(offsets.has(id), id).toBe(false);
  });

  it('carries hardware floated out of a part that is itself pulled away', () => {
    const joints = [...layout.joints, joint('d3', 0, 'side', 0, 'd3')];
    const withD3: ExplodeLayout = { parts: [...layout.parts, at('d3', 'dowel', [0.1, 0.1, 0])], joints };
    const { offsets } = separation({ joints: [2, 4], pose: 'upright', shown: [...shown, 'd3'] }, withD3, partTypes);
    // d3 sits in the side's hole 0 (axis down): it floats down by `hardware` and rides the side up.
    expect(offsets.get('d3')).toEqual([0, BOOKLET.explode.part - BOOKLET.explode.hardware, 0]);
  });

  it('rides hardware seated only in a pulled-away part with that part', () => {
    const own: ExplodeLayout = { parts: [...layout.parts, at('d4', 'dowel', [0.1, 0.1, 0])], joints: [...layout.joints, joint('d4', 0, 'side', 0, 'd4')] };
    const { offsets } = separation({ joints: [2], pose: 'upright', shown: [...shown, 'd4'] }, own, partTypes);
    expect(offsets.get('d4')).toEqual(offsets.get('side'));
  });

  it('floats only hardware on a loose-parts page, whose panels fan instead', () => {
    const { offsets } = separation({ joints: [0, 2], pose: 'parts', shown }, layout, partTypes);
    expect(offsets.has('side')).toBe(false);
    expect(offsets.has('d1')).toBe(true);
  });
});

describe('explodeStep', () => {
  it('draws every shown part at its pose plus its offset', () => {
    const { items } = explodeStep({ joints: [0, 2], pose: 'upright', shown }, layout, partTypes);
    expect(items.map((i) => i.id)).toEqual(shown);
    at3(items.find((i) => i.id === 'd1')?.position, 0.01 + BOOKLET.explode.hardware);
    at3(items.find((i) => i.id === 'side')?.position, 0.06 + BOOKLET.explode.part);
    expect(items.find((i) => i.id === 'plate')?.position).toEqual([0, 0, 0]);
  });

  it('runs a leader from each floated fastener’s seated spot to where it floats', () => {
    const { leaders } = explodeStep({ joints: [0], pose: 'upright', shown }, layout, partTypes);
    expect(leaders).toHaveLength(1);
    const [from, to] = leaders[0];
    expect(from).toEqual(expect.arrayContaining([expect.closeTo(0.1), expect.closeTo(0.03)]));
    expect(to[1] - from[1]).toBeCloseTo(BOOKLET.explode.hardware);
  });

  it('draws no leaders for a part that is only pulled away', () => {
    expect(explodeStep({ joints: [2], pose: 'upright', shown }, layout, partTypes).leaders).toEqual([]);
  });
});

describe('floatOut', () => {
  it('floats the fastener end out of the hole along its axis', () => {
    const [from, to] = floatOut(layout.joints[0], layout, partTypes);
    expect(to[1] - from[1]).toBeCloseTo(BOOKLET.explode.hardware);
    expect(to[0]).toBe(from[0]);
  });
});

describe('insetsFor', () => {
  const hardware = [{ type: 'dowel', count: 2, partNumber: 'D' }];

  it('gives one inset per fastener type, from the first joint of that type, with its count', () => {
    const insets = insetsFor({ joints: [0, 1], hardware }, layout, partTypes);
    expect(insets).toHaveLength(1);
    expect(insets[0]).toMatchObject({ type: 'dowel', count: 2, partNumber: 'D', joint: 0 });
  });

  it('shows the host at its pose and the fastener floated out, with its leader', () => {
    const [inset] = insetsFor({ joints: [0, 1], hardware }, layout, partTypes);
    expect(inset.items.map((i) => i.id)).toEqual(['plate', 'd1']);
    expect(inset.items[1].position[1]).toBeCloseTo(0.01 + BOOKLET.explode.hardware);
    expect(inset.leader[1][1] - inset.leader[0][1]).toBeCloseTo(BOOKLET.explode.hardware);
  });

  it('frames a box round the hole mouth and the floated fastener, and anchors the tail at the hole', () => {
    const [inset] = insetsFor({ joints: [0, 1], hardware }, layout, partTypes);
    expect(inset.anchor).toEqual([0.1, 0.01, 0]);
    const f = BOOKLET.inset.focus;
    expect(inset.focus.min[0]).toBeCloseTo(0.1 - f);
    expect(inset.focus.max[0]).toBeCloseTo(0.1 + f);
    expect(inset.focus.min[1]).toBeCloseTo(0.01 - f);
    expect(inset.focus.max[1]).toBeCloseTo(0.01 + BOOKLET.explode.hardware + f);
  });

  it('gives a step with no hardware no insets', () => {
    expect(insetsFor({ joints: [2], hardware: [] }, layout, partTypes)).toEqual([]);
  });
});
