import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { RING } from '../src/constants.js';
import { capture, createAssembly } from '../src/game/assembly.js';
import { isSeatTarget, isWorkable, ringStrengths, seatedHardware } from '../src/game/toolTargets.js';
import type { ScreenPoint } from '../src/game/dragMath.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';
import type { Captured, TargetConnector } from '../src/game/toolTargets.js';

// The real catalog's indices: a bolt's thread into a side panel's cam-bolt hole, a cam
// lock's body into a shelf's recess.
const typeOf = (id: string) => id.replace(/-\d+$/, '');
const BOLT_THREAD = 0;
const SIDE_CAM_BOLT_HOLE = 2;
const CAM_BODY = 0;
const SHELF_RECESS = 2;

const head = (id: string): TargetConnector => ({ type: CONNECTOR.BOLT_HEAD, part: { id } });
const slot = (id: string): TargetConnector => ({ type: CONNECTOR.CAM_SLOT, part: { id } });

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
    expect(isSeatTarget({ type: CONNECTOR.DOWEL_HOLE, part: { id: 'sidePanel-1' } }, seated)).toBe(true);
    expect(isSeatTarget({ type: CONNECTOR.CAM_BOLT_HOLE, part: { id: 'sidePanel-1' } }, seated)).toBe(true);
  });
});

describe('workable targets', () => {
  it('a seated, unscrewed bolt is workable; a screwed one is not; a loose one is not', () => {
    const open = build().assembly;
    expect(isWorkable(head('camLockBolt-1'), open.all(), catching(open, NEAR))).toBe(true);
    const screwed = build({ screwed: true }).assembly;
    expect(isWorkable(head('camLockBolt-1'), screwed.all(), catching(screwed, NEAR))).toBe(false);
    const loose = build({ boltSeated: false }).assembly;
    expect(isWorkable(head('camLockBolt-1'), loose.all(), catching(loose, NEAR))).toBe(false);
  });

  it('a seated cam lock is workable only with a screwed bolt in reach', () => {
    const unscrewed = build().assembly;
    expect(isWorkable(slot('camLock-1'), unscrewed.all(), catching(unscrewed, NEAR))).toBe(false);
    const away = build({ screwed: true }).assembly;
    expect(isWorkable(slot('camLock-1'), away.all(), catching(away, FAR))).toBe(false);
    const ready = build({ screwed: true }).assembly;
    expect(isWorkable(slot('camLock-1'), ready.all(), catching(ready, NEAR))).toBe(true);
  });

  it('a locked cam lock is not workable; a loose one never is', () => {
    const { assembly, cam } = build({ screwed: true });
    assembly.drive(cam!.id, { captured: 'camLockBolt-1' });
    expect(isWorkable(slot('camLock-1'), assembly.all(), catching(assembly, NEAR))).toBe(false);
    const loose = build({ screwed: true, camSeated: false }).assembly;
    expect(isWorkable(slot('camLock-1'), loose.all(), catching(loose, NEAR))).toBe(false);
  });

  // Plan amendment (Ben, 2026-10-10): fasteners light holes too, with no extra rule.
  it('lights any hole a fastener is carried to — a free compatible hole is workable', () => {
    const { assembly } = build();
    expect(isWorkable({ type: CONNECTOR.CAM_BOLT_HOLE, part: { id: 'sidePanel-1' } }, assembly.all(), catching(assembly, NEAR))).toBe(true);
    expect(isWorkable({ type: CONNECTOR.DOWEL_HOLE, part: { id: 'sidePanel-1' } }, assembly.all(), catching(assembly, NEAR))).toBe(true);
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
