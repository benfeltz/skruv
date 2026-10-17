import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AIM } from '../src/constants.js';
import { spanOf, STATE } from '../src/game/fasteners.js';
import { PART_TYPES } from '../src/game/item.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { insetRecorder, makePart, mount } from './support/routerBench.js';
import type { Part } from '../src/game/partMesh.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// What the gesture router tells the detail inset (1.10.0.1 step 7), through the real router over
// JOHNNY's real parts: a side panel lying flat, holes up, with a dowel to carry to one hole, a cam
// bolt standing in another and an Allen key to put on it. The router's taps are the inset's too:
// the two rules are tested here, the model's own transitions in test/insetModel.test.ts.

const HALF_TURN_Z: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // the panel's local +x (its hole faces) up
const PANEL_POSE = { position: [0, 0.008, 0] as Vec3, rotation: HALF_TURN_Z };
const DOWEL_HOLE = 3;
const BOLT_HOLE = 6;
const mouth = (index: number) => connectorInWorld(PART_TYPES.sidePanel.connectors[index], PANEL_POSE).position;
const DOWEL_HALF = PART_TYPES.dowel.size[1] / 2;
const BOLT_HALF = PART_TYPES.camLockBolt.size[1] / 2;
const HEAD: Vec3 = [mouth(BOLT_HOLE)[0], mouth(BOLT_HOLE)[1] + 2 * BOLT_HALF, mouth(BOLT_HOLE)[2]];
// The Allen key's short leg (its tip axis, local +z) pointing straight down.
const TIP_DOWN: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const TIP = PART_TYPES.allenWrench.connectors[0].position;
const above = ([x, y, z]: Vec3, by: number): Vec3 => [x, y + by, z];

interface Options {
  dowelAt?: Vec3;
  boltSeated?: boolean;
}

function bench({ dowelAt, boltSeated = true }: Options = {}) {
  const panel = makePart('sidePanel-1', 'sidePanel', PANEL_POSE.position, PANEL_POSE.rotation);
  const dowel = makePart('dowel-1', 'dowel', dowelAt ?? above(mouth(DOWEL_HOLE), DOWEL_HALF + 0.05));
  const bolt = makePart('camLockBolt-1', 'camLockBolt', above(mouth(BOLT_HOLE), BOLT_HALF));
  // Tip down, its tip a little above the head.
  const tipOffset = new THREE.Vector3(...TIP).applyQuaternion(new THREE.Quaternion(...TIP_DOWN));
  const key = makePart('allenWrench-1', 'allenWrench', [HEAD[0] - tipOffset.x, HEAD[1] - tipOffset.y + 0.02, HEAD[2] - tipOffset.z], TIP_DOWN);
  const recorder = insetRecorder();
  const m = mount([panel, dowel, bolt, key], undefined, recorder);
  if (boltSeated) m.assembly.seat({ partA: bolt.id, connectorA: 0, partB: panel.id, connectorB: BOLT_HOLE, mover: bolt.id });
  // Pressed on a part, nudged past the tap distance and still held; one frame so the router reports.
  function carry(part: Part) {
    const at = m.screen(part.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 7 });
    m.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 15 });
    m.hold(1);
    return { clientX: at.clientX, clientY: at.clientY + 15 };
  }
  const last = () => recorder.frames.at(-1)!;
  return { ...m, panel, dowel, bolt, key, recorder, carry, last };
}

