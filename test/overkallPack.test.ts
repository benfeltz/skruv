import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { loadPack } from '../tools/validate/lib/pack.js';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { COLORS } from '../src/constants.js';
import { createBooklet, gamePagesFor } from '../src/game/bookletModel.js';
import { rowsFor } from '../src/game/controlsPage.js';
import { itemById } from '../src/game/item.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';

// ÖVERKÄLL's own facts, on the shipped pack (1.9.3.2): a carcass in JOHNNY's vocabulary and a
// drawer that is a screwed box standing in its cavity with no joint to it. The generic
// integrity rules are the validator's and run here too (packing rests and fits among them).
// The drawer resting loose in the cavity and the part-budget feel are device checks.

const FILE: FlatpackFile = JSON.parse(readFileSync(new URL('../items/overkall/flatpack.json', import.meta.url), 'utf8'));
const pack = loadPack(FILE);
const joints = deriveJoints(pack);
const count = (type: string) => pack.manifest.filter((p) => p.type === type).length;
const typeOf = new Map(pack.manifest.map((p) => [p.id, p.type]));

const DRAWER = ['drawerFront', 'drawerSide', 'drawerBack', 'drawerBottom', 'knob'];
const CARCASS = ['sidePanel', 'topBottomPanel', 'backPanel'];
const inDrawer = (id: string | null) => id !== null && DRAWER.includes(typeOf.get(id)!);
const inCarcass = (id: string | null) => id !== null && CARCASS.includes(typeOf.get(id)!);
const ofKind = (kind: string) => joints.filter((j) => j.kind === kind);

describe('the ÖVERKÄLL pack', () => {
  it('passes the validator, packing included', () => {
    expect(checkPack(FILE)).toEqual([]);
  });

  it('boxes 55 instances with their per-type counts and five spares', () => {
    expect(pack.manifest).toHaveLength(55);
    expect(pack.spares.size).toBe(5);
    const types = [
      'sidePanel', 'topBottomPanel', 'backPanel', 'drawerFront', 'drawerSide', 'drawerBack', 'drawerBottom', 'knob',
      'dowel', 'camLockBolt', 'camLock', 'backFitting', 'screw', 'allenWrench', 'screwdriver',
    ];
    expect(types.map(count)).toEqual([2, 2, 1, 1, 2, 1, 1, 1, 10, 4, 5, 6, 17, 1, 1]);
    expect(types.reduce((sum, t) => sum + count(t), 0)).toBe(55);
    expect(Object.keys(FILE.parts).sort()).toEqual([...types].sort());
  });

  it('names the product ÖVERKÄLL by SKRUV, with no brand word anywhere', () => {
    expect(pack.identity).toMatchObject({ product: 'ÖVERKÄLL', maker: 'SKRUV' });
    expect(JSON.stringify(FILE)).not.toMatch(/IKEA|STORKLINTA|LACK/i);
  });

  it('derives 45 joints: 16 dowel ends, 4 bolt, 4 cam, 6 fitting, 15 screw', () => {
    expect(joints).toHaveLength(45);
    expect([KIND.DOWEL, KIND.BOLT, KIND.CAM, KIND.FITTING, KIND.SCREW].map((k) => ofKind(k).length)).toEqual([16, 4, 4, 6, 15]);
  });

  it('seats every dowel end once: 8 dowels, an end in a panel and an end in a side', () => {
    const dowels = ofKind(KIND.DOWEL);
    expect(dowels.filter((j) => typeOf.get(j.host) === 'topBottomPanel')).toHaveLength(8);
    expect(dowels.filter((j) => typeOf.get(j.host) === 'sidePanel')).toHaveLength(8);
  });

  it('catches every bolt head with a cam, and passes every fitting into a panel', () => {
    for (const j of ofKind(KIND.CAM)) expect(j.captured).not.toBeNull();
    expect(new Set(ofKind(KIND.CAM).map((j) => j.captured)).size).toBe(4);
    for (const j of ofKind(KIND.FITTING)) expect(j.through).not.toBeNull();
  });

  it('holds the drawer together with fifteen screws, each through to a drawer part or the knob', () => {
    const screws = ofKind(KIND.SCREW);
    expect(screws).toHaveLength(15);
    for (const j of screws) {
      expect(j.through, `${j.hardware} passes into nothing`).not.toBeNull();
      expect(inDrawer(j.host), `${j.hardware} host`).toBe(true);
      expect(inDrawer(j.through), `${j.hardware} through`).toBe(true);
    }
    expect(screws.filter((j) => typeOf.get(j.through!) === 'knob')).toHaveLength(1);
  });

  it('keeps the drawer apart from the carcass: no joint spans a drawer part and a carcass part', () => {
    for (const j of joints) {
      const ends = [j.host, j.through].filter((id): id is string => id !== null);
      expect(ends.some(inDrawer) && ends.some(inCarcass), `${j.hardware} → ${j.host}`).toBe(false);
    }
  });

  it('gives the screw a thread end and a drive slot on its head end, and the carcass only JOHNNY\'s kinds', () => {
    const screw = pack.partTypes.screw.connectors;
    expect(screw.map((c) => c.type)).toEqual([CONNECTOR.SCREW_THREAD, CONNECTOR.DRIVE_SLOT]);
    expect(screw[1].position).toEqual([0, 0.014, 0]);
    const carcassTypes = new Set(CARCASS.flatMap((t) => FILE.parts[t].connectors.map((c) => c.type)));
    expect([...carcassTypes].sort()).toEqual([CONNECTOR.BACK_FITTING_HOLE, CONNECTOR.CAM_BOLT_HOLE, CONNECTOR.CAM_LOCK_RECESS, CONNECTOR.DOWEL_HOLE].sort());
    for (const part of Object.values(FILE.parts)) expect(part.mesh).toBeUndefined();
  });

  it('uses only colours the game defines', () => {
    for (const part of Object.values(pack.partTypes)) expect(COLORS).toHaveProperty(part.color);
  });

  it('draws parts ×2, lying ×5, faceDown ×2, upright ×5', () => {
    const poses = FILE.manual.pages.flatMap((p) => (p.kind === 'step' || p.kind === 'special' ? [p.pose] : []));
    const tally = (pose: string) => poses.filter((p) => p === pose).length;
    expect(['parts', 'lying', 'faceDown', 'upright'].map(tally)).toEqual([2, 5, 2, 5]);
    expect(poses).toHaveLength(14);
  });
});

