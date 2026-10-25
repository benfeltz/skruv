import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { loadPack } from '../tools/validate/lib/pack.js';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { COLORS } from '../src/constants.js';
import { createBooklet, gamePagesFor } from '../src/game/bookletModel.js';
import { rowsFor } from '../src/game/controlsPage.js';
import { itemById } from '../src/game/item.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';

// ÖVERKÄLL's own facts, on the shipped pack (1.9.3.2, 1.9.3.3.3): a carcass in JOHNNY's vocabulary
// plus two screwed-in runners, and a drawer that is a screwed box hung on them by two slides. The generic
// integrity rules are the validator's and run here too (packing rests and fits among them).
// The drawer resting loose in the cavity and the part-budget feel are device checks.

const FILE: FlatpackFile = JSON.parse(readFileSync(new URL('../items/overkall/flatpack.json', import.meta.url), 'utf8'));
const pack = loadPack(FILE);
const joints = deriveJoints(pack);
const count = (type: string) => pack.manifest.filter((p) => p.type === type).length;
const typeOf = new Map(pack.manifest.map((p) => [p.id, p.type]));

const DRAWER = ['drawerFront', 'drawerSide', 'drawerBack', 'drawerBottom', 'knob'];
const CARCASS = ['sidePanel', 'topBottomPanel', 'backPanel'];
// A runner is screwed to the carcass: it stands on the carcass side of a slide.
const FIXED = [...CARCASS, 'runner'];
const inDrawer = (id: string | null) => id !== null && DRAWER.includes(typeOf.get(id)!);
const inCarcass = (id: string | null) => id !== null && FIXED.includes(typeOf.get(id)!);
const ofKind = (kind: string) => joints.filter((j) => j.kind === kind);

