import { describe, expect, it, vi } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { RING } from '../src/constants.js';
import { capture, createAssembly } from '../src/game/assembly.js';
import { isSeatTarget, isWorkable, ringStrengths, seatedHardware } from '../src/game/toolTargets.js';
import type { ScreenPoint } from '../src/game/dragMath.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';
import type { Captured, TargetConnector } from '../src/game/toolTargets.js';
import { RAIL_HOLE, SCREW_SLOT, SCREW_THREAD } from './support/screwParts.js';

vi.mock('../src/game/item.js', async (original) => (await import('./support/screwParts.js')).withScrews(await original()));

// The real catalog's indices: a bolt's thread into a side panel's cam-bolt hole, a cam
// lock's body into a shelf's recess.
const typeOf = (id: string) => id.replace(/-\d+$/, '');
const BOLT_THREAD = 0;
const SIDE_CAM_BOLT_HOLE = 2;
const CAM_BODY = 0;
const SHELF_RECESS = 2;

const HEX_SOCKET_INDEX = 1;
const DRIVE_SLOT_INDEX = 1;
const head = (id: string): TargetConnector => ({ type: CONNECTOR.HEX_SOCKET, part: { id }, index: HEX_SOCKET_INDEX });
const slot = (id: string): TargetConnector => ({ type: CONNECTOR.DRIVE_SLOT, part: { id }, index: DRIVE_SLOT_INDEX });
// What a key put on a hex would turn, from the graph: `assembly.turnedFrom`, as the router resolves it.
const turned = (assembly: ReturnType<typeof createAssembly>) => (hex: TargetConnector) => assembly.turnedFrom(hex.part.id, hex.index);

function build({ boltSeated = true, screwed = false, camSeated = true } = {}) {
  const assembly = createAssembly(typeOf);
  if (boltSeated) {
    const bolt = assembly.seat({ partA: 'camLockBolt-1', connectorA: BOLT_THREAD, partB: 'sidePanel-1', connectorB: SIDE_CAM_BOLT_HOLE, mover: 'camLockBolt-1' });
    if (screwed) assembly.drive(bolt.id);
  }
  const cam = camSeated
    ? assembly.seat({ partA: 'camLock-1', connectorA: CAM_BODY, partB: 'topBottomPanel-1', connectorB: SHELF_RECESS, mover: 'camLock-1' })
    : null;
  return { assembly, cam };
}

// A cam's recess at the origin catches the screwed bolt heads sitting at `at` — the same
// `capture` the router runs over the live poses.
const catching = (assembly: ReturnType<typeof createAssembly>, at: Vec3): Captured => () =>
  capture({ position: [0, 0, 0] }, assembly.screwedBolts().map(({ hardware }) => ({ id: hardware, position: at })))?.id ?? null;
const NEAR: Vec3 = [0.005, 0, 0];
const FAR: Vec3 = [0.5, 0, 0];

describe('seat targets (the loose-bolt fix)', () => {
  it("a loose bolt's head is no seat target; a seated bolt's is", () => {
    expect(isSeatTarget(head('camLockBolt-1'), seatedHardware(build({ boltSeated: false }).assembly.all()))).toBe(false);
    expect(isSeatTarget(head('camLockBolt-1'), seatedHardware(build().assembly.all()))).toBe(true);
  });

  it("a loose cam lock's slot is no seat target; a seated one's is", () => {
    expect(isSeatTarget(slot('camLock-1'), seatedHardware(build({ camSeated: false }).assembly.all()))).toBe(false);
    expect(isSeatTarget(slot('camLock-1'), seatedHardware(build().assembly.all()))).toBe(true);
  });

  it('leaves every other connector a seat target, seated or not', () => {
    const seated = seatedHardware([]);
    expect(isSeatTarget({ type: CONNECTOR.DOWEL_HOLE, part: { id: 'sidePanel-1' }, index: 0 }, seated)).toBe(true);
    expect(isSeatTarget({ type: CONNECTOR.CAM_BOLT_HOLE, part: { id: 'sidePanel-1' }, index: 0 }, seated)).toBe(true);
  });
});

