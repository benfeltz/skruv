import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { FASTENER, GESTURE, TURN_RING } from '../src/constants.js';
import { tightenSign } from '../src/game/crankMath.js';
import { EVENT } from '../src/game/events.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES, setItem } from '../src/game/item.js';
import { FRAME, makePart, mount } from './support/routerBench.js';
import type { AssemblyJoint } from '../src/game/assembly.js';
import type { Part } from '../src/game/partMesh.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The turn record through the real router (1.9.2, review round 5): the six cases of
// test/turnOf.test.ts — a leg on a standing stud; a leg home on a loose stud, carried on; a
// top on four studs; a stud half in with a leg home on it; a key on a hand-seated stud; JOHNNY
// — each through crank, drive, draw, dial, press, tap, carry and hold. BLANK's real pack on
// fake parts and a fake canvas (test/support/routerBench.ts), the camera looking down.
//
// The top lies underside up, its holes' mouths facing the camera; studs and legs stand on it
// upside down, as the booklet builds the table.

const FLIPPED: Quat = [1, 0, 0, 0];
const TOP_POSE = { position: [0, 0.025, 0] as Vec3, rotation: FLIPPED };
const SINK = () => FASTENER.sinkDepth.stud!;
const STUD_HALF = () => PART_TYPES.doubleEndedStud.size[1] / 2;
const LEG_HALF = () => PART_TYPES.leg.size[1] / 2;
const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;
const FLASH_FRAMES = Math.ceil(TURN_RING.flashMs / 1000 / FRAME) + 2;
const HEX_AT_END_1 = 2;
const HEX_AT_END_2 = 3;

beforeAll(() => setItem('blank'));
afterAll(() => setItem('johnny'));

// Top hole `i`'s mouth, the top as it lies.
const mouth = (i: number) => connectorInWorld(PART_TYPES.top.connectors[i], TOP_POSE).position;
// A stud standing in top hole `i` sunk `sunk` of the way home, its first end down the hole.
const studAt = (i: number, sunk: number): Vec3 => {
  const [x, y, z] = mouth(i);
  return [x, y + STUD_HALF() - sunk * SINK(), z];
};
// A leg upside down on that stud's upper end, its hole sunk `on` of the way onto the stud.
const legAt = (i: number, sunk: number, on: number): Vec3 => {
  const [x, y, z] = studAt(i, sunk);
  return [x, y + STUD_HALF() - on * SINK() + LEG_HALF(), z];
};

