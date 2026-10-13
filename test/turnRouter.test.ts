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
    m.hold(1);
    m.canvas.fire('pointerup', { clientX: at.clientX + px, clientY: at.clientY });
    return mode;
  };
  // A press on the part itself, then a circle of `degrees` round `world` (its hole), let go:
  // a part circled by hand is turned by circling it.
  const circleOn = (part: Part, world: Vec3, degrees: number) => m.circle(m.screen(part.mesh.position), world, degrees, 0, TURN_RING.radius);
  // The dials shown while the finger is down on `part`, then let go.
  const dialsWhilePressed = (part: Part) => {
    const at = m.screen(part.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.hold(1);
    const shown = m.dials.at(-1);
    // Let go without it counting as a tap, which would lift a loose part off.
    m.canvas.fire('pointercancel', at);
    return shown;
  };
  return { ...m, top, studs: studParts, legs: legParts, joint, progress, tighten, centre, holdOn, dragOff, circleOn, dialsWhilePressed };
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

  // Manual-test round (Ben, 2026-10-12): the leg's ring shows only while the finger is on
  // the leg, and the leg is what is circled — no gizmo round it.
  it('shows its ring only while pressed, and turns from a drag on the leg itself — clockwise from above, as a nut goes on', () => {
    const b = bench();
    b.hold(1);
    expect(b.dials.at(-1)).toBeNull();
    expect(b.dialsWhilePressed(b.leg)).toMatchObject([{ progress: 0, clockwise: true }]);
    b.hold(1);
    expect(b.dials.at(-1)).toBeNull();
    expect(b.tighten(b.leg, 0)).toBe(1);
    b.circleOn(b.leg, b.centre(b.leg, 0), 120);
    expect(b.progress(b.inLeg)).toBeGreaterThan(0);
    const turned = b.progress(b.inLeg);
    b.circleOn(b.leg, b.centre(b.leg, 0), -60);
    expect(b.progress(b.inLeg)).toBeLessThan(turned);
  });

  it('drives home on a still press once under way, flashing home under the finger', () => {
    const b = bench();
    b.circleOn(b.leg, b.centre(b.leg, 0), 30);
    const at = b.screen(b.leg.mesh.position);
    b.dials.length = 0;
    b.canvas.fire('pointerdown', at);
    b.hold(TAP_FRAMES + DRIVE_FRAMES);
    expect(b.joint(b.inLeg.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    expect(b.dials.some((d) => d?.[0]?.flashing)).toBe(true);
    b.canvas.fire('pointerup', at);
    expect(b.fastens()).toHaveLength(1);
    b.hold(1);
    expect(b.dials.at(-1)).toBeNull();
  });

  it("home, loosens off its stud from a drag on the leg — the stud staying in the top — held at the stud's end mid-drag, not falling", () => {
    const b = bench();
    b.assembly.drive(b.inLeg.id);
    b.grabbed.length = 0;
    const centre = b.centre(b.leg, 0);
    const c = b.screen(centre);
    const sign = -b.tighten(b.leg, 0);
    const at = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return { clientX: c.clientX + TURN_RING.radius * Math.cos(a), clientY: c.clientY + TURN_RING.radius * Math.sin(a) };
    };
    b.canvas.fire('pointerdown', b.screen(b.leg.mesh.position));
    for (let d = 0; d <= 1500; d += 10) {
      b.canvas.fire('pointermove', at(sign * d));
      b.hold(1);
    }
    // The whole loosening in one drag: held at nothing before the finger lifts.
    expect(b.progress(b.inLeg)).toBe(0);
    expect(b.router.dragging?.mode).toBe('crank');
    expect(b.grabbed).toContain(b.leg.body);
    b.canvas.fire('pointerup', at(sign * 1500));
    expect(b.joint(b.inTop.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    const [x, y, z] = legAt(0, 1, 0);
    expect(b.leg.mesh.position.toArray()).toEqual([expect.closeTo(x, 6), expect.closeTo(y, 6), expect.closeTo(z, 6)]);
  });

  it('lifts off on a tap at nothing, handed back to the simulation; partway, the tap is the ordinary one', () => {
    const b = bench();
    b.assembly.apply(b.inLeg.id, { type: 'crank', radians: FASTENER.studRadians / 4 });
    const tapped = vi.spyOn(b.assembly, 'tap');
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.joint(b.inLeg.id)).not.toBeNull();
    expect(tapped).toHaveBeenCalledWith('leg-1', expect.any(Function));
    const c = bench();
    // Taken up and let go where it is: held at its seat, then tapped.
    c.circleOn(c.leg, c.centre(c.leg, 0), 30);
    c.circleOn(c.leg, c.centre(c.leg, 0), -90);
    expect(c.progress(c.inLeg)).toBe(0);
    c.released.length = 0;
    c.tap(c.screen(c.leg.mesh.position));
    expect(c.assembly.get(c.inLeg.id)).toBeNull();
    expect(c.released).toContain(c.leg.body);
  });

  // Review round 7: a still press on a loose leg held past a tap is a tap, never a dead
  // gesture — the bench's clock runs, so the press really is longer than a tap.
  it('lifts off on a slow tap at nothing — a still press on a loose leg drives nothing and is still a tap', () => {
    const b = bench();
    b.holdOn(b.leg, TAP_FRAMES + 10);
    expect(b.assembly.get(b.inLeg.id)).toBeNull();
  });

  it('takes no gizmo: tapped partway it is not selected, and selected before it went on it sheds it', () => {
    const b = bench();
    b.assembly.apply(b.inLeg.id, { type: 'crank', radians: FASTENER.studRadians / 4 });
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.taps).toEqual([]);
    // Selected while it lay loose, then set onto its stud: the gizmo goes.
    const c = table({ sunk: 1, on: 0 });
    c.assembly.drive(studIntoTop(c).id);
    c.tap(c.screen(c.legs[0].mesh.position));
    expect(c.rings.selected).toBe(c.legs[0]);
    legOntoStud(c);
    c.hold(1);
    expect(c.rings.selected).toBeNull();
  });

  // Ben's manual test: home, the leg is part of the built table — a tap selects it, and the
  // gizmo on it turns (flips) the whole table.
  it('home, is selected by a tap, as any part of the built table', () => {
    const b = bench();
    b.assembly.drive(b.inLeg.id);
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.rings.selected).toBe(b.leg);
    b.hold(1);
    expect(b.rings.selected).toBe(b.leg);
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

  it("is its own turn inside a neighbour's ring, at nothing and home alike", () => {
    expect(pair().drag()).toEqual({ mode: 'crank', part: 'leg-2' });
    const b = pair();
    b.assembly.drive(b.assembly.all().find((j) => j.host === 'leg-2')!.id);
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
    const before = b.leg.mesh.position.clone();
    const at = b.screen(b.leg.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.canvas.fire('pointermove', { clientX: at.clientX + 60, clientY: at.clientY });
    expect(b.router.dragging?.mode).toBe('move');
    b.hold(1);
    // Carried with its stud: it goes where the finger goes (let go, it seats back where it was).
    expect(b.leg.mesh.position.distanceTo(before)).toBeGreaterThan(0.01);
    b.canvas.fire('pointercancel', { clientX: at.clientX + 60, clientY: at.clientY });
  });

  it('carried on, finishes the stud into the top by circling the leg, the stud riding in it', () => {
    const b = bench();
    const inTop = carryOn(b);
    expect(b.dialsWhilePressed(b.leg)).toMatchObject([{ progress: 0 }]);
    b.assembly.apply(inTop.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    // The leg and the stud in it go down the top's hole together, an eighth of a sink.
    expect(b.leg.mesh.position.y).toBeCloseTo(b.leg.body.translation().y - SINK() / 8, 9);
    expect(b.stud.mesh.position.y).toBeCloseTo(b.stud.body.translation().y - SINK() / 8, 9);
    b.holdOn(b.leg, TAP_FRAMES + DRIVE_FRAMES);
    expect(b.joint(inTop.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
  });

  // Hand-screwed and carried on: a drag on the leg turns it into the top; a tap lifts the
  // pair back off, the leg still home on its stud.
  it('hand-screwed and carried on, turns into the top on a drag, and lifts off with its stud on a tap', () => {
    const b = bench();
    carryOn(b);
    expect(b.dragOff(b.leg)).toBe('crank');
    const c = bench();
    const inTop = carryOn(c);
    c.tap(c.screen(c.leg.mesh.position));
    expect(c.assembly.get(inTop.id)).toBeNull();
    expect(c.joint(c.inLeg.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
  });

  it('keyed, backed off partway and carried on, draws its stud riding down with the leg', () => {
    const b = bench({ keyed: true });
    b.assembly.apply(b.inLeg.id, { type: 'crank', radians: -FASTENER.studRadians / 2 });
    expect(b.joint(b.inLeg.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 0.5 });
    const inTop = carryOn(b);
    b.assembly.apply(inTop.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    expect(b.leg.mesh.position.y).toBeCloseTo(b.leg.body.translation().y - SINK() / 8, 9);
    expect(b.stud.mesh.position.y).toBeCloseTo(b.stud.body.translation().y - SINK() / 8, 9);
  });

  it('keyed into the leg and carried on, circles out of the top to nothing and is held there as a pair; a tap hands both back', () => {
    const b = bench({ keyed: true });
    const inTop = carryOn(b);
    b.circleOn(b.leg, b.centre(b.leg, 0), b.tighten(b.leg, 0) * 30);
    b.holdOn(b.leg, TAP_FRAMES + DRIVE_FRAMES);
    expect(b.progress(inTop)).toBe(1);
    b.grabbed.length = 0;
    b.circleOn(b.leg, b.centre(b.leg, 0), -b.tighten(b.leg, 0) * 1500);
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
  function bench(camera: Vec3 = [0, 1.4, 0.9]) {
    const spots: [number, number][] = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
    const legs = spots.map(([x, z], i) => makePart(`leg-${i + 1}`, 'leg', [x, 0.2, z]));
    const studs = spots.map(([x, z], i) => makePart(`doubleEndedStud-${i + 1}`, 'doubleEndedStud', [x, 0.4, z]));
    const top = makePart('top-1', 'top', [0, 0.445, 0]);
    const m = mount([...legs, ...studs, top], camera);
    const inLegs = spots.map((_, i) => {
      const j = m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 1, partB: `leg-${i + 1}`, connectorB: 0, mover: `doubleEndedStud-${i + 1}` });
      m.assembly.drive(j.id);
      return j;
    });
    const onTop = spots.map((_, i) => m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 0, partB: 'top-1', connectorB: i, mover: 'top-1' }));
    const progresses = () => onTop.map((j) => m.assembly.get(j.id)!.fastener.progress);
    const hole = connectorInWorld(PART_TYPES.top.connectors[0], { position: [0, 0.445, 0], rotation: [0, 0, 0, 1] }).position;
    // A drag on the top, circling its first hole: the top is what is circled.
    const sweep = (degrees: number) => m.circle(m.screen(top.mesh.position), hole, degrees, 0, TURN_RING.radius);
    // A still press on the top, held `frames` frames.
    const holdTop = (frames: number) => {
      const at = m.screen(top.mesh.position);
      m.canvas.fire('pointerdown', at);
      m.hold(frames);
      m.canvas.fire('pointerup', at);
    };
    // The dials shown while the finger is on the top.
    const dialsWhilePressed = () => {
      const at = m.screen(top.mesh.position);
      m.canvas.fire('pointerdown', at);
      m.hold(1);
      const shown = m.dials.at(-1);
      m.canvas.fire('pointercancel', at);
      return shown;
    };
    return { ...m, top, studs, legs, onTop, inLegs, progresses, hole, sweep, holdTop, dialsWhilePressed };
  }

  it('shows one dial, and turns all four from one circle with one set of ratchet clicks', () => {
    const b = bench();
    expect(b.dialsWhilePressed()).toHaveLength(1);
    b.sweep(120);
    const [first, ...rest] = b.progresses();
    expect(first).toBeGreaterThan(0);
    for (const p of rest) expect(p).toBeCloseTo(first, 9);
    expect(b.clicks()).toBe(Math.floor((first * FASTENER.studRadians) / FASTENER.ratchetRadians + 1e-9));
  });

  // Review round 5: the clicks are the first joint that moved, not joints[0] whatever it did.
  it('clicks for the first stud that moved when the first in the batch does not', () => {
    const b = bench();
    const apply = b.assembly.apply.bind(b.assembly);
    let calls = 0;
    vi.spyOn(b.assembly, 'apply').mockImplementation((id, event, ctx) => (calls++ % 4 === 0 ? false : apply(id, event, ctx)));
    b.sweep(120);
    expect(b.progresses()[0]).toBe(0);
    expect(b.progresses()[1]).toBeGreaterThan(0);
    expect(b.clicks()).toBeGreaterThan(0);
  });

  it('draws the top sinking onto its four studs without spinning — every hole stays over its stud', () => {
    const b = bench();
    const holes = () =>
      [0, 1, 2, 3].map((i) => connectorInWorld(PART_TYPES.top.connectors[i], { position: b.top.mesh.position.toArray() as Vec3, rotation: b.top.mesh.quaternion.toArray() as Quat }).position);
    const before = holes();
    // A quarter of the span: half a turn, which on one stud would swing the top round.
    for (const j of b.onTop) b.assembly.apply(j.id, { type: 'crank', radians: FASTENER.studRadians / 4 });
    b.hold(1);
    expect(b.top.mesh.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 9);
    holes().forEach((hole, i) => {
      expect(hole[0]).toBeCloseTo(before[i][0], 9);
      expect(hole[2]).toBeCloseTo(before[i][2], 9);
    });
    // Down a quarter of a sink, once — not four times.
    expect(b.top.mesh.position.y).toBeCloseTo(0.445 - SINK() / 4, 9);
    // The dial still shows the turn, under the finger.
    expect(b.dialsWhilePressed()).toMatchObject([{ progress: 0.25 }]);
  });

  it('drives the rest home when one is home early, and draws the riding studs each once', () => {
    const b = bench();
    b.assembly.drive(b.onTop[0].id);
    // Under way on the rest, a still press on the top drives them home.
    b.sweep(30);
    b.holdTop(TAP_FRAMES + DRIVE_FRAMES);
    expect(b.progresses()).toEqual([1, 1, 1, 1]);
    // Home on all four, the studs ride with the top — one move each, the top's, which at
    // home is none: each stud drawn where its body is.
    b.hold(1);
    for (const stud of b.studs) {
      const { x, y, z } = stud.body.translation();
      expect(stud.mesh.position.distanceTo(new THREE.Vector3(x, y, z))).toBeCloseTo(0, 9);
    }
  });

  // Home on all four, the table moves as one by a part with no turn of its own: a leg its
  // stud was keyed into. The top — the part that was set on the studs — turns.
  it('home on all four: a drag on a leg carries the whole table, the turns untouched', () => {
    // From in front, where a front leg shows below the top.
    const b = bench([0, 0.6, 1.6]);
    for (const j of b.onTop) b.assembly.drive(j.id);
    const leg = b.legs[2];
    expect(b.assembly.turnOf(leg.id)).toBeNull();
    const before = leg.mesh.position.clone();
    const at = b.screen(leg.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.canvas.fire('pointermove', { clientX: at.clientX + 60, clientY: at.clientY });
    expect(b.router.dragging).toMatchObject({ mode: 'move', part: { id: leg.id } });
    b.hold(1);
    // The leg goes where the finger goes; the rest of the table follows through its joints
    // (the physics seam — this bench's fake joints carry nothing, so only the leg is checked).
    expect(leg.mesh.position.distanceTo(before)).toBeGreaterThan(0.01);
    expect([...b.assembly.compoundOf(leg.id)]).toContain('top-1');
    b.canvas.fire('pointerup', { clientX: at.clientX + 60, clientY: at.clientY });
    expect(b.progresses()).toEqual([1, 1, 1, 1]);
  });

  it('loosens all four together from a drag on the top', () => {
    const b = bench();
    for (const j of b.onTop) b.assembly.drive(j.id);
    b.sweep(-240);
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
    expect(b.dialsWhilePressed(b.leg)).toMatchObject([{ progress: 0.5, flashing: false }]);
    b.dials.length = 0;
    b.circleOn(b.leg, b.centre(b.leg, 0), b.tighten(b.leg, 0) * 1000);
    expect(b.joint(b.inTop.id).fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    // It flashed home under the finger.
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

// Review round 6: joints no turn owns — a stud keyed into its leg and keyed into the top,
// the stud the mover of both — draw the stud once, by the one still to go home.
describe('a stud with two joints no turn owns', () => {
  it('is drawn once a frame, sunk by the joint still going in — not reset by the one home', () => {
    const t = table({ sunk: 0, on: 1 });
    const inTop = studIntoTop(t);
    t.assembly.drive(legOntoStud(t, 1, 'doubleEndedStud-1').id);
    set(t, inTop, 0.5);
    expect(t.assembly.turns()).toEqual([]);
    t.hold(1);
    expect(t.studs[0].mesh.position.y).toBeCloseTo(t.studs[0].body.translation().y - SINK() / 2, 9);
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
