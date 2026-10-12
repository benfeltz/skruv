import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { FASTENER, GESTURE, TURN_RING } from '../src/constants.js';
import { tightenSign } from '../src/game/crankMath.js';
import { EVENT } from '../src/game/events.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES, setItem } from '../src/game/item.js';
import { FRAME, makePart, mount } from './support/routerBench.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// A leg set onto its stud and turned by hand (1.9.2 step 4): the real router, BLANK's real
// pack. The top lies underside up with a stud screwed into its first hole; the leg hangs
// over the stud's free end, hole down. No tool: dragging the leg circles it, a still press
// drives it, a tap at zero lifts it off.

setItem('blank');

const FLIPPED: Quat = [1, 0, 0, 0];
const TOP_POSE = { position: [0, 0.025, 0] as Vec3, rotation: FLIPPED };
const SINK = FASTENER.sinkDepth.stud!;
const MOUTH = connectorInWorld(PART_TYPES.top.connectors[0], TOP_POSE).position;
const STUD_HALF = PART_TYPES.doubleEndedStud.size[1] / 2;
// The stud sunk home in the top: its free end stands 2 × half out of the mouth, less the sink.
const STUD_AT: Vec3 = [MOUTH[0], MOUTH[1] + STUD_HALF - SINK, MOUTH[2]];
const FREE_END: Vec3 = [MOUTH[0], MOUTH[1] + 2 * STUD_HALF - SINK, MOUTH[2]];
const LEG_HALF = PART_TYPES.leg.size[1] / 2;
const LEG_AT: Vec3 = [FREE_END[0], FREE_END[1] + LEG_HALF, FREE_END[2]];
const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;

function bench({ turned = 0 } = {}) {
  const top = makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation);
  const stud = makePart('doubleEndedStud-1', 'doubleEndedStud', STUD_AT, FLIPPED);
  const leg = makePart('leg-1', 'leg', LEG_AT, FLIPPED);
  const m = mount([top, stud, leg]);
  const inTop = m.assembly.seat({ partA: stud.id, connectorA: 0, partB: top.id, connectorB: 0, mover: stud.id });
  m.assembly.drive(inTop.id);
  const inLeg = m.assembly.seat({ partA: stud.id, connectorA: 1, partB: leg.id, connectorB: 0, mover: leg.id });
  if (turned > 0) m.assembly.apply(inLeg.id, { type: 'crank', radians: turned * FASTENER.studRadians });
  const progress = () => m.assembly.get(inLeg.id)!.fastener.progress;
  const seated = () => m.assembly.get(inLeg.id) !== null;
  // Which way round the screen tightens, from where the camera is.
  const into = connectorInWorld(PART_TYPES.doubleEndedStud.connectors[1], { position: STUD_AT, rotation: FLIPPED }).axis;
  const view = new THREE.Vector3(...FREE_END).sub(m.camera.position).toArray();
  const tighten = Math.sign(tightenSign(into, view));
  return { ...m, top, stud, leg, inLeg, progress, seated, tighten };
}

describe('handTarget', () => {
  it('is the joint a part was set onto its stud by: the leg has one, the stud and top do not', () => {
    const b = bench();
    expect(b.assembly.handTarget('leg-1')).toMatchObject({ id: b.inLeg.id, kind: KIND.STUD });
    expect(b.assembly.handTarget('doubleEndedStud-1')).toBeNull();
    expect(b.assembly.handTarget('top-1')).toBeNull();
  });

  it('is null for a leg that was seated by pushing the stud into it', () => {
    const m = mount([makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation), makePart('doubleEndedStud-1', 'doubleEndedStud', STUD_AT, FLIPPED), makePart('leg-1', 'leg', LEG_AT, FLIPPED)]);
    m.assembly.seat({ partA: 'doubleEndedStud-1', connectorA: 1, partB: 'leg-1', connectorB: 0, mover: 'doubleEndedStud-1' });
    expect(m.assembly.handTarget('leg-1')).toBeNull();
  });
});

