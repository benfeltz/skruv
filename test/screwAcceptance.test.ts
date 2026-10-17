import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { checkPack } from '../tools/validate/lib/checks.js';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER, GESTURE, TURN_RING } from '../src/constants.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES } from '../src/game/item.js';
import { FRAME, makePart, mount } from './support/routerBench.js';
import { RAIL_HOLE, SCREW_SLOT, SCREW_THREAD } from './support/screwParts.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

vi.mock('../src/game/item.js', async (original) => (await import('./support/screwParts.js')).withScrews(await original()));

// 1.9.3.1 acceptance, against the plan's three criteria: the names fixed before 1.0.0 with
// both shipped packs still whole; a wood screw driven home by the screwdriver in two turns,
// by circle or by hold, through the real router; and, once screwed, its host and the part
// behind bonded rigidly, let go when backed off or when that part is taken away.
//
// No shipped pack carries a screw yet (that is 1.9.3.2): the rail and screw are
// test/support/screwParts.ts's, laid over JOHNNY, on the router bench.

const ORIGIN: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;
const pack = (item: string): FlatpackFile => JSON.parse(readFileSync(new URL(`../items/${item}/flatpack.json`, import.meta.url), 'utf8'));

describe('AC1: hexSocket and driveSlot are the head names, boltRadians the bolt span; JOHNNY and BLANK stay whole', () => {
  it.each(['johnny', 'blank'])('%s validates with zero errors and names its tool heads by the new names only', (item) => {
    const file = pack(item);
    expect(checkPack(file)).toEqual([]);
    const types = Object.values(file.parts).flatMap((part) => part.connectors.map((c) => c.type as string));
    expect(types.some((t) => t === CONNECTOR.HEX_SOCKET || t === CONNECTOR.DRIVE_SLOT)).toBe(true);
    const raw = readFileSync(new URL(`../items/${item}/flatpack.json`, import.meta.url), 'utf8');
    expect(raw).not.toMatch(/boltHead|camSlot/);
  });

  it('keeps two full turns for a bolt under its new name, and gives the screw its own', () => {
    expect(FASTENER.boltRadians).toBeCloseTo(4 * Math.PI, 9);
    expect(FASTENER.screwRadians).toBeCloseTo(4 * Math.PI, 9);
    expect(Object.values(CONNECTOR)).not.toContain('boltHead');
    expect(Object.values(CONNECTOR)).not.toContain('camSlot');
  });
});

