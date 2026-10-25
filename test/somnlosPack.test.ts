import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';
import { deriveJoints, isHardwareType } from '../tools/validate/lib/joints.js';
import { loadPack } from '../tools/validate/lib/pack.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { COLORS } from '../src/constants.js';
import { createBooklet, gamePagesFor } from '../src/game/bookletModel.js';
import { itemById } from '../src/game/item.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';

// SÖMNLÖS's own facts, on the shipped pack (1.9.0.4): a bed frame in vocabulary already on
// main — a headboard and a footboard between two rails on dowels and cams, six glides pressed
// into the rails, a beam dowelled between the panels on two screwed legs, and fifteen loose
// slats across it all. The generic integrity rules are the validator's and run here too.
// How the frame feels to build, and the part budget, are device checks.

const FILE: FlatpackFile = JSON.parse(readFileSync(new URL('../items/somnlos/flatpack.json', import.meta.url), 'utf8'));
const pack = loadPack(FILE);
const joints = deriveJoints(pack);
const count = (type: string) => pack.manifest.filter((p) => p.type === type).length;
const typeOf = new Map(pack.manifest.map((p) => [p.id, p.type]));
const ofKind = (kind: string) => joints.filter((j) => j.kind === kind);
const byId = new Map(pack.assembled.map((a) => [a.id, a]));

/** World [min, max] extents of an assembled instance's box. */
function extents(id: string) {
  const inst = byId.get(id)!;
  const half = pack.partTypes[inst.type].size.map((d) => d / 2);
  const reach = [0, 1, 2].map((axis) =>
    [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(inst.rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)) as Vec3)[axis]), 0),
  );
  return { min: inst.position.map((v, i) => v - reach[i]), max: inst.position.map((v, i) => v + reach[i]) };
}