describe('circling a leg', () => {
  it('turns it up the stud going the tightening way round, and back out the other', () => {
    const b = bench();
    const at = b.screen(b.leg.mesh.position);
    b.circle(at, FREE_END, b.tighten * 180, 0, TURN_RING.radius);
    expect(b.progress()).toBeGreaterThan(0);
    const turned = b.progress();
    expect(b.ratchet.length).toBeGreaterThan(0);
    b.circle(b.screen(b.leg.mesh.position), FREE_END, -b.tighten * 90, 0, TURN_RING.radius);
    expect(b.progress()).toBeLessThan(turned);
  });

  it('screws it home and reports the one FASTEN, with the leg still the player\'s to back out', () => {
    const b = bench();
    b.assembly.apply(b.inLeg.id, { type: 'crank', radians: FASTENER.studRadians * 0.95 });
    b.circle(b.screen(b.leg.mesh.position), FREE_END, b.tighten * 90, 0, TURN_RING.radius);
    expect(b.assembly.get(b.inLeg.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    expect(b.fastens().map((e) => e.type)).toEqual([EVENT.FASTEN]);
  });
});

describe('a still press', () => {
  it('drives the leg home in driveSeconds, tightening only', () => {
    const b = bench();
    const at = b.screen(b.leg.mesh.position);
    b.canvas.fire('pointerdown', at);
    let last = 0;
    for (let i = 0; i < TAP_FRAMES + DRIVE_FRAMES; i++) {
      b.hold(1);
      expect(b.progress()).toBeGreaterThanOrEqual(last);
      last = b.progress();
    }
    expect(b.assembly.get(b.inLeg.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    b.canvas.fire('pointerup', at);
    expect(b.seated()).toBe(true);
  });
});

describe('a tap on a leg', () => {
  it('lifts it off the stud while it is not turned', () => {
    const b = bench();
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.seated()).toBe(false);
    expect(b.log.filter((e) => e.type === EVENT.UNSEAT)).toHaveLength(1);
    // The leg is no longer anyone's target.
    expect(b.assembly.handTarget('leg-1')).toBeNull();
  });

  it('does nothing once it is part-turned', () => {
    const b = bench({ turned: 0.5 });
    b.tap(b.screen(b.leg.mesh.position));
    expect(b.seated()).toBe(true);
    expect(b.progress()).toBeCloseTo(0.5, 9);
  });
});

describe('the leg turns on screen', () => {
  it('rides up its stud and turns as progress grows, about its hole', () => {
    const b = bench();
    const before = b.leg.mesh.position.clone();
    // An eighth of the span: a quarter turn, so the twist shows.
    b.assembly.apply(b.inLeg.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    // Flipped, its hole faces down and the leg advances along it: down the stud.
    expect(b.leg.mesh.position.y).toBeCloseTo(before.y - SINK / 8, 9);
    expect(b.leg.mesh.quaternion.angleTo(new THREE.Quaternion(...FLIPPED))).toBeGreaterThan(0);
  });
});

// Four legs standing on the floor, a stud driven into each, and the top dropped onto them
// (review: a part set onto several studs carries several hand joints).
function tableBench({ top: topAt = 0.445 } = {}) {
  const spots: [number, number][] = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
  const legs = spots.map(([x, z], i) => makePart(`leg-${i + 1}`, 'leg', [x, 0.2, z]));
  // Each stud sunk home in its leg's top face: centred on the leg's mouth, a sink down.
  const studs = spots.map(([x, z], i) => makePart(`doubleEndedStud-${i + 1}`, 'doubleEndedStud', [x, 0.4, z]));
  const top = makePart('top-1', 'top', [0, topAt, 0]);
  const m = mount([...legs, ...studs, top], [0, 1.4, 0.9]);
  for (let i = 0; i < 4; i++) {
    const inLeg = m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 1, partB: `leg-${i + 1}`, connectorB: 0, mover: `doubleEndedStud-${i + 1}` });
    m.assembly.drive(inLeg.id);
  }
  const onTop = [0, 1, 2, 3].map((i) => m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 0, partB: 'top-1', connectorB: i, mover: 'top-1' }));
  const progresses = () => onTop.map((j) => m.assembly.get(j.id)!.fastener.progress);
  const hole = connectorInWorld(PART_TYPES.top.connectors[0], { position: [0, topAt, 0], rotation: [0, 0, 0, 1] }).position;
  return { ...m, top, onTop, progresses, hole };
}

