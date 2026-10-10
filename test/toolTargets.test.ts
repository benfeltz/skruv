import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { capture, createAssembly } from '../src/game/assembly.js';
import { isSeatTarget, isWorkable, seatedHardware } from '../src/game/toolTargets.js';
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

  it('only bolt heads and cam slots are ever workable', () => {
    const { assembly } = build();
    expect(isWorkable({ type: CONNECTOR.CAM_BOLT_HOLE, part: { id: 'sidePanel-1' } }, assembly.all(), catching(assembly, NEAR))).toBe(false);
  });
});
