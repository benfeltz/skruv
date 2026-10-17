import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
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

  it('reports a dowel seated and not yet pushed home as engaged, and drops it once pressed home', () => {
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

  it('a tap on a turn ring dismisses nothing and reopens nothing', () => {
    const b = keyed();
    b.hold(1);
    const dial = b.dials.at(-1)![0];
    // On the ring's band, away from the key itself.
    const on = { clientX: dial.centre[0], clientY: dial.centre[1] + 64 };
    b.tap(on);
    expect(b.recorder.outside).toEqual([]);
    expect(b.recorder.tapsOn).toEqual([]);
    expect(keyJoints(b)).toHaveLength(1);
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