describe("ÖVERKÄLL's booklet", () => {
  const item = itemById('overkall');
  const pages = createBooklet(item.manual.pages, {
    layout: item.assembled,
    manifest: item.manifest,
    partTypes: item.partTypes,
    resolve: item.resolve,
    gamePages: gamePagesFor('touch', item.kinds),
  });

  it('runs cover to back with the controls page second to last, listing the item\'s kinds', () => {
    expect(pages[0].kind).toBe('cover');
    expect(pages.at(-1)!.kind).toBe('backCover');
    expect(pages.at(-2)).toMatchObject({ kind: 'controls', scheme: 'touch', kinds: expect.arrayContaining([KIND.SCREW, KIND.CAM, KIND.TOOL]) });
  });

  it("shows no control row beyond JOHNNY's", () => {
    for (const scheme of ['touch', 'desktop'] as const) {
      const johnny = rowsFor(scheme, itemById('johnny').kinds).map((r) => r.pictogram);
      const overkall = rowsFor(scheme, item.kinds).map((r) => r.pictogram);
      for (const pictogram of overkall) expect(johnny).toContain(pictogram);
    }
  });

  it('builds the drawer first, before the carcass closes around it, every screw with the screwdriver', () => {
    const steps = pages.flatMap((p) => (p.kind === 'step' ? [p] : []));
    expect(steps.slice(0, 4).map((s) => [s.number, s.pose, s.parts.length, s.joints.length, s.tool])).toEqual([
      [1, 'upright', 3, 4, 'screwdriver'],
      [2, 'upright', 1, 6, 'screwdriver'],
      [3, 'upright', 1, 4, 'screwdriver'],
      [4, 'upright', 1, 1, 'screwdriver'],
    ]);
    const firstCarcass = steps.findIndex((s) => s.parts.some((id) => CARCASS.includes(typeOf.get(id)!)));
    expect(firstCarcass).toBe(4);
  });
});