describe('the ÖVERKÄLL pack', () => {
  it('carries its catalog identity: a category, two variants in known colours, no description', () => {
    const { identity } = FILE;
    expect(identity.category).toBe('Nightstand');
    expect(identity.variants.map((v) => v.name)).toEqual(['White', 'Gray']);
    for (const { color } of identity.variants) expect(COLORS).toHaveProperty(color);
    expect(identity).not.toHaveProperty('description');
  });

  it('passes the validator, packing included', () => {
    expect(checkPack(FILE)).toEqual([]);
  });

  it('boxes 75 instances with their per-type counts and five spares', () => {
    expect(pack.manifest).toHaveLength(75);
    expect(pack.spares.size).toBe(5);
    const types = [
      'sidePanel', 'topBottomPanel', 'backPanel', 'drawerFront', 'drawerSide', 'drawerBack', 'drawerBottom', 'knob',
      'dowel', 'camLockBolt', 'camLock', 'backFitting', 'screw', 'allenWrench', 'screwdriver', 'runner',
    ];
    expect(types.map(count)).toEqual([2, 2, 1, 1, 2, 1, 1, 1, 24, 4, 5, 6, 21, 1, 1, 2]);
    expect(types.reduce((sum, t) => sum + count(t), 0)).toBe(75);
    expect(Object.keys(FILE.parts).sort()).toEqual([...types].sort());
  });

  it('names the product ÖVERKÄLL by SKRUV, with no brand word anywhere', () => {
    expect(pack.identity).toMatchObject({ product: 'ÖVERKÄLL', maker: 'SKRUV' });
    expect(JSON.stringify(FILE)).not.toMatch(/IKEA|STORKLINTA|\bLACK\b/i);
  });

  it('derives 79 joints: 44 dowel ends, 4 bolt, 4 cam, 6 fitting, 19 screw, 2 slide', () => {
    expect(joints).toHaveLength(79);
    expect([KIND.DOWEL, KIND.BOLT, KIND.CAM, KIND.FITTING, KIND.SCREW, KIND.SLIDE].map((k) => ofKind(k).length)).toEqual([44, 4, 4, 6, 19, 2]);
    // Each slide: a runner's rail end in a drawer side's groove, the drawer side the mover.
    for (const j of ofKind(KIND.SLIDE)) expect([typeOf.get(j.hardware), typeOf.get(j.host), j.mover]).toEqual(['runner', 'drawerSide', j.host]);
  });

  it('seats every dowel end once: 8 dowels in the carcass, an end in a panel and an end in a side', () => {
    const dowels = ofKind(KIND.DOWEL);
    expect(dowels.filter((j) => typeOf.get(j.host) === 'topBottomPanel')).toHaveLength(8);
    expect(dowels.filter((j) => typeOf.get(j.host) === 'sidePanel')).toHaveLength(8);
  });

  it('lines every drawer joint up with two dowels, and every screwed joint is one of them', () => {
    // A dowel's two ends are two joints; the part pair it joins is the pair of their hosts.
    const ends = new Map<string, string[]>();
    for (const j of ofKind(KIND.DOWEL).filter((x) => inDrawer(x.host))) ends.set(j.hardware, [...(ends.get(j.hardware) ?? []), j.host]);
    const pair = (a: string, b: string) => [a, b].sort().join('|');
    const dowelsPerPair = new Map<string, number>();
    for (const hosts of ends.values()) {
      expect(hosts, 'a drawer dowel joins two parts').toHaveLength(2);
      dowelsPerPair.set(pair(hosts[0], hosts[1]), (dowelsPerPair.get(pair(hosts[0], hosts[1])) ?? 0) + 1);
    }
    expect(ends.size).toBe(14);
    expect([...dowelsPerPair.values()]).toEqual(Array(7).fill(2));
    // Every screw but the knob's drives through a joint two dowels already hold true.
    for (const j of ofKind(KIND.SCREW).filter((x) => inDrawer(x.host) && typeOf.get(x.host) !== 'knob')) {
      expect(dowelsPerPair.get(pair(j.host, j.through!)), `${j.hardware}: ${j.host} → ${j.through}`).toBe(2);
    }
  });

  it('gives every part a screw drives into a pilot hole where the tip lands, 19 in all', () => {
    const pilots = (type: string) => FILE.parts[type].connectors.filter((c) => c.type === CONNECTOR.SCREW_PILOT).length;
    expect(['drawerSide', 'drawerBottom', 'drawerFront', 'sidePanel'].map(pilots)).toEqual([4, 6, 1, 2]);
    const filled = (type: string) => pack.manifest.filter((p) => p.type === type).length * pilots(type);
    expect(filled('drawerSide') + filled('drawerBottom') + filled('drawerFront') + filled('sidePanel')).toBe(19);
    // The validator rule `pilot-hole` holds the tips to them; every screw has one under it.
    for (const j of ofKind(KIND.SCREW)) expect(pilots(typeOf.get(j.through!)!), `${j.hardware} through ${j.through}`).toBeGreaterThan(0);
  });

  it('catches every bolt head with a cam, and passes every fitting into a panel', () => {
    for (const j of ofKind(KIND.CAM)) expect(j.captured).not.toBeNull();
    expect(new Set(ofKind(KIND.CAM).map((j) => j.captured)).size).toBe(4);
    for (const j of ofKind(KIND.FITTING)) expect(j.through).not.toBeNull();
  });

  it('holds the drawer together with fifteen screws, each through to a drawer part or the knob', () => {
    const screws = ofKind(KIND.SCREW).filter((j) => typeOf.get(j.host) !== 'runner');
    expect(screws).toHaveLength(15);
    for (const j of screws) {
      expect(j.through, `${j.hardware} passes into nothing`).not.toBeNull();
      expect(inDrawer(j.host), `${j.hardware} host`).toBe(true);
      expect(inDrawer(j.through), `${j.hardware} through`).toBe(true);
    }
    // The knob carries its own hole: it is the part attached, the front the part behind.
    expect(screws.filter((j) => typeOf.get(j.host) === 'knob' && typeOf.get(j.through!) === 'drawerFront')).toHaveLength(1);
  });

  it('keeps the drawer front flush: no screw head stands out past the carcass front plane except on the knob', () => {
    const frontPlane = 0.175;
    const byId = new Map(pack.assembled.map((a) => [a.id, a]));
    const slot = pack.partTypes.screw.connectors.findIndex((c) => c.type === CONNECTOR.DRIVE_SLOT);
    for (const j of ofKind(KIND.SCREW).filter((x) => typeOf.get(x.host) === 'drawerFront')) {
      const screw = byId.get(j.hardware)!;
      const head = connectorInWorld(pack.partTypes.screw.connectors[slot], screw).position;
      expect(head[2], `${j.hardware} head`).toBeLessThanOrEqual(frontPlane + 1e-9);
    }
  });

  it('fixes each runner to a side panel with two screws, four in all', () => {
    const screws = ofKind(KIND.SCREW).filter((j) => typeOf.get(j.host) === 'runner');
    expect(screws).toHaveLength(4);
    for (const j of screws) expect(typeOf.get(j.through!), `${j.hardware} through`).toBe('sidePanel');
    expect(new Set(screws.map((j) => j.host)).size).toBe(2);
  });

  it('hangs the drawer on the carcass by its two slides alone: only they span a drawer part and the carcass', () => {
    const spanning = joints.filter((j) => {
      const ends = [j.hardware, j.host, j.through].filter((id): id is string => id !== null);
      return ends.some(inDrawer) && ends.some(inCarcass);
    });
    expect(spanning.map((j) => [j.kind, typeOf.get(j.hardware), typeOf.get(j.host)])).toEqual([[KIND.SLIDE, 'runner', 'drawerSide'], [KIND.SLIDE, 'runner', 'drawerSide']]);
  });

  it('opens each drawer side 0.15 m along the front: its closed pose plus the travel, no turn', () => {
    for (const id of ['drawerSide-1', 'drawerSide-2']) {
      const side = pack.assembled.find((a) => a.id === id)!;
      expect(side.open!.position).toEqual([side.position[0], side.position[1], expect.closeTo(side.position[2] + 0.15, 9)]);
      expect(side.open!.rotation).toEqual(side.rotation);
    }
    expect(pack.assembled.filter((a) => a.open)).toHaveLength(2);
  });

  it('gives the screw a thread end and a drive slot on its head end, and the carcass only JOHNNY\'s kinds', () => {
    const screw = pack.partTypes.screw.connectors;
    expect(screw.map((c) => c.type)).toEqual([CONNECTOR.SCREW_THREAD, CONNECTOR.DRIVE_SLOT]);
    expect(screw[1].position).toEqual([0, 0.014, 0]);
    const carcassTypes = new Set(CARCASS.flatMap((t) => FILE.parts[t].connectors.map((c) => c.type)));
    expect([...carcassTypes].sort()).toEqual([CONNECTOR.BACK_FITTING_HOLE, CONNECTOR.CAM_BOLT_HOLE, CONNECTOR.CAM_LOCK_RECESS, CONNECTOR.DOWEL_HOLE, CONNECTOR.SCREW_PILOT].sort());
    expect(FILE.parts.runner.connectors.map((c) => c.type)).toEqual([CONNECTOR.RAIL_END, CONNECTOR.SCREW_HOLE, CONNECTOR.SCREW_HOLE]);
    for (const part of Object.values(FILE.parts)) expect(part.mesh).toBeUndefined();
  });

  it('uses only colours the game defines', () => {
    for (const part of Object.values(pack.partTypes)) expect(COLORS).toHaveProperty(part.color);
  });

  it('draws parts ×2, lying ×5, faceDown ×2, upright ×12', () => {
    const poses = FILE.manual.pages.flatMap((p) => (p.kind === 'step' || p.kind === 'special' ? [p.pose] : []));
    const tally = (pose: string) => poses.filter((p) => p === pose).length;
    expect(['parts', 'lying', 'faceDown', 'upright'].map(tally)).toEqual([2, 5, 2, 12]);
    expect(poses).toHaveLength(21);
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
    expect(pages.at(-2)).toMatchObject({ kind: 'controls', scheme: 'touch', kinds: expect.arrayContaining([KIND.SCREW, KIND.CAM, KIND.TOOL, KIND.SLIDE]) });
  });

  it("shows exactly one control row beyond JOHNNY's: the slide's 'Pull to open'", () => {
    for (const scheme of ['touch', 'desktop'] as const) {
      const johnny = rowsFor(scheme, itemById('johnny').kinds).map((r) => r.pictogram);
      const overkall = rowsFor(scheme, item.kinds).map((r) => r.pictogram);
      expect(overkall.filter((pictogram) => !johnny.includes(pictogram))).toEqual(['slide']);
      for (const pictogram of johnny) expect(overkall).toContain(pictogram);
    }
  });

  it('builds the carcass first, then the drawer alone, and installs it last', () => {
    const steps = pages.flatMap((p) => (p.kind === 'step' ? [p] : []));
    const drawer = steps.filter((s) => s.assembly === 'drawer');
    // The bottom first, flat: its side dowels, both sides pressed on; its back-edge and the
    // sides' back-end dowels, the back pressed on; every screw after its dowels; the front last.
    expect(drawer.map((s) => [s.number, s.pose, s.parts.length, s.joints.length, s.tool])).toEqual([
      [12, 'upright', 1, 4, null],
      [13, 'upright', 2, 4, null],
      [14, 'upright', 0, 6, null],
      [15, 'upright', 1, 6, null],
      [16, 'upright', 0, 10, 'screwdriver'],
      [17, 'upright', 0, 4, null],
      [18, 'upright', 1, 4, null],
      [19, 'upright', 0, 4, 'screwdriver'],
      [20, 'upright', 1, 1, 'screwdriver'],
    ]);
    expect(drawer.map((s) => s.parts.map((id) => typeOf.get(id)))).toEqual([
      ['drawerBottom'], ['drawerSide', 'drawerSide'], [], ['drawerBack'], [], [], ['drawerFront'], [], ['knob'],
    ]);
    expect(drawer.map((s) => s.hardware.map((h) => h.type))).toEqual([
      ['dowel'], [], ['dowel'], [], ['screw'], ['dowel'], [], ['screw'], ['screw'],
    ]);
    const carcass = steps.slice(0, 11);
    expect(carcass.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(carcass[9].tip).toBe(true);
    // The runner step: upright after the tip, four screws, the screwdriver, no parts brought in; the runners show.
    const runners = carcass[10];
    expect([runners.number, runners.pose, runners.parts.length, runners.joints.length, runners.tool]).toEqual([11, 'upright', 0, 4, 'screwdriver']);
    expect(runners.hardware.map((h) => [h.type, h.count])).toEqual([['screw', 4]]);
    expect(runners.shown.filter((id) => typeOf.get(id) === 'runner')).toHaveLength(2);
    for (const step of carcass) {
      expect(step.assembly).toBeNull();
      expect(step.shown.some((id) => DRAWER.includes(typeOf.get(id)!)), `step ${step.number}`).toBe(false);
    }
    const install = steps[20];
    expect(install.number).toBe(21);
    expect(install.install!.name).toBe('drawer');
    // 6 parts (bottom, 2 sides, back, front, knob), 14 dowels and 15 screws; the runners are not the drawer's.
    expect(install.install!.members).toHaveLength(35);
    // It fastens the two slides, which are no page's hardware.
    expect(install.joints).toHaveLength(2);
    expect(install.hardware).toEqual([]);
    expect(install.shown).toHaveLength(item.assembled.parts.length);
    for (const type of DRAWER) expect(install.types).toContain(type);
  });
});
