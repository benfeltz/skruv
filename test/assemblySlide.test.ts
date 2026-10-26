import { describe, expect, it, vi } from 'vitest';
import { createAssembly } from '../src/game/assembly.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { DOWEL_BOTTOM, PLATE_DOWEL_TOP, PLATE_GROOVE_L, PLATE_GROOVE_R, RAIL_TRAVEL, RUNNER_END, railsLayout } from './support/railParts.js';
import type { PoseOf } from '../src/game/assembly.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

vi.mock('../src/game/item.js', async (original) => (await import('./support/railParts.js')).withRails(await original()));

// The slide in the graph (1.9.3.3.2): a plate on two runners is a unit with two slide joints,
// bonded prismatic along the plate's own travel.

const typeOf = (id: string) => id.replace(/-\d+$/, '');
const TRAVEL: Vec3 = [0, 0, RAIL_TRAVEL];
const layout = railsLayout([0.016, 0, RAIL_TRAVEL]);
const poseOf: PoseOf = (id) => {
  const { position, rotation } = layout.find((p) => p.id === id)!;
  return { position, rotation };
};

function railed(travelOf?: (part: string) => Vec3 | null) {
  const assembly = createAssembly(typeOf, travelOf);
  const left = assembly.seat({ partA: 'runner-1', connectorA: RUNNER_END, partB: 'plate-1', connectorB: PLATE_GROOVE_L, mover: 'plate-1' });
  const right = assembly.seat({ partA: 'runner-2', connectorA: RUNNER_END, partB: 'plate-1', connectorB: PLATE_GROOVE_R, mover: 'plate-1' });
  return { assembly, left, right };
}
const plateTravel = (part: string) => (part === 'plate-1' ? TRAVEL : null);

describe('slideOf', () => {
  it('is the plate and its two runner joints, with the travel in the plate frame', () => {
    const { assembly, left, right } = railed(plateTravel);
    const slide = assembly.slideOf('plate-1')!;
    expect([...slide.unit]).toEqual(['plate-1']);
    expect(slide.joints.map((j) => j.id)).toEqual([left.id, right.id]);
    expect(slide.host).toBe('plate-1');
    expect(slide.travel).toEqual(TRAVEL);
  });

  it('takes in whatever is fastened to the plate but across a slide', () => {
    const { assembly } = railed(plateTravel);
    const dowel = assembly.seat({ partA: 'dowel-1', connectorA: DOWEL_BOTTOM, partB: 'plate-1', connectorB: PLATE_DOWEL_TOP, mover: 'dowel-1' });
    assembly.apply(dowel.id, { type: 'tap' });
    const slide = assembly.slideOf('dowel-1')!;
    expect([...slide.unit].sort()).toEqual(['dowel-1', 'plate-1']);
    expect(slide.joints).toHaveLength(2);
  });

  it('is null for the runner, whose unit is the carcass', () => {
    expect(railed(plateTravel).assembly.slideOf('runner-1')).toBeNull();
  });

  it('is null once the slide is pulled to seated', () => {
    const { assembly, left, right } = railed(plateTravel);
    assembly.apply(left.id, { type: 'pull' });
    assembly.apply(right.id, { type: 'pull' });
    expect(assembly.slideOf('plate-1')).toBeNull();
  });

  it('is null without a travel', () => {
    expect(railed().assembly.slideOf('plate-1')).toBeNull();
  });
});

describe('bonds on a slide', () => {
  it('has a slide bond per runner, host first, and no bridge', () => {
    const { assembly } = railed(plateTravel);
    const bonds = assembly.bonds(poseOf);
    expect(bonds.map((b) => b.key).sort()).toEqual(['slide:runner-1', 'slide:runner-2']);
    for (const bond of bonds) {
      expect(bond).toMatchObject({ a: 'plate-1', mode: 'slide', slide: { axis: [0, 0, 1], travel: RAIL_TRAVEL } });
    }
    expect(bonds.map((b) => b.b).sort()).toEqual(['runner-1', 'runner-2']);
  });

  it('keeps the host frame axis whichever way the runner is turned', () => {
    const bonds = railed(plateTravel).assembly.bonds(poseOf);
    expect(bonds.find((b) => b.b === 'runner-2')!.slide!.axis).toEqual(bonds.find((b) => b.b === 'runner-1')!.slide!.axis);
  });

  it('signs the bond by joint and travel', () => {
    const { assembly, left } = railed(plateTravel);
    expect(assembly.bonds(poseOf).find((b) => b.b === 'runner-1')!.signature).toBe(`slide|${left.id}|${RAIL_TRAVEL}`);
  });

  it('bonds a host without a travel as a plain embed', () => {
    const bonds = railed().assembly.bonds(poseOf);
    expect(bonds.map((b) => b.mode)).toEqual(['embed', 'embed']);
    expect(bonds.every((b) => b.slide === undefined)).toBe(true);
  });

  it('has no slide bond once a slide is pulled off', () => {
    const { assembly, left, right } = railed(plateTravel);
    assembly.apply(left.id, { type: 'pull' });
    assembly.apply(right.id, { type: 'pull' });
    expect(assembly.bonds(poseOf)).toEqual([]);
  });

  it('seats a slide fastened', () => {
    expect(railed(plateTravel).left.kind).toBe(KIND.SLIDE);
  });
});