// The table's parts on the bench: the top, `n` studs in holes 0..n-1, `n` legs on them.
function table({ studs = 1, sunk = 1, on = 0, camera = [0, 1.2, 0.8] as Vec3 }: { studs?: number; sunk?: number; on?: number; camera?: Vec3 } = {}) {
  const legs = studs;
  const top = makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation);
  const studParts = Array.from({ length: studs }, (_, i) => makePart(`doubleEndedStud-${i + 1}`, 'doubleEndedStud', studAt(i, sunk), FLIPPED));
  const legParts = Array.from({ length: legs }, (_, i) => makePart(`leg-${i + 1}`, 'leg', legAt(i, sunk, on), FLIPPED));
  const m = mount([top, ...studParts, ...legParts], camera);
  const joint = (id: number) => m.assembly.get(id)!;
  const progress = (j: AssemblyJoint) => joint(j.id).fastener.progress;
  // Which way round the screen tightens a part circled by hand, from where the camera is:
  // along its hole's axis (the turn's turned connector), seen from the camera.
  const tighten = (part: Part, hole: number) => {
    const axis = connectorInWorld(PART_TYPES[part.type].connectors[hole], { position: part.mesh.position.toArray() as Vec3, rotation: part.mesh.quaternion.toArray() as Quat });
    return Math.sign(tightenSign(axis.axis, new THREE.Vector3(...axis.position).sub(m.camera.position).toArray()));
  };
  const centre = (part: Part, hole: number) =>
    connectorInWorld(PART_TYPES[part.type].connectors[hole], { position: part.mesh.position.toArray() as Vec3, rotation: part.mesh.quaternion.toArray() as Quat }).position;
  // A press on the part's own middle, held `frames` frames still, let go.
  const holdOn = (part: Part, frames: number) => {
    const at = m.screen(part.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.hold(frames);
    m.canvas.fire('pointerup', at);
  };
  // A press on the part, dragged `px` px straight off it: what the drag became.
  const dragOff = (part: Part, px = 60) => {
    const at = m.screen(part.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.canvas.fire('pointermove', { clientX: at.clientX + px, clientY: at.clientY });
    const mode = m.router.dragging?.mode ?? null;
    m.canvas.fire('pointerup', { clientX: at.clientX + px, clientY: at.clientY });
    return mode;
  };
  // The ring's band round `world`: a press there, then a sweep of `degrees` round it.
  const ring = (world: Vec3, degrees: number) => {
    const c = m.screen(world);
    m.circle({ clientX: c.clientX + TURN_RING.radius, clientY: c.clientY }, world, degrees, 0, TURN_RING.radius);
  };
  return { ...m, top, studs: studParts, legs: legParts, joint, progress, tighten, centre, holdOn, dragOff, ring };
}
type Table = ReturnType<typeof table>;
const studIntoTop = (t: Table, n = 1, mover = `doubleEndedStud-${n}`) =>
  t.assembly.seat({ partA: `doubleEndedStud-${n}`, connectorA: 0, partB: 'top-1', connectorB: n - 1, mover });
const legOntoStud = (t: Table, n = 1, mover = `leg-${n}`) =>
  t.assembly.seat({ partA: `doubleEndedStud-${n}`, connectorA: 1, partB: `leg-${n}`, connectorB: 0, mover });
const set = (t: Table, j: AssemblyJoint, progress: number) =>
  t.assembly.apply(j.id, { type: 'crank', radians: (progress - t.progress(j)) * FASTENER.studRadians });

describe('1. a leg set onto a standing stud', () => {
  function bench() {
    const t = table({ sunk: 1, on: 0 });
    const inTop = studIntoTop(t);
    t.assembly.drive(inTop.id);
    const inLeg = legOntoStud(t);
    return { ...t, inTop, inLeg, leg: t.legs[0] };
  }

  it('carries off on a drag at nothing, and turns from a drag on its ring — clockwise from above, as a nut goes on', () => {
    const b = bench();
    expect(b.dragOff(b.leg)).toBe('move');
    const c = bench();
    expect(c.tighten(c.leg, 0)).toBe(1);
    c.hold(1);
    expect(c.dials.at(-1)).toMatchObject([{ progress: 0, clockwise: true }]);
    c.ring(c.centre(c.leg, 0), 120);
    expect(c.progress(c.inLeg)).toBeGreaterThan(0);
    // Under way, a drag on the leg itself turns it too: the other way backs it off.
    const turned = c.progress(c.inLeg);
    c.circle(c.screen(c.leg.mesh.position), c.centre(c.leg, 0), -60, 0, TURN_RING.radius);
    expect(c.progress(c.inLeg)).toBeLessThan(turned);
  });

  it('drives home on a still press, flashes its dial home, then shows none', () => {
    const b = bench();
    b.holdOn(b.leg, TAP_FRAMES + DRIVE_FRAMES);
    expect(b.joint(b.inLeg.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    expect(b.fastens()).toHaveLength(1);
    b.dials.length = 0;
    b.hold(1);
    expect(b.dials.some((d) => d?.[0]?.flashing)).toBe(true);
    b.hold(FLASH_FRAMES);
    expect(b.dials.at(-1)).toBeNull();
  });

  it('home, loosens off its stud from a drag — the stud staying in the top — and is held at the stud\'s end at nothing', () => {
    const b = bench();
    b.holdOn(b.leg, TAP_FRAMES + DRIVE_FRAMES);
    b.grabbed.length = 0;
    b.circle(b.screen(b.leg.mesh.position), b.centre(b.leg, 0), -b.tighten(b.leg, 0) * 1500, 0, TURN_RING.radius);
    expect(b.progress(b.inLeg)).toBe(0);
    expect(b.joint(b.inTop.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    expect(b.grabbed).toContain(b.leg.body);
    const [x, y, z] = legAt(0, 1, 0);
    expect(b.leg.mesh.position.toArray()).toEqual([expect.closeTo(x, 6), expect.closeTo(y, 6), expect.closeTo(z, 6)]);
  });

  it('lifts off on a tap at nothing, handed back to the simulation; part-turned, the tap is the ordinary one', () => {
    const b = bench();
    b.holdOn(b.leg, TAP_FRAMES + 3);
    expect(b.progress(b.inLeg)).toBeGreaterThan(0);
    const tapped = vi.spyOn(b.assembly, 'tap');
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.joint(b.inLeg.id)).not.toBeNull();
    expect(tapped).toHaveBeenCalledWith('leg-1', expect.any(Function));
    const c = bench();
    // Taken up and let go where it is: held at its seat, then tapped.
    c.ring(c.centre(c.leg, 0), 30);
    c.ring(c.centre(c.leg, 0), -90);
    expect(c.progress(c.inLeg)).toBe(0);
    c.released.length = 0;
    c.tap(c.screen(c.leg.mesh.position));
    expect(c.assembly.get(c.inLeg.id)).toBeNull();
    expect(c.released).toContain(c.leg.body);
  });

  // Two legs on two studs, the camera far enough off that leg 2 lies in leg 1's ring band.
  function pair() {
    const b = table({ studs: 2, sunk: 1, on: 0, camera: [0, 7, 5] });
    for (const n of [1, 2]) {
      b.assembly.drive(studIntoTop(b, n).id);
      legOntoStud(b, n);
    }
    const head = b.screen(b.centre(b.legs[0], 0));
    const press = b.screen(b.legs[1].mesh.position);
    expect(Math.abs(Math.hypot(press.clientX - head.clientX, press.clientY - head.clientY) - TURN_RING.radius)).toBeLessThanOrEqual(TURN_RING.band);
    b.hold(1);
    const drag = () => {
      b.canvas.fire('pointerdown', press);
      b.canvas.fire('pointermove', { clientX: press.clientX + 30, clientY: press.clientY + 30 });
      const dragging = b.router.dragging;
      b.canvas.fire('pointerup', press);
      return dragging && { mode: dragging.mode, part: dragging.part.id };
    };
    return { ...b, drag };
  }

  it("is its own press inside a neighbour's ring: at nothing, its own carry", () => {
    expect(pair().drag()).toEqual({ mode: 'move', part: 'leg-2' });
  });

  it("is its own press inside a neighbour's ring: home and ringless, its own loosening turn", () => {
    const b = pair();
    b.assembly.drive(b.assembly.all().find((j) => j.host === 'leg-2')!.id);
    b.hold(FLASH_FRAMES);
    expect(b.drag()).toEqual({ mode: 'crank', part: 'leg-2' });
  });
});

describe('2. a leg screwed home onto a loose stud, carried onto the top', () => {
  // The stud home in the leg, its free end at the top's first mouth.
  function bench({ keyed = false } = {}) {
    const t = table({ sunk: 0, on: 1 });
    const inLeg = legOntoStud(t, 1, keyed ? 'doubleEndedStud-1' : 'leg-1');
    t.assembly.drive(inLeg.id);
    return { ...t, inLeg, leg: t.legs[0], stud: t.studs[0] };
  }
  const carryOn = (b: ReturnType<typeof bench>) => studIntoTop(b, 1, 'leg-1');

  it('picks up and carries as one with its stud: there is nothing to turn into', () => {
    const b = bench();
    expect(b.assembly.turnOf('leg-1')).toBeNull();
    expect(b.router.carries(b.leg)).toBe(true);
    expect(b.dragOff(b.leg)).toBe('move');
  });

  it('carried on, finishes the stud into the top by circling, the stud riding in the leg', () => {
    const b = bench();
    const inTop = carryOn(b);
    b.hold(1);
    expect(b.dials.at(-1)).toMatchObject([{ progress: 0 }]);
    b.assembly.apply(inTop.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    // The leg and the stud in it go down the top's hole together, an eighth of a sink.
    expect(b.leg.mesh.position.y).toBeCloseTo(b.leg.body.translation().y - SINK() / 8, 9);
    expect(b.stud.mesh.position.y).toBeCloseTo(b.stud.body.translation().y - SINK() / 8, 9);
    b.holdOn(b.leg, TAP_FRAMES + DRIVE_FRAMES);
    expect(b.joint(inTop.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
  });

  it('keyed into the leg and carried on, circles out of the top to nothing and is held there as a pair; a tap hands both back', () => {
    const b = bench({ keyed: true });
    const inTop = carryOn(b);
    b.holdOn(b.leg, TAP_FRAMES + DRIVE_FRAMES);
    expect(b.progress(inTop)).toBe(1);
    b.grabbed.length = 0;
    b.circle(b.screen(b.leg.mesh.position), b.centre(b.leg, 0), -b.tighten(b.leg, 0) * 1500, 0, TURN_RING.radius);
    expect(b.progress(inTop)).toBe(0);
    expect(b.progress(b.inLeg)).toBe(1);
    expect(b.grabbed).toEqual(expect.arrayContaining([b.leg.body, b.stud.body]));
    b.released.length = 0;
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.assembly.get(inTop.id)).toBeNull();
    expect(b.released).toEqual(expect.arrayContaining([b.leg.body, b.stud.body]));
  });
});

describe('3. a top dropped onto four standing studs', () => {
  // Four legs standing on the floor, a stud keyed home in each, the top dropped on.
  function bench() {
    const spots: [number, number][] = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
    const legs = spots.map(([x, z], i) => makePart(`leg-${i + 1}`, 'leg', [x, 0.2, z]));
    const studs = spots.map(([x, z], i) => makePart(`doubleEndedStud-${i + 1}`, 'doubleEndedStud', [x, 0.4, z]));
    const top = makePart('top-1', 'top', [0, 0.445, 0]);
    const m = mount([...legs, ...studs, top], [0, 1.4, 0.9]);
    const inLegs = spots.map((_, i) => {
      const j = m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 1, partB: `leg-${i + 1}`, connectorB: 0, mover: `doubleEndedStud-${i + 1}` });
      m.assembly.drive(j.id);
      return j;
    });
    const onTop = spots.map((_, i) => m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 0, partB: 'top-1', connectorB: i, mover: 'top-1' }));
    const progresses = () => onTop.map((j) => m.assembly.get(j.id)!.fastener.progress);
    const hole = connectorInWorld(PART_TYPES.top.connectors[0], { position: [0, 0.445, 0], rotation: [0, 0, 0, 1] }).position;
    // A sweep round the top's first hole from its ring's band: at nothing turned, a drag on
    // the top itself would carry it off its studs.
    const sweep = (degrees: number) => {
      const c = m.screen(hole);
      m.circle({ clientX: c.clientX + TURN_RING.radius, clientY: c.clientY }, hole, degrees, 0, TURN_RING.radius);
    };
    const holdOn = (frames: number) => {
      const at = m.screen(top.mesh.position);
      m.canvas.fire('pointerdown', at);
      m.hold(frames);
      m.canvas.fire('pointerup', at);
    };
    return { ...m, top, studs, legs, onTop, inLegs, progresses, hole, sweep, holdOn };
  }

  it('shows one dial, and turns all four from one circle with one set of ratchet clicks', () => {
    const b = bench();
    b.hold(1);
    expect(b.dials.at(-1)).toHaveLength(1);
    b.sweep(120);
    const [first, ...rest] = b.progresses();
    expect(first).toBeGreaterThan(0);
    for (const p of rest) expect(p).toBeCloseTo(first, 9);
    expect(b.clicks()).toBe(Math.floor((first * FASTENER.studRadians) / FASTENER.ratchetRadians + 1e-9));
  });

  it('draws the top turned once, about its first hole, which stays on its stud', () => {
    const b = bench();
    const hole = () => connectorInWorld(PART_TYPES.top.connectors[0], { position: b.top.mesh.position.toArray() as Vec3, rotation: b.top.mesh.quaternion.toArray() as Quat }).position;
    const before = hole();
    for (const j of b.onTop) b.assembly.apply(j.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    expect(hole()[0]).toBeCloseTo(before[0], 9);
    expect(hole()[2]).toBeCloseTo(before[2], 9);
    // Once, not four times: a quarter turn and an eighth of a sink, from where its body is.
    expect(b.top.mesh.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 9);
    expect(b.top.mesh.position.y).toBeCloseTo(0.445 - SINK() / 8, 9);
  });

  it('drives the rest home when one is home early, and draws the riding studs each once', () => {
    const b = bench();
    b.assembly.drive(b.onTop[0].id);
    b.holdOn(TAP_FRAMES + DRIVE_FRAMES);
    expect(b.progresses()).toEqual([1, 1, 1, 1]);
    // Home on all four, the studs ride with the top — one move each, the top's, which at
    // home is none: each stud drawn where its body is.
    b.hold(1);
    for (const stud of b.studs) {
      const { x, y, z } = stud.body.translation();
      expect(stud.mesh.position.distanceTo(new THREE.Vector3(x, y, z))).toBeCloseTo(0, 9);
    }
  });

  it('loosens all four together from a drag on the top', () => {
    const b = bench();
    for (const j of b.onTop) b.assembly.drive(j.id);
    // Home, a drag on the top itself is the turn: its ring is gone.
    b.circle(b.screen(b.top.mesh.position), b.hole, -240, 0, TURN_RING.radius);
    const p = b.progresses();
    expect(p[0]).toBeLessThan(1);
    for (const x of p) expect(x).toBeCloseTo(p[0], 9);
    // Never the studs out of the legs.
    for (const j of b.inLegs) expect(b.assembly.get(j.id)!.fastener.progress).toBe(1);
  });
});

describe('4. a stud half into the top with a leg screwed home on it', () => {
  function bench() {
    const t = table({ sunk: 0.5, on: 1 });
    const inTop = studIntoTop(t);
    set(t, inTop, 0.5);
    const inLeg = legOntoStud(t);
    t.assembly.drive(inLeg.id);
    return { ...t, inTop, inLeg, leg: t.legs[0], stud: t.studs[0] };
  }

  it("shows the leg's dial at the stud's half, finishes the stud by circling the leg, and flashes home", () => {
    const b = bench();
    b.hold(1);
    expect(b.dials.at(-1)).toMatchObject([{ progress: 0.5, flashing: false }]);
    b.dials.length = 0;
    b.circle(b.screen(b.leg.mesh.position), b.centre(b.leg, 0), b.tighten(b.leg, 0) * 1000, 0, TURN_RING.radius);
    expect(b.joint(b.inTop.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    b.hold(1);
    expect(b.dials.some((d) => d?.[0]?.flashing)).toBe(true);
  });

  it('draws the leg and its stud down the hole together', () => {
    const b = bench();
    b.hold(1);
    expect(b.leg.mesh.position.y).toBeCloseTo(b.leg.body.translation().y - SINK() / 2, 9);
    expect(b.stud.mesh.position.y).toBeCloseTo(b.stud.body.translation().y - SINK() / 2, 9);
  });
});

describe('5. a key on a hand-seated stud', () => {
  const TIP_DOWN: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  // The key let go with its tip at `at`, the way a player drops it there.
  function keyAt(t: Table, key: Part, at: Vec3) {
    const tip = new THREE.Vector3(...PART_TYPES.allenWrench.connectors[0].position).applyQuaternion(new THREE.Quaternion(...TIP_DOWN));
    const position: Vec3 = [at[0] - tip.x, at[1] - tip.y + 0.02, at[2] - tip.z];
    const body = key.body as unknown as { pose: { position: THREE.Vector3; quaternion: THREE.Quaternion } };
    body.pose.position.set(...position);
    body.pose.quaternion.set(...TIP_DOWN);
    key.mesh.position.set(...position);
    key.mesh.quaternion.set(...TIP_DOWN);
    key.mesh.updateMatrixWorld(true);
    const s = t.screen(key.mesh.position);
    t.canvas.fire('pointerdown', s);
    t.canvas.fire('pointermove', { clientX: s.clientX, clientY: s.clientY + 15 });
    t.canvas.fire('pointermove', s);
    t.canvas.fire('pointerup', s);
    t.hold(1);
  }
  function bench({ mover = 'doubleEndedStud-1' } = {}) {
    const top = makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation);
    const stud = makePart('doubleEndedStud-1', 'doubleEndedStud', studAt(0, 0), FLIPPED);
    const key = makePart('allenWrench-1', 'allenWrench', [0.3, 0.1, 0.3], TIP_DOWN);
    const leg = makePart('leg-1', 'leg', legAt(0, 0, -0.25), FLIPPED);
    const m = mount([top, stud, key, leg]);
    const joint = m.assembly.seat({ partA: stud.id, connectorA: 0, partB: top.id, connectorB: 0, mover });
    const free: Vec3 = [...mouth(0)];
    free[1] += 2 * STUD_HALF();
    const t = { ...m, top, studs: [stud], legs: [leg], joint: (id: number) => m.assembly.get(id)!, progress: (j: AssemblyJoint) => m.assembly.get(j.id)!.fastener.progress } as unknown as Table;
    return { ...m, t, top, stud, key, leg, inTop: joint, free };
  }
  const tool = (b: ReturnType<typeof bench>) => b.assembly.all().find((j) => j.kind === 'tool') ?? null;

  it('turns and sinks the stud on a top that was dropped onto it — the top does not turn', () => {
    const b = bench({ mover: 'top-1' });
    // Seated by the graph: the top's own ring is where a press on the key would land.
    b.assembly.seat({ partA: b.key.id, connectorA: 0, partB: b.stud.id, connectorB: HEX_AT_END_2, mover: b.key.id });
    expect(tool(b)).toMatchObject({ host: 'doubleEndedStud-1', hostConnector: HEX_AT_END_2 });
    const topAt = b.top.mesh.position.clone();
    b.assembly.apply(b.inTop.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    expect(b.top.mesh.position.distanceTo(topAt)).toBeCloseTo(0, 9);
    expect(b.top.mesh.quaternion.angleTo(new THREE.Quaternion(...FLIPPED))).toBeCloseTo(0, 9);
    expect(b.stud.mesh.position.y).toBeCloseTo(b.stud.body.translation().y - SINK() / 8, 9);
    // Circling on the key's ring turns the stud on.
    const c = b.screen(b.free);
    b.circle({ clientX: c.clientX + TURN_RING.radius, clientY: c.clientY }, b.free, 180, 0, TURN_RING.radius);
    expect(b.assembly.get(b.inTop.id)!.fastener.progress).toBeGreaterThan(1 / 8);
  });

  it('takes no key in the hex sunk in the top, and no leg over the end the key sits in', () => {
    const b = bench();
    keyAt(b.t, b.key, mouth(0));
    expect(tool(b)?.hostConnector ?? HEX_AT_END_2).toBe(HEX_AT_END_2);
    const c = bench();
    keyAt(c.t, c.key, c.free);
    expect(tool(c)).not.toBeNull();
    const over = c.screen(c.leg.mesh.position);
    c.canvas.fire('pointerdown', over);
    c.canvas.fire('pointermove', { clientX: over.clientX, clientY: over.clientY + 15 });
    c.canvas.fire('pointermove', over);
    c.canvas.fire('pointerup', over);
    c.hold(1);
    expect(c.assembly.all().filter((j) => j.host === 'leg-1')).toEqual([]);
  });

  it("keeps a key on a buried hex its own: a tap takes it off, whatever ring it lies in", () => {
    const b = bench();
    const keyJoint = b.assembly.seat({ partA: b.key.id, connectorA: 0, partB: b.stud.id, connectorB: HEX_AT_END_1, mover: b.key.id });
    expect(b.assembly.turnOf(b.key.id)).toMatchObject({ joints: [] });
    b.tap(b.screen(b.key.mesh.position));
    expect(b.assembly.get(keyJoint.id)).toBeNull();
  });
});

describe('6. JOHNNY: the key on a bolt, as before', () => {
  // The full tool suites — test/toolDriveRouter.test.ts, test/toolsDriveAcceptance.test.ts,
  // test/toolsSeatAcceptance.test.ts — run unchanged on the record; this pins its centre and
  // direction against the bolt's head, which is where the ring has always been.
  beforeAll(() => setItem('johnny'));
  afterAll(() => setItem('blank'));

  it('rings the head, tightens clockwise from above, and cranks from a circle of the key', () => {
    const panelPose = { position: [0, 0.008, 0] as Vec3, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as Quat };
    const hole = connectorInWorld(PART_TYPES.sidePanel.connectors[2], panelPose).position;
    const half = PART_TYPES.camLockBolt.size[1] / 2;
    const head: Vec3 = [hole[0], hole[1] + 2 * half, hole[2]];
    const m = mount([
      makePart('sidePanel-1', 'sidePanel', panelPose.position, panelPose.rotation),
      makePart('camLockBolt-1', 'camLockBolt', [hole[0], hole[1] + half, hole[2]]),
      makePart('allenWrench-1', 'allenWrench', [head[0] + 0.03, head[1] + 0.03, head[2]]),
    ]);
    const bolt = m.assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: 'sidePanel-1', connectorB: 2, mover: 'camLockBolt-1' });
    m.assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'camLockBolt-1', connectorB: 1, mover: 'allenWrench-1' });
    m.hold(1);
    const dial = m.dials.at(-1)![0];
    const at = m.screen(head);
    expect(dial.centre[0]).toBeCloseTo(at.clientX, 6);
    expect(dial.centre[1]).toBeCloseTo(at.clientY, 6);
    expect(dial.clockwise).toBe(true);
    m.circle({ clientX: at.clientX + TURN_RING.radius, clientY: at.clientY }, head, 180, 0, TURN_RING.radius);
    expect(m.assembly.get(bolt.id)!.fastener.progress).toBeGreaterThan(0);
    expect(m.log.filter((e) => e.type === EVENT.FASTEN)).toEqual([]);
  });
});
