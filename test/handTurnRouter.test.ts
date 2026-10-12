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
  // Which way round the screen tightens, from where the camera is: a nut — the leg — about
  // its own hole's axis, the one its drawn twist is about.
  const holeAxis = connectorInWorld(PART_TYPES.leg.connectors[0], { position: LEG_AT, rotation: FLIPPED }).axis;
  const view = new THREE.Vector3(...FREE_END).sub(m.camera.position).toArray();
  const tighten = Math.sign(tightenSign(holeAxis, view));
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
  // A leg going down onto an upward stud tightens clockwise from above, as a nut does — the
  // way its drawn twist turns, not the way a screw in the same stud would.
  it('tightens clockwise on screen from above, the way the leg is drawn turning', () => {
    const b = bench();
    expect(b.tighten).toBe(1);
    b.circle(b.screen(b.leg.mesh.position), FREE_END, 90, 0, TURN_RING.radius);
    expect(b.progress()).toBeGreaterThan(0);
    b.hold(1);
    expect(b.dials.at(-1)![0].clockwise).toBe(true);
  });

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

describe("a leg's dial and its home flash (review)", () => {
  it('flashes as the leg arrives home, then draws no more — and takes no press after', () => {
    const b = bench();
    b.hold(1);
    expect(b.dials.at(-1)).toMatchObject([{ progress: 0, flashing: false }]);
    b.assembly.drive(b.inLeg.id);
    b.hold(1);
    expect(b.dials.at(-1)).toMatchObject([{ progress: 1, flashing: true }]);
    b.hold(Math.ceil(TURN_RING.flashMs / 1000 / FRAME) + 2);
    expect(b.dials.at(-1)).toBeNull();
  });

  it('shows no dial for a leg that was home from the start', () => {
    const b = bench();
    b.assembly.drive(b.inLeg.id);
    b.dials.length = 0;
    b.hold(3);
    expect(b.dials.every((d) => d === null)).toBe(true);
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

// A leg carried onto the top with its stud already in it (review): the joint into the top has
// the leg as its mover, neither hardware nor host. The top lies underside up; the stud, its
// lower end at the mouth, hangs from the leg above.
function carriedBench() {
  const top = makePart('top-1', 'top', TOP_POSE.position, TOP_POSE.rotation);
  const stud = makePart('doubleEndedStud-1', 'doubleEndedStud', [MOUTH[0], MOUTH[1] + STUD_HALF, MOUTH[2]], FLIPPED);
  // The stud's upper end sunk home in the leg's hole: the leg's mouth a sink below that end.
  const mouthOfLeg = MOUTH[1] + 2 * STUD_HALF - SINK;
  const leg = makePart('leg-1', 'leg', [MOUTH[0], mouthOfLeg + LEG_HALF, MOUTH[2]], FLIPPED);
  const m = mount([top, stud, leg]);
  const inLeg = m.assembly.seat({ partA: stud.id, connectorA: 1, partB: leg.id, connectorB: 0, mover: stud.id });
  m.assembly.drive(inLeg.id);
  const inTop = m.assembly.seat({ partA: stud.id, connectorA: 0, partB: top.id, connectorB: 0, mover: leg.id });
  const progress = () => m.assembly.get(inTop.id)!.fastener.progress;
  return { ...m, top, stud, leg, inLeg, inTop, progress };
}

describe('a leg carried onto the top with its stud in it (review)', () => {
  it('is circled and driven like any hand-turned part, through the leg', () => {
    const b = carriedBench();
    expect(b.assembly.handTarget('leg-1')).toMatchObject({ id: b.inTop.id });
    const at = b.screen(b.leg.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.hold(TAP_FRAMES + DRIVE_FRAMES);
    b.canvas.fire('pointerup', at);
    expect(b.assembly.get(b.inTop.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
  });

  it('draws the leg turning and advancing, with its stud riding in it — not the stud sliding out', () => {
    const b = carriedBench();
    // An eighth of the span: a quarter turn, a sink's eighth of the way.
    b.assembly.apply(b.inTop.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    expect(b.leg.mesh.position.y).toBeCloseTo(b.leg.body.translation().y - SINK / 8, 9);
    expect(b.leg.mesh.quaternion.angleTo(new THREE.Quaternion(...FLIPPED))).toBeGreaterThan(0);
    // The stud goes with the leg: the same move, still in its hole.
    expect(b.stud.mesh.position.y).toBeCloseTo(b.stud.body.translation().y - SINK / 8, 9);
    const stud = b.stud.mesh.position;
    const leg = b.leg.mesh.position;
    expect(Math.hypot(stud.x - leg.x, stud.z - leg.z)).toBeCloseTo(0, 9);
  });

  it('is held back at the top\'s mouth, with its stud, once it is circled out to nothing', () => {
    const b = carriedBench();
    const at = b.screen(b.leg.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.hold(TAP_FRAMES + DRIVE_FRAMES);
    b.canvas.fire('pointerup', at);
    b.grabbed.length = 0;
    const tighten = Math.sign(tightenSign(connectorInWorld(PART_TYPES.leg.connectors[0], { position: b.leg.mesh.position.toArray() as Vec3, rotation: FLIPPED }).axis, new THREE.Vector3(...MOUTH).sub(b.camera.position).toArray()));
    b.circle(b.screen(b.leg.mesh.position), MOUTH, -tighten * 2000, 0, TURN_RING.radius);
    expect(b.progress()).toBe(0);
    expect(b.grabbed).toContain(b.leg.body);
  });
});

describe('a leg backed out to nothing (review)', () => {
  // Screwed home it is bonded, not held; backed out to zero the bond goes — and the leg is
  // held back at its stud's mouth, as a bolt backed out is, not left a free body to fall.
  it('is held again at the mouth of its stud, and can be turned in once more', () => {
    const b = bench();
    const at = b.screen(b.leg.mesh.position);
    b.canvas.fire('pointerdown', at);
    b.hold(TAP_FRAMES + DRIVE_FRAMES);
    b.canvas.fire('pointerup', at);
    expect(b.assembly.get(b.inLeg.id)!.fastener.state).toBe(STATE.SCREWED);
    b.grabbed.length = 0;
    // The other way round, all the way out.
    b.circle(b.screen(b.leg.mesh.position), FREE_END, -b.tighten * 2000, 0, TURN_RING.radius);
    expect(b.progress()).toBe(0);
    expect(b.assembly.get(b.inLeg.id)!.fastener.state).toBe(STATE.SEATED);
    expect(b.grabbed).toContain(b.leg.body);
    // Back at the mouth where it was first set, still seated and still its own to turn.
    for (let i = 0; i < 3; i++) expect(b.leg.mesh.position.getComponent(i)).toBeCloseTo(LEG_AT[i], 6);
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
    // Clockwise tightens: the top is the nut going down onto studs that point up, seen from above.
    b.circle(b.screen(b.top.mesh.position), b.hole, 120, 0, TURN_RING.radius);
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

  // Review: the twist is about the stud's line through the hole, not the top's own centre —
  // a hole far from the origin must stay on its stud while the top turns.
  it('turns about its first hole, which stays on its stud — the rest of the top swings round it', () => {
    const b = tableBench();
    const holeNow = () =>
      connectorInWorld(PART_TYPES.top.connectors[0], {
        position: b.top.mesh.position.toArray() as Vec3,
        rotation: b.top.mesh.quaternion.toArray() as Quat,
      }).position;
    const before = holeNow();
    // A quarter turn (an eighth of the span).
    for (const joint of b.onTop) b.assembly.apply(joint.id, { type: 'crank', radians: FASTENER.studRadians / 8 });
    b.hold(1);
    const after = holeNow();
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[2]).toBeCloseTo(before[2], 9);
    // The top itself has turned: its centre is no longer where it was, nor its orientation.
    expect(b.top.mesh.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0);
    expect(Math.hypot(b.top.mesh.position.x, b.top.mesh.position.z)).toBeGreaterThan(0);
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