describe('the router reports what the inset could frame', () => {
  it('offers the seat a carried dowel nears inside the aim zone, framed along the hole’s way in', () => {
    const b = bench();
    b.carry(b.dowel);
    const { offered, engaged } = b.last();
    expect(engaged).toEqual([]);
    expect(offered).toMatchObject({ joint: -1, kind: 'dowel', hardware: 'dowel-1', host: 'sidePanel-1', tool: null });
    expect(offered!.centre.every((v, i) => Math.abs(v - mouth(DOWEL_HOLE)[i]) < 1e-6)).toBe(true);
    // Into the hole: down, the panel's holes facing up.
    expect(offered!.axis[1]).toBeCloseTo(-1);
  });

  it('offers nothing to a dowel carried outside the zone', () => {
    const b = bench({ dowelAt: [0.3, 0.4, 0.5] });
    b.carry(b.dowel);
    expect(Math.hypot(...b.dowel.mesh.position.toArray().map((v, i) => v - mouth(DOWEL_HOLE)[i]))).toBeGreaterThan(AIM.zone);
    expect(b.last().offered).toBeNull();
  });

  it('offers nothing while nothing is carried', () => {
    const b = bench();
    b.hold(2);
    expect(b.last().offered).toBeNull();
  });

  it('reports a dowel seated and not yet pushed home as engaged, and as settled (pressed) once pressed home', () => {
    const b = bench();
    const at = b.carry(b.dowel);
    b.canvas.fire('pointerup', at);
    b.hold(1);
    const joint = b.assembly.all().find((j) => j.hardware === 'dowel-1')!;
    expect(joint.fastener.state).toBe(STATE.SEATED);
    expect(b.last().engaged).toMatchObject([{ joint: joint.id, kind: 'dowel', hardware: 'dowel-1', host: 'sidePanel-1', tool: null }]);
    b.tap(b.screen(b.dowel.mesh.position));
    b.hold(1);
    expect(b.assembly.get(joint.id)!.fastener.state).not.toBe(STATE.SEATED);
    expect(b.last().engaged).toEqual([]);
    expect(b.last().settled(joint.id)).toMatchObject({ joint: joint.id, kind: 'dowel', pressed: true, progress: 1, tighten: false, loosen: false });
  });

  it('offers a seated bolt’s head to a carried Allen key, then reports the joint with the tool set once it is on', () => {
    const b = bench();
    const at = b.carry(b.key);
    expect(b.last().offered).toMatchObject({ joint: -1, kind: 'tool', hardware: 'allenWrench-1', host: 'camLockBolt-1', tool: 'allenWrench-1' });
    expect(b.last().offered!.centre.every((v, i) => Math.abs(v - HEAD[i]) < 0.02)).toBe(true);
    b.canvas.fire('pointerup', at);
    b.hold(1);
    const joint = b.assembly.all().find((j) => j.hardware === 'allenWrench-1')!;
    expect(b.last().offered).toBeNull();
    expect(b.last().engaged).toMatchObject([{ joint: joint.id, kind: 'tool', hardware: 'allenWrench-1', host: 'camLockBolt-1', tool: 'allenWrench-1' }]);
  });

  it('frames the head where this frame drew it, sinking with the turn, not where the simulation holds it', () => {
    const b = bench();
    const at = b.carry(b.key);
    b.canvas.fire('pointerup', at);
    b.hold(1);
    const before = b.last().engaged[0].centre[1];
    const bolt = b.assembly.all().find((j) => j.kind === 'bolt')!;
    b.assembly.apply(bolt.id, { type: 'crank', radians: 0.5 * spanOf(bolt.kind) });
    b.hold(1);
    // The body has not moved; the drawn bolt has, and the inset's centre is the drawn head's.
    const drawn = b.bolt.mesh.position.y - b.bolt.body.translation().y;
    expect(drawn).toBeLessThan(-1e-4);
    expect(before - b.last().engaged[0].centre[1]).toBeCloseTo(-drawn, 6);
  });

  it('offers a loose bolt’s head to no key', () => {
    const b = bench({ boltSeated: false });
    b.carry(b.key);
    expect(b.last().offered).toBeNull();
  });
});