describe('workable targets', () => {
  it('a seated bolt is workable, screwed home too (to loosen); a loose one is not', () => {
    const open = build().assembly;
    expect(isWorkable(head('camLockBolt-1'), { captured: catching(open, NEAR), turnedBy: turned(open) })).toBe(true);
    const screwed = build({ screwed: true }).assembly;
    expect(isWorkable(head('camLockBolt-1'), { captured: catching(screwed, NEAR), turnedBy: turned(screwed) })).toBe(true);
    const loose = build({ boltSeated: false }).assembly;
    expect(isWorkable(head('camLockBolt-1'), { captured: catching(loose, NEAR), turnedBy: turned(loose) })).toBe(false);
  });

  it('a seated cam lock is workable only with a screwed bolt in reach', () => {
    const unscrewed = build().assembly;
    expect(isWorkable(slot('camLock-1'), { captured: catching(unscrewed, NEAR), turnedBy: turned(unscrewed) })).toBe(false);
    const away = build({ screwed: true }).assembly;
    expect(isWorkable(slot('camLock-1'), { captured: catching(away, FAR), turnedBy: turned(away) })).toBe(false);
    const ready = build({ screwed: true }).assembly;
    expect(isWorkable(slot('camLock-1'), { captured: catching(ready, NEAR), turnedBy: turned(ready) })).toBe(true);
  });

  it('a locked cam lock is workable (to loosen); a loose one never is', () => {
    const { assembly, cam } = build({ screwed: true });
    assembly.drive(cam!.id, { captured: 'camLockBolt-1' });
    expect(isWorkable(slot('camLock-1'), { captured: catching(assembly, NEAR), turnedBy: turned(assembly) })).toBe(true);
    const loose = build({ screwed: true, camSeated: false }).assembly;
    expect(isWorkable(slot('camLock-1'), { captured: catching(loose, NEAR), turnedBy: turned(loose) })).toBe(false);
  });

  // 1.9.3.1: a screw's slot is the screwdriver's as a bolt's head is the key's — workable
  // while the screw is not driven home, with no bolt to catch.
  it('a seated screw\'s drive slot is workable, screwed home too (to loosen), and asks for no capture', () => {
    const assembly = createAssembly(typeOf);
    const screw = assembly.seat({ partA: 'woodScrew-1', connectorA: SCREW_THREAD, partB: 'rail-1', connectorB: RAIL_HOLE, mover: 'woodScrew-1' });
    const driveSlot: TargetConnector = { type: CONNECTOR.DRIVE_SLOT, part: { id: 'woodScrew-1' }, index: SCREW_SLOT };
    const noCapture: Captured = () => {
      throw new Error('a screw asks for no capture');
    };
    expect(isWorkable(driveSlot, { captured: noCapture, turnedBy: turned(assembly) })).toBe(true);
    assembly.drive(screw.id);
    expect(isWorkable(driveSlot, { captured: noCapture, turnedBy: turned(assembly) })).toBe(true);
  });

  // Plan amendment (Ben, 2026-10-10): fasteners light holes too, with no extra rule.
  it('lights any hole a fastener is carried to — a free compatible hole is workable', () => {
    const { assembly } = build();
    expect(isWorkable({ type: CONNECTOR.CAM_BOLT_HOLE, part: { id: 'sidePanel-1' }, index: 0 }, { captured: catching(assembly, NEAR), turnedBy: turned(assembly) })).toBe(true);
    expect(isWorkable({ type: CONNECTOR.DOWEL_HOLE, part: { id: 'sidePanel-1' }, index: 0 }, { captured: catching(assembly, NEAR), turnedBy: turned(assembly) })).toBe(true);
  });
});

describe('ring strengths', () => {
  // A flat screen: 1 m across x/z is 1000 px, y ignored — so 3D and on-screen distance part ways.
  const project = ([x, , z]: Vec3): ScreenPoint => [x * 1000, z * 1000];
  const FINGER: ScreenPoint = [0, 0];
  const TIP: Vec3 = [0, 0.05, 0];
  const strengths = (targets: { position: Vec3 }[]) => ringStrengths(targets, FINGER, project, [TIP], RING);

  it('lights a target under the finger and near the tip at full strength', () => {
    const under = { position: [0, 0, 0] as Vec3 };
    expect(strengths([under])).toEqual([{ target: under, strength: 1, offset: 0 }]);
  });

  it('leaves a target beyond the screen radius dark', () => {
    const away = { position: [(RING.screenRadius + 1) / 1000, 0, 0] as Vec3 };
    expect(strengths([away])[0].strength).toBe(0);
  });

  it('leaves a target that only looks close dark — across the room from the tool', () => {
    const behind = { position: [0, RING.maxDistance + 0.2, 0] as Vec3 };
    expect(strengths([behind])[0].strength).toBe(0);
  });

  it('ranks the nearest first at full strength, and fades the others with screen distance', () => {
    const far = { position: [0.09, 0, 0] as Vec3 };
    const near = { position: [0.03, 0, 0] as Vec3 };
    const [first, second] = strengths([far, near]);
    expect(first.target).toBe(near);
    expect(first.strength).toBe(1);
    expect(second.target).toBe(far);
    expect(second.strength).toBeCloseTo(1 - 90 / RING.screenRadius, 9);
  });

  it('gives the nearest lit target full strength even when a nearer one is out of reach', () => {
    const outOfReach = { position: [0.01, RING.maxDistance + 0.2, 0] as Vec3 };
    const lit = { position: [0.06, 0, 0] as Vec3 };
    const [first, second] = strengths([lit, outOfReach]);
    expect(first).toMatchObject({ target: outOfReach, strength: 0 });
    expect(second).toMatchObject({ target: lit, strength: 1 });
  });
});

describe('ring strengths from a part with two ends', () => {
  it('caps by whichever end is nearer — a dowel reaching a hole with its far end still lights it', () => {
    const project = ([x, , z]: Vec3): ScreenPoint => [x * 1000, z * 1000];
    const hole = { position: [0, 0, 0] as Vec3 };
    const nearEnd: Vec3 = [0, RING.maxDistance - 0.01, 0];
    const farEnd: Vec3 = [0, RING.maxDistance + 0.2, 0];
    expect(ringStrengths([hole], [0, 0], project, [farEnd], RING)[0].strength).toBe(0);
    expect(ringStrengths([hole], [0, 0], project, [farEnd, nearEnd], RING)[0].strength).toBe(1);
  });
});
