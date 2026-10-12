import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { FASTENER, GESTURE, TURN_RING } from '../src/constants.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES, setItem } from '../src/game/item.js';
import { FRAME, makePart, mount } from './support/routerBench.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The Allen key driving a double-ended stud (1.9.2 step 3): a stud seated in the top's hole,
// the key let go onto the hex at its free end — the router turns the far end's joint, the one
// in the hole, and the tool ring sits on the free hex. BLANK's real pack, the real router.

setItem('blank');

const FLIPPED: Quat = [1, 0, 0, 0];
const TOP_POSE = { position: [0, 0.025, 0] as Vec3, rotation: FLIPPED };
const STUD_HOLE = 0;
const STUD_END_IN_HOLE = 0;
// boltHead-2: the hex at the stud's free end (boltHead-1, at the end in the hole, is index 2).
const HEX_AT_FREE_END = 3;
// The top lies underside up; the first hole's mouth faces up, and the stud stands in it by its first end.
const MOUTH = connectorInWorld(PART_TYPES.top.connectors[STUD_HOLE], TOP_POSE).position;
const STUD_HALF = PART_TYPES.doubleEndedStud.size[1] / 2;
const STUD_AT: Vec3 = [MOUTH[0], MOUTH[1] + STUD_HALF, MOUTH[2]];
const HEAD: Vec3 = [MOUTH[0], MOUTH[1] + 2 * STUD_HALF, MOUTH[2]];
const TIP_DOWN: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const TIP = PART_TYPES.allenWrench.connectors[0].position;
const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;

function bench({ engaged = true } = {}) {
  const top = makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation);
  const stud = makePart('doubleEndedStud-1', 'doubleEndedStud', STUD_AT, FLIPPED);
  const tipOffset = new THREE.Vector3(...TIP).applyQuaternion(new THREE.Quaternion(...TIP_DOWN));
  const key = makePart('allenWrench-1', 'allenWrench', [HEAD[0] - tipOffset.x, HEAD[1] - tipOffset.y + 0.02, HEAD[2] - tipOffset.z], TIP_DOWN);
  const m = mount([top, stud, key]);
  const studSeat = m.assembly.seat({ partA: stud.id, connectorA: STUD_END_IN_HOLE, partB: top.id, connectorB: STUD_HOLE, mover: stud.id });
  if (engaged) {
    const at = m.screen(key.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 15 });
    m.canvas.fire('pointermove', at);
    m.canvas.fire('pointerup', at);
    m.hold(1);
    m.log.length = 0;
  }
  const progress = () => m.assembly.get(studSeat.id)!.fastener.progress;
  const toolJoint = () => m.assembly.all().find((j) => j.kind === KIND.TOOL) ?? null;
  return { ...m, top, stud, key, studSeat, progress, toolJoint };
}

describe('the key on a stud', () => {
  it('seats on the free end hex, and turns the end in the hole — not the end it sits on', () => {
    const b = bench();
    const tool = b.toolJoint()!;
    expect(tool).toMatchObject({ host: 'doubleEndedStud-1' });
    // The hex it sits in is the second end's (connector 3 is boltHead-2), the free one.
    expect(PART_TYPES.doubleEndedStud.connectors[tool.hostConnector].id).toBe('boltHead-2');
    expect(b.assembly.crankTarget('allenWrench-1')!.target).toMatchObject({ id: b.studSeat.id, hardwareConnector: STUD_END_IN_HOLE });
  });

  it('cranks the stud from circling the key, ratcheting as a bolt does, and unwinds the other way', () => {
    const b = bench();
    const span = (FASTENER.studRadians * 180) / Math.PI;
    // Pressed on the key, swept a half turn round the hex a ring's radius out.
    b.circle(b.screen(b.key.mesh.position), HEAD, 180, 0, TURN_RING.radius);
    expect(b.progress()).toBeGreaterThan(0);
    expect(b.progress()).toBeLessThanOrEqual(180 / span + 1e-9);
    expect(b.clicks()).toBeGreaterThan(0);
    expect(b.assembly.get(b.studSeat.id)!.fastener.state).toBe(STATE.SEATED);
    // The other way unwinds it.
    const turned = b.progress();
    b.circle(b.screen(b.key.mesh.position), HEAD, -90, 0, TURN_RING.radius);
    expect(b.progress()).toBeLessThan(turned);
  });

  it('drives home on a still hold in driveSeconds, then reports the one FASTEN', () => {
    const b = bench();
    const at = b.screen(b.key.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.hold(TAP_FRAMES + DRIVE_FRAMES);
    expect(b.assembly.get(b.studSeat.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    expect(b.fastens()).toHaveLength(1);
    b.canvas.fire('pointerup', at);
    expect(b.toolJoint()).not.toBeNull();
  });

  it("draws the turn ring on the stud's hex, filling with the stud's own progress", () => {
    const b = bench();
    b.hold(1);
    expect(b.dials.at(-1)).toMatchObject([{ progress: 0, flashing: false, stalled: false }]);
    b.assembly.apply(b.studSeat.id, { type: 'crank', radians: FASTENER.studRadians / 2 });
    b.hold(1);
    expect(b.dials.at(-1)![0].progress).toBeCloseTo(0.5, 9);
    expect(TURN_RING.radius).toBeGreaterThan(0);
  });

  it('sinks the stud as it turns: drawn deeper into the top the further it is turned', () => {
    const b = bench();
    const before = b.stud.mesh.position.y;
    b.assembly.apply(b.studSeat.id, { type: 'crank', radians: FASTENER.studRadians / 2 });
    b.hold(1);
    expect(b.stud.mesh.position.y).toBeCloseTo(before - FASTENER.sinkDepth.stud! / 2, 9);
  });
});

describe('the buried hex (review)', () => {
  it('takes no key: let go over the hex at the end sunk in the top, it seats nowhere', () => {
    const b = bench({ engaged: false });
    // The key's tip down at the mouth, where the first end — and its hex — sit in the hole.
    const tipOffset = new THREE.Vector3(...TIP).applyQuaternion(new THREE.Quaternion(...TIP_DOWN));
    b.key.mesh.position.set(MOUTH[0] - tipOffset.x, MOUTH[1] - tipOffset.y + 0.02, MOUTH[2] - tipOffset.z);
    b.key.mesh.quaternion.set(...TIP_DOWN);
    b.key.mesh.updateMatrixWorld(true);
    const body = b.key.body as unknown as { pose: { position: THREE.Vector3; quaternion: THREE.Quaternion } };
    body.pose.position.copy(b.key.mesh.position);
    body.pose.quaternion.copy(b.key.mesh.quaternion);
    const at = b.screen(b.key.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 15 });
    b.canvas.fire('pointermove', at);
    b.canvas.fire('pointerup', at);
    b.hold(1);
    // Near the free end's hex too, it may seat there; never in the one sunk in the top.
    expect(b.toolJoint()?.hostConnector ?? HEX_AT_FREE_END).toBe(HEX_AT_FREE_END);
  });
});