describe('the router’s taps are the inset’s', () => {
  // The key on the bolt, as a release over the head leaves it.
  function keyed() {
    const b = bench();
    const at = b.carry(b.key);
    b.canvas.fire('pointerup', at);
    b.hold(1);
    expect(b.assembly.all().filter((j) => j.hardware === 'allenWrench-1')).toHaveLength(1);
    return b;
  }
  const keyJoints = (b: ReturnType<typeof keyed>) => b.assembly.all().filter((j) => j.hardware === 'allenWrench-1');

  it('tells the inset of a tap on empty space, which carries on and deselects as ever', () => {
    const b = keyed();
    b.tap({ clientX: 10, clientY: 10 });
    expect(b.recorder.outside).toEqual([[10, 10]]);
    expect(b.taps.at(-1)).toBeNull();
  });

  it('tells the inset of a tap on a part, which carries on when the inset does not take it', () => {
    const b = keyed();
    b.recorder.consume = false;
    b.tap(b.screen(b.key.mesh.position));
    expect(b.recorder.tapsOn).toEqual(['allenWrench-1']);
    expect(b.recorder.outside).toHaveLength(1);
    expect(keyJoints(b)).toHaveLength(0);
  });

  it('lets a tap the inset takes go no further: the key stays on, nothing else happens', () => {
    const b = keyed();
    b.recorder.consume = true;
    const taps = b.taps.length;
    b.tap(b.screen(b.key.mesh.position));
    expect(b.recorder.tapsOn).toEqual(['allenWrench-1']);
    expect(keyJoints(b)).toHaveLength(1);
    expect(b.taps).toHaveLength(taps);
    // A reopening is not a dismissal either.
    expect(b.recorder.outside).toEqual([]);
  });

  it('swallows a tap on the circle: the part behind it is untouched and the inset is not asked again', () => {
    const b = keyed();
    const at = b.screen(b.key.mesh.position);
    b.recorder.circle = { centre: [at.clientX, at.clientY], radius: 40 };
    b.tap(at);
    expect(keyJoints(b)).toHaveLength(1);
    expect(b.recorder.tapsOn).toEqual([]);
    expect(b.recorder.outside).toEqual([]);
    expect(b.taps.at(-1)).not.toBeNull();
  });

  it('ignores a press on the circle: it grabs no part behind it and is kept from the camera', () => {
    const b = keyed();
    const at = b.screen(b.key.mesh.position);
    b.recorder.circle = { centre: [at.clientX, at.clientY], radius: 40 };
    let stopped = 0;
    b.canvas.fire('pointerdown', { ...at, stopImmediatePropagation: () => stopped++ });
    b.canvas.fire('pointermove', { clientX: at.clientX + 40, clientY: at.clientY + 40 });
    expect(b.router.dragging).toBeNull();
    expect(stopped).toBe(1);
    b.canvas.fire('pointerup', at);
    expect(keyJoints(b)).toHaveLength(1);
  });

  // 1.10.0.2: the ring lives beside the inset, so the main view draws no dial for a tool's turn
  // and nothing is on screen where it was.
  it('draws no dial for the seated key in the main view', () => {
    const b = keyed();
    b.hold(2);
    expect(b.dials.every((d) => d === null)).toBe(true);
  });

  it('lets a consumed tap on a seated dowel leave it unpressed', () => {
    const b = bench();
    const at = b.carry(b.dowel);
    b.canvas.fire('pointerup', at);
    b.hold(1);
    b.recorder.consume = true;
    b.tap(b.screen(b.dowel.mesh.position));
    expect(b.assembly.all().find((j) => j.hardware === 'dowel-1')!.fastener.state).toBe(STATE.SEATED);
  });

  it('runs as it always did with no inset hook at all', () => {
    const panel = makePart('sidePanel-1', 'sidePanel', PANEL_POSE.position, PANEL_POSE.rotation);
    const dowel = makePart('dowel-1', 'dowel', above(mouth(DOWEL_HOLE), DOWEL_HALF));
    const m = mount([panel, dowel]);
    m.assembly.seat({ partA: dowel.id, connectorA: 0, partB: panel.id, connectorB: DOWEL_HOLE, mover: dowel.id });
    m.hold(1);
    m.tap(m.screen(dowel.mesh.position));
    expect(m.assembly.all()[0].fastener.state).not.toBe(STATE.SEATED);
  });
});