// JOHNNY's side panel lying flat (top face at y 0.016), a rail on it, a screw standing in the
// rail's hole, the screwdriver seated in its slot; the camera looks down.
function bench() {
  const panelPose = { position: [0, 0.008, 0] as Vec3, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as Quat };
  const railAt: Vec3 = [0, 0.016 + PART_TYPES.rail.size[1] / 2, 0];
  const hole = connectorInWorld(PART_TYPES.rail.connectors[RAIL_HOLE], { position: railAt, rotation: [0, 0, 0, 1] }).position;
  const screwHalf = PART_TYPES.woodScrew.size[1] / 2;
  const head: Vec3 = [hole[0], hole[1] + 2 * screwHalf, hole[2]];
  const driver = makePart('screwdriver-1', 'screwdriver', [head[0] + 0.03, head[1] + 0.05, head[2]]);
  const m = mount([
    makePart('sidePanel-1', 'sidePanel', panelPose.position, panelPose.rotation),
    makePart('rail-1', 'rail', railAt),
    makePart('woodScrew-1', 'woodScrew', [hole[0], hole[1] + screwHalf, hole[2]]),
    driver,
  ]);
  const screw = m.assembly.seat({ partA: 'woodScrew-1', connectorA: SCREW_THREAD, partB: 'rail-1', connectorB: RAIL_HOLE, mover: 'woodScrew-1' });
  m.assembly.seat({ partA: 'screwdriver-1', connectorA: 0, partB: 'woodScrew-1', connectorB: SCREW_SLOT, mover: 'screwdriver-1' });
  const state = () => m.assembly.get(screw.id)!;
  // Circle the screwdriver round the screw head `degrees` (clockwise positive, on screen): pressed on the driver.
  const circle = (degrees: number) => m.circle(m.screen(driver.mesh.position), head, degrees, 0, TURN_RING.radius);
  const holdDriver = () => {
    const at = m.screen(driver.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.hold(TAP_FRAMES + DRIVE_FRAMES);
    m.canvas.fire('pointerup', at);
  };
  const bridges = () => m.assembly.bonds(() => ORIGIN).filter((b) => b.key.startsWith('bridge:'));
  return { ...m, screw, state, circle, holdDriver, bridges };
}

describe('AC2: a screw seated in a screw hole is driven home by the screwdriver in two turns, by circle or hold', () => {
  it('is a screw joint, and the screwdriver on it draws no dial in the main view', () => {
    const b = bench();
    expect(b.screw.kind).toBe(KIND.SCREW);
    b.hold(1);
    expect(b.dials.every((d) => d === null)).toBe(true);
  });

  it('is partway after one turn of the circle and home after two, reported once', () => {
    const b = bench();
    b.circle(360);
    expect(b.state().fastener).toMatchObject({ state: STATE.SEATED });
    expect(b.state().fastener.progress).toBeGreaterThan(0.3);
    expect(b.state().fastener.progress).toBeLessThan(0.7);
    b.circle(400);
    expect(b.state()).toMatchObject({ through: 'sidePanel-1', fastener: { state: STATE.SCREWED, progress: 1 } });
    expect(b.fastens().filter((e) => e.kind === KIND.SCREW)).toHaveLength(1);
    // Home: the screwdriver came off by itself.
    expect(b.assembly.all().some((j) => j.kind === KIND.TOOL)).toBe(false);
  });

  it('drives home on a still hold of the screwdriver', () => {
    const b = bench();
    b.holdDriver();
    expect(b.state()).toMatchObject({ through: 'sidePanel-1', fastener: { state: STATE.SCREWED, progress: 1 } });
    expect(b.fastens()).toHaveLength(1);
  });
});

describe('AC3: screwed, it bonds its host and the part behind rigidly; backed off or that part taken away, it lets go', () => {
  it('bridges the rail and the side panel rigidly once home, and not before', () => {
    const b = bench();
    expect(b.bridges()).toEqual([]);
    b.holdDriver();
    expect(b.bridges()).toMatchObject([{ a: 'rail-1', b: 'sidePanel-1', mode: 'rigid' }]);
    expect(b.assembly.compoundOf('rail-1').has('sidePanel-1')).toBe(true);
  });

  it('drops the bond, the screw and the driver when circled all the way out', () => {
    const b = bench();
    b.holdDriver();
    // The driver dropped at home: set it back on the screw's slot to back the screw out.
    b.assembly.seat({ partA: 'screwdriver-1', connectorA: 0, partB: 'woodScrew-1', connectorB: SCREW_SLOT, mover: 'screwdriver-1' });
    b.circle(-800);
    // Backed all the way out, the screw and the driver both drop: the joint is gone and the bond with it.
    expect(b.assembly.get(b.screw.id)).toBeNull();
    expect(b.assembly.all().some((j) => j.kind === KIND.TOOL)).toBe(false);
    expect(b.bridges()).toEqual([]);
  });

  it('unscrews to seated when the part behind is taken away', () => {
    const b = bench();
    b.holdDriver();
    expect(b.assembly.letGoOf(['sidePanel-1'])).toEqual([b.screw.id]);
    expect(b.state()).toMatchObject({ through: null, fastener: { state: STATE.SEATED } });
    expect(b.assembly.compoundOf('rail-1').has('sidePanel-1')).toBe(false);
  });
});