describe('the SÖMNLÖS pack', () => {
  it('carries its catalog identity: a category, two variants in known colours, no description', () => {
    const { identity } = FILE;
    expect(identity.category).toBe('Bed frame');
    expect(identity.variants.map((v) => v.name)).toEqual(['White', 'Black-brown']);
    for (const { color } of identity.variants) expect(COLORS).toHaveProperty(color);
    expect(identity).not.toHaveProperty('description');
  });

  it('passes the validator, packing included', () => {
    expect(checkPack(FILE)).toEqual([]);
  });

  it('boxes 67 instances with their per-type counts and five spares', () => {
    expect(pack.manifest).toHaveLength(67);
    expect(pack.spares.size).toBe(5);
    const types = ['sideRail', 'headboard', 'footboard', 'beam', 'leg', 'slat', 'glide', 'dowel', 'camLockBolt', 'camLock', 'screw', 'allenWrench', 'screwdriver'];
    expect(types.map(count)).toEqual([2, 1, 1, 1, 2, 15, 6, 14, 8, 9, 6, 1, 1]);
    expect(Object.keys(FILE.parts).sort()).toEqual([...types].sort());
  });

  it('names the product SÖMNLÖS by SKRUV, with no brand word anywhere', () => {
    expect(pack.identity).toMatchObject({ product: 'SÖMNLÖS', maker: 'SKRUV' });
    expect(JSON.stringify(FILE)).not.toMatch(/IKEA|MALM|LÖNSET|LURÖY/i);
  });

  it('derives 50 joints: 24 dowel ends, 8 bolt, 8 cam, 6 pin, 4 screw', () => {
    expect(joints).toHaveLength(50);
    expect([KIND.DOWEL, KIND.BOLT, KIND.CAM, KIND.PIN, KIND.SCREW].map((k) => ofKind(k).length)).toEqual([24, 8, 8, 6, 4]);
    expect(ofKind(KIND.SLIDE)).toHaveLength(0);
  });

  it('sets the headboard and the footboard between the rails on two dowels and two cam bolts at each end', () => {
    for (const panel of ['headboard-1', 'footboard-1']) {
      for (const rail of ['sideRail-1', 'sideRail-2']) {
        // A rail-end dowel has one end in the rail and one in the panel.
        const dowels = ofKind(KIND.DOWEL).filter((j) => j.host === panel && ofKind(KIND.DOWEL).some((k) => k.hardware === j.hardware && k.host === rail));
        expect(dowels, `${panel} ↔ ${rail} dowels`).toHaveLength(2);
        // A bolt in the rail whose head a cam in the panel catches.
        const bolts = ofKind(KIND.BOLT).filter((j) => j.host === rail && ofKind(KIND.CAM).some((c) => c.host === panel && c.captured === j.hardware));
        expect(bolts, `${panel} ↔ ${rail} bolts`).toHaveLength(2);
      }
    }
    expect(new Set(ofKind(KIND.CAM).map((j) => j.captured)).size).toBe(8);
  });

  it('dowels the beam into both panels and screws the legs into the beam only', () => {
    const beamDowels = ofKind(KIND.DOWEL).filter((j) => j.host === 'beam-1');
    expect(beamDowels).toHaveLength(4);
    for (const j of beamDowels) {
      const other = ofKind(KIND.DOWEL).find((k) => k.hardware === j.hardware && k.host !== 'beam-1')!;
      expect(['headboard-1', 'footboard-1']).toContain(other.host);
    }
    for (const panel of ['headboard-1', 'footboard-1']) {
      expect(beamDowels.filter((j) => ofKind(KIND.DOWEL).some((k) => k.hardware === j.hardware && k.host === panel)), panel).toHaveLength(2);
    }
    const screws = ofKind(KIND.SCREW);
    expect(screws.map((j) => [typeOf.get(j.host), j.through])).toEqual(Array(4).fill(['leg', 'beam-1']));
    // A screwed part is 12 mm thick at the hole.
    expect(FILE.parts.leg.box[0]).toBeCloseTo(0.012, 9);
  });

  it('presses the six glides into the rails\' top edges, in the gaps between the slats', () => {
    const glides = ofKind(KIND.PIN);
    expect(glides).toHaveLength(6);
    for (const j of glides) {
      expect(typeOf.get(j.hardware)).toBe('glide');
      expect(typeOf.get(j.host)).toBe('sideRail');
      const glide = extents(j.hardware);
      for (const slat of pack.assembled.filter((a) => a.type === 'slat')) {
        const s = extents(slat.id);
        const apart = glide.max[2] <= s.min[2] + 1e-9 || glide.min[2] >= s.max[2] - 1e-9;
        expect(apart, `${j.hardware} under ${slat.id}`).toBe(true);
      }
    }
  });

  it('lays fifteen plain slats, 1.60 × 0.016 × 0.08, at 13 cm centres on the rails\' top plane, none in a joint', () => {
    expect(FILE.parts.slat.box).toEqual([1.6, 0.016, 0.08]);
    expect(FILE.parts.slat.connectors).toEqual([]);
    const slats = pack.assembled.filter((a) => a.type === 'slat');
    expect(slats).toHaveLength(15);
    const zs = slats.map((s) => s.position[2]).sort((a, b) => a - b);
    zs.forEach((z, k) => expect(z, `slat ${k + 1}`).toBeCloseTo(-0.91 + 0.13 * k, 9));
    const railTop = extents('sideRail-1').max[1];
    for (const s of slats) {
      expect(extents(s.id).min[1], s.id).toBeCloseTo(railTop, 9);
      // Ends flush with the rails' outer faces.
      expect(extents(s.id).min[0]).toBeCloseTo(extents('sideRail-1').min[0], 9);
      expect(extents(s.id).max[0]).toBeCloseTo(extents('sideRail-2').max[0], 9);
    }
    expect(extents('beam-1').max[1]).toBeCloseTo(railTop, 9);
    for (const j of joints) expect([j.hardware, j.host, j.through].some((id) => id !== null && typeOf.get(id) === 'slat'), j.hardware).toBe(false);
  });

  it('stands the built frame flat on the floor on its panels, the wooden parts touching but never passing through each other', () => {
    const wooden = pack.assembled.filter((a) => !isHardwareType(pack.partTypes[a.type]));
    for (const id of ['sideRail-1', 'sideRail-2', 'headboard-1', 'footboard-1', 'leg-1', 'leg-2']) expect(extents(id).min[1], id).toBeCloseTo(0, 9);
    for (const a of wooden) expect(extents(a.id).min[1], a.id).toBeGreaterThanOrEqual(-1e-9);
    for (let i = 0; i < wooden.length; i++) {
      for (let k = i + 1; k < wooden.length; k++) {
        const [a, b] = [extents(wooden[i].id), extents(wooden[k].id)];
        const through = [0, 1, 2].every((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-9);
        expect(through, `${wooden[i].id} through ${wooden[k].id}`).toBe(false);
      }
    }
  });

  it('uses only colours the game defines', () => {
    for (const part of Object.values(pack.partTypes)) expect(COLORS).toHaveProperty(part.color);
  });

  it('draws the loose parts on three pages and the frame as built, upright, on seven', () => {
    const poses = FILE.manual.pages.flatMap((p) => (p.kind === 'step' || p.kind === 'special' ? [p.pose] : []));
    expect(poses).toEqual([...Array(3).fill('parts'), ...Array(7).fill('upright')]);
  });
});

describe("SÖMNLÖS's booklet", () => {
  const item = itemById('somnlos');
  const pages = createBooklet(item.manual.pages, {
    layout: item.assembled,
    manifest: item.manifest,
    partTypes: item.partTypes,
    resolve: item.resolve,
    gamePages: gamePagesFor('touch', item.kinds),
  });

  it('runs cover to back with the controls page second to last, a pin row among its kinds', () => {
    expect(pages[0].kind).toBe('cover');
    expect(pages.at(-1)!.kind).toBe('backCover');
    expect(pages.at(-2)).toMatchObject({ kind: 'controls', scheme: 'touch', kinds: expect.arrayContaining([KIND.PIN, KIND.SCREW, KIND.CAM, KIND.TOOL]) });
  });

  it('builds the frame, then the base: ten steps, the slats last', () => {
    const steps = pages.flatMap((p) => (p.kind === 'step' ? [p] : []));
    expect(steps.map((s) => [s.number, s.pose, s.parts.length, s.joints.length, s.tool])).toEqual([
      [1, 'parts', 2, 6, null],
      [2, 'parts', 0, 8, 'allenWrench'],
      [3, 'parts', 0, 8, null],
      [4, 'upright', 2, 8, null],
      [5, 'upright', 0, 8, null],
      [6, 'upright', 0, 0, 'screwdriver'], // its cams turned: turns, not joints
      [7, 'upright', 0, 4, null],
      [8, 'upright', 3, 4, 'screwdriver'],
      [9, 'upright', 0, 4, null],
      [10, 'upright', 15, 0, null],
    ]);
  });
});