describe('the router works the inset’s controls (1.10.0.2)', () => {
  const SPAN = spanOf('bolt');
  const boltJoint = (b: ReturnType<typeof bench>) => b.assembly.all().find((j) => j.kind === 'bolt')!;
  const keyJoint = (b: ReturnType<typeof bench>) => b.assembly.all().find((j) => j.hardware === 'allenWrench-1');
  const unseats = (b: ReturnType<typeof bench>) => b.log.filter((e) => e.type === 'unseat');
  // The key let go over the head.
  function keyOn(b: ReturnType<typeof bench>) {
    b.canvas.fire('pointerup', b.carry(b.key));
    b.hold(1);
    expect(keyJoint(b)).toBeDefined();
  }

  it('reports the key on a fresh bolt with its tighten head only, at depth zero', () => {
    const b = bench();
    keyOn(b);
    expect(b.last().engaged[0]).toMatchObject({ tool: 'allenWrench-1', progress: 0, tighten: true, loosen: false, pressed: false });
  });

  it('a turn of the ring to home drops the key: its joint goes, it is released and UNSEAT is emitted; the inset then has no subject', () => {
    const b = bench();
    keyOn(b);
    expect(b.router.turnGrip('allenWrench-1', SPAN)).toBe(true);
    expect(boltJoint(b).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    expect(keyJoint(b)).toBeUndefined();
    expect(unseats(b)).toHaveLength(1);
    b.hold(1);
    expect(b.last().engaged).toEqual([]);
  });

  it('does not drop the key short of home, and drops it only on the edge', () => {
    const b = bench();
    keyOn(b);
    b.router.turnGrip('allenWrench-1', SPAN / 2);
    expect(keyJoint(b)).toBeDefined();
    expect(b.last().engaged[0]).toBeDefined();
    b.hold(1);
    expect(b.last().engaged[0]).toMatchObject({ progress: 0.5, tighten: true, loosen: true });
  });

  it('a key set on a home bolt stays on, with its loosen head only', () => {
    const b = bench();
    b.assembly.drive(boltJoint(b).id);
    keyOn(b);
    expect(unseats(b)).toEqual([]);
    expect(b.last().engaged[0]).toMatchObject({ progress: 1, tighten: false, loosen: true });
  });

  it('loosening all the way out drops the bolt and the key both', () => {
    const b = bench();
    b.assembly.drive(boltJoint(b).id);
    keyOn(b);
    expect(b.router.turnGrip('allenWrench-1', -SPAN)).toBe(true);
    expect(keyJoint(b)).toBeUndefined();
    expect(b.assembly.all().filter((j) => j.kind === 'bolt')).toEqual([]);
    expect(unseats(b)).toHaveLength(2);
  });

  it('turnGrip on a part with no turn changes nothing', () => {
    const b = bench();
    expect(b.router.turnGrip('allenWrench-1', 1)).toBe(false);
    expect(b.router.turnGrip('dowel-1', 1)).toBe(false);
    expect(unseats(b)).toEqual([]);
  });

  it('a tap on a seated key short of home still takes it off, as ever', () => {
    const b = bench();
    keyOn(b);
    b.router.turnGrip('allenWrench-1', SPAN / 4);
    b.tap(b.screen(b.key.mesh.position));
    expect(keyJoint(b)).toBeUndefined();
    expect(boltJoint(b).fastener.progress).toBeGreaterThan(0);
  });

  it('the push arrow presses a seated dowel home (settled, pressed), and its second tap backs it out to seated (engaged)', () => {
    const b = bench();
    b.canvas.fire('pointerup', b.carry(b.dowel));
    b.hold(1);
    const id = b.assembly.all().find((j) => j.hardware === 'dowel-1')!.id;
    expect(b.router.pressJoint(id)).toBe(true);
    b.hold(1);
    expect(b.last().engaged).toEqual([]);
    expect(b.last().settled(id)).toMatchObject({ joint: id, pressed: true });
    expect(b.router.pressJoint(id)).toBe(false);
    expect(b.router.pullJoint(id)).toBe(true);
    b.hold(1);
    expect(b.last().settled(id)).toBeNull();
    expect(b.last().engaged).toMatchObject([{ joint: id, pressed: false }]);
    expect(b.router.pullJoint(id)).toBe(false);
  });

  it('pressJoint and pullJoint leave a tool joint alone', () => {
    const b = bench();
    keyOn(b);
    expect(b.router.pressJoint(keyJoint(b)!.id)).toBe(false);
    expect(b.router.pullJoint(keyJoint(b)!.id)).toBe(false);
  });

  // Review round 1.
  // Plan decision 10 (Ben): the drop on removal is from fastened back to seated at nothing. A bolt only ever
  // turned partway and back is not that edge, so it and the key stay put.
  it('keeps the bolt and the key when a bolt never screwed home is turned back to nothing', () => {
    const b = bench();
    keyOn(b);
    b.router.turnGrip('allenWrench-1', SPAN / 2);
    expect(b.router.turnGrip('allenWrench-1', -SPAN / 2)).toBe(true);
    expect(boltJoint(b).fastener).toMatchObject({ state: STATE.SEATED, progress: 0 });
    expect(keyJoint(b)).toBeDefined();
    expect(unseats(b)).toEqual([]);
  });

  it('refuses a pull the assembly says is bound (a locked cam across the seam), as a pull in the main view does', () => {
    const b = bench();
    b.canvas.fire('pointerup', b.carry(b.dowel));
    b.hold(1);
    const id = b.assembly.all().find((j) => j.hardware === 'dowel-1')!.id;
    b.router.pressJoint(id);
    vi.spyOn(b.assembly, 'pullable').mockReturnValue([]);
    expect(b.router.pullJoint(id)).toBe(false);
    expect(b.assembly.get(id)!.fastener.state).toBe(STATE.PRESSED);
  });

  it('prunes a seat whose parts have drifted apart before pressing it', () => {
    const b = bench();
    b.canvas.fire('pointerup', b.carry(b.dowel));
    b.hold(1);
    const id = b.assembly.all().find((j) => j.hardware === 'dowel-1')!.id;
    // The simulation's pose is what a seat is judged on (a fake body, as makePart builds it).
    (b.dowel.body as unknown as { pose: { position: THREE.Vector3 } }).pose.position.set(1, 1, 1);
    expect(b.router.pressJoint(id)).toBe(false);
    expect(b.assembly.get(id)).toBeNull();
  });

  // Ben's phone test: picking a tool up and having it deselect. Pressing the key after it dropped at home, and
  // carrying it on, stays a move — through the offer of the next seat, never a crank, a take-off or a tap.
  it('picks the key up again after it dropped at home and keeps carrying it, the inset offering as it nears', () => {
    const b = bench();
    keyOn(b);
    b.router.turnGrip('allenWrench-1', SPAN);
    b.hold(2);
    expect(keyJoint(b)).toBeUndefined();
    const at = b.screen(b.key.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.canvas.fire('pointermove', { clientX: at.clientX + 12, clientY: at.clientY });
    b.canvas.fire('pointermove', { clientX: at.clientX + 40, clientY: at.clientY - 30 });
    b.hold(1);
    expect(b.router.dragging).toMatchObject({ part: { id: 'allenWrench-1' }, mode: 'move' });
    b.canvas.fire('pointermove', { clientX: at.clientX + 80, clientY: at.clientY - 60 });
    b.hold(1);
    expect(b.router.dragging).toMatchObject({ part: { id: 'allenWrench-1' }, mode: 'move' });
    expect(b.taps).toEqual([]);
    expect(unseats(b)).toHaveLength(1);
  });

  it('keeps carrying a key when the circle appears under the finger mid-drag', () => {
    const b = bench();
    const at = b.carry(b.key);
    b.recorder.circle = { centre: [at.clientX, at.clientY], radius: 80 };
    b.canvas.fire('pointermove', { clientX: at.clientX + 30, clientY: at.clientY });
    b.hold(1);
    expect(b.router.dragging).toMatchObject({ part: { id: 'allenWrench-1' }, mode: 'move' });
    b.canvas.fire('pointerup', { clientX: at.clientX + 30, clientY: at.clientY });
    expect(b.taps).toEqual([]);
  });
});