describe('a top set onto four studs', () => {
  it('turns every stud together from one circle, with one dial and one set of ratchet clicks', () => {
    const b = tableBench();
    expect(b.assembly.handTargets('top-1')).toHaveLength(4);
    b.hold(1);
    expect(b.dials.at(-1)).toHaveLength(1);
    // Counter-clockwise tightens: the studs point up into the top, seen from above.
    b.circle(b.screen(b.top.mesh.position), b.hole, -120, 0, TURN_RING.radius);
    const [first, ...rest] = b.progresses();
    expect(first).toBeGreaterThan(0);
    for (const p of rest) expect(p).toBeCloseTo(first, 9);
    // Clicks are the one joint's, not four times over.
    const single = b.ratchet.reduce((sum, n) => sum + n, 0);
    expect(single).toBe(Math.floor((first * FASTENER.studRadians) / FASTENER.ratchetRadians + 1e-9));
  });

  it('drives them all home on a still press, then lets none back out', () => {
    const b = tableBench();
    const at = b.screen(b.top.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.hold(TAP_FRAMES + DRIVE_FRAMES);
    expect(b.progresses()).toEqual([1, 1, 1, 1]);
    expect(b.fastens()).toHaveLength(4);
    b.canvas.fire('pointerup', at);
  });

  it('lifts the top off all four on a tap at zero', () => {
    const b = tableBench();
    b.tap(b.screen(b.top.mesh.position));
    expect(b.assembly.handTargets('top-1')).toEqual([]);
    expect(b.assembly.all().filter((j) => j.host === 'top-1')).toEqual([]);
  });
});

describe("a press on a leg lying in a neighbour's ring (review)", () => {
  // Two legs set onto their studs in the top's first two holes, the camera far enough off
  // that one leg's centre falls inside the other's grab band.
  function pair(cameraAt: Vec3) {
    const top = makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation);
    const spots = [0, 1].map((i) => connectorInWorld(PART_TYPES.top.connectors[i], TOP_POSE).position);
    const studs = spots.map((at, i) => makePart(`doubleEndedStud-${i + 1}`, 'doubleEndedStud', [at[0], at[1] + STUD_HALF - SINK, at[2]], FLIPPED));
    const legs = spots.map((at, i) => makePart(`leg-${i + 1}`, 'leg', [at[0], at[1] + 2 * STUD_HALF - SINK + LEG_HALF, at[2]], FLIPPED));
    const m = mount([top, ...studs, ...legs], cameraAt);
    for (let i = 0; i < 2; i++) {
      const inTop = m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 0, partB: 'top-1', connectorB: i, mover: `doubleEndedStud-${i + 1}` });
      m.assembly.drive(inTop.id);
      m.assembly.seat({ partA: `doubleEndedStud-${i + 1}`, connectorA: 1, partB: `leg-${i + 1}`, connectorB: 0, mover: `leg-${i + 1}` });
    }
    return { ...m, legs, studs, spots };
  }

  it("is that leg's own circle, not the neighbour dial's", () => {
    const b = pair([0, 7, 5]);
    // Precondition: leg 2's middle really is in leg 1's ring band — the case the finding names.
    const head = b.screen([b.spots[0][0], b.spots[0][1] + 2 * STUD_HALF - SINK, b.spots[0][2]]);
    const press = b.screen(b.legs[1].mesh.position);
    const gap = Math.hypot(press.clientX - head.clientX, press.clientY - head.clientY);
    expect(Math.abs(gap - TURN_RING.radius)).toBeLessThanOrEqual(TURN_RING.band);
    b.canvas.fire('pointerdown', press);
    b.canvas.fire('pointermove', { clientX: press.clientX + 30, clientY: press.clientY + 30 });
    expect(b.router.dragging).toMatchObject({ mode: 'crank' });
    expect(b.router.dragging!.part.id).toBe('leg-2');
    b.canvas.fire('pointerup', press);
  });
});

describe('JOHNNY has no hand-turned part', () => {
  it('never gives a part a hand target: bolts are turned by their wrench, panel dragged on or not', () => {
    setItem('johnny');
    try {
      const m = mount([makePart('sidePanel-1', 'sidePanel', [0, 0.008, 0]), makePart('camLockBolt-1', 'camLockBolt', [0.1, 0.1, 0])]);
      m.assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: 'sidePanel-1', connectorB: 2, mover: 'sidePanel-1' });
      expect(m.assembly.handTarget('sidePanel-1')).toBeNull();
      expect(m.assembly.handTarget('camLockBolt-1')).toBeNull();
    } finally {
      setItem('blank');
    }
  });
});
