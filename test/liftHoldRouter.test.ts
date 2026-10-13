import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GESTURE } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { connectorInWorld, rotateVector } from '../tools/validate/lib/geometry.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createLiftHold, liftRangeOf, ownReach } from '../src/scene/liftHold.js';
import { PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { GestureRouterOptions } from '../src/scene/gestureRouter.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The real gesture router dragging the part the elevation line holds (1.8.1 review round 1):
// the drag rides at the line's height, so a seat is offered only where the part really is,
// and letting go of the line mid-drag leaves the part where the line had it. The router
// reads the hold only through its `{ held, height }` view; this stands one in.

const SIZE = 1000;
type FakeListener = (event: object) => void;

class FakeCanvas {
  listeners = new Map<string, FakeListener>();
  options = new Map<string, unknown>();
  addEventListener(type: string, fn: FakeListener, options?: unknown) {
    this.listeners.set(type, fn);
    this.options.set(type, options);
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: SIZE, height: SIZE };
  }
  setPointerCapture() {}
  fire(type: string, init: object) {
    this.listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...init });
  }
}

const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

// A part whose body reports its mesh's pose; moves land on the mesh, as a step would.
function makePart(id: string, type: string, position: Vec3, rotation: Quat = [0, 0, 0, 1]): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.quaternion.set(...rotation);
  mesh.updateMatrixWorld(true);
  const body = {
    id,
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only reports its pose.
  return { id, type, mesh, body } as unknown as Part;
}

function harness({ joined = false } = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  // A side panel lying flat, its holes facing up; a loose dowel standing beside hole 3.
  // `joined`: the bottom panel pushed home on a dowel pushed home in its hole 0 (1.8.3.4).
  const panel = makePart('panel', 'sidePanel', [0, 0.008, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  const dowel = makePart('dowel', 'dowel', [0.05, 0.031, -0.11]);
  const joiner = makePart('joiner', 'dowel', [0.942, 0.031, -0.09]);
  const bottom = makePart('bottom', 'topBottomPanel', [0.942, 0.43, 0], [0, 0, -Math.SQRT1_2, Math.SQRT1_2]);
  const parts = [panel, dowel, ...(joined ? [joiner, bottom] : [])];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  if (joined) {
    assembly.drive(assembly.seat({ partA: joiner.id, connectorA: 0, partB: panel.id, connectorB: 0, mover: joiner.id }).id);
    assembly.drive(assembly.seat({ partA: bottom.id, connectorA: 3, partB: joiner.id, connectorB: 1, mover: bottom.id }).id);
  }

  const moves: Vec3[] = [];
  const physics: GestureRouterOptions['physics'] = {
    grab: () => {},
    move: (body: Body, position: Vec3) => {
      moves.push(position);
      const { mesh } = parts.find((part) => part.body === body)!;
      mesh.position.set(...position);
      mesh.updateMatrixWorld(true);
    },
    release: () => {},
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  };
  const offers: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));

  const targets: number[] = [];
  const jumps: number[] = [];
  const hold = {
    held: null as Part | null,
    height: 0,
    goal: 0,
    target: (height: number) => targets.push((hold.goal = height)),
    jump: (height: number) => jumps.push((hold.goal = hold.height = height)),
  };
  const canvas = new FakeCanvas();
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics,
    parts,
    assembly,
    events,
    hold,
  });
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // Pressed on the dowel and dragged toward the hole, still held.
  function dragDowel() {
    const at = screen([0.05, 0.031, -0.11]);
    canvas.fire('pointerdown', at);
    for (let i = 1; i <= 4; i++) canvas.fire('pointermove', { clientX: at.clientX - i * 8, clientY: at.clientY });
    return { clientX: at.clientX - 32, clientY: at.clientY };
  }
  const offered = () => offers.at(-1)?.target ?? null;
  return { router, canvas, hold, panel, dowel, bottom, moves, targets, jumps, dragDowel, offered };
}

describe('a drag of the held part rides at the line height (review round 1)', () => {
  it('offers the hole at the drag height without a hold — the fixture works', () => {
    const { dragDowel, offered } = harness();
    dragDowel();
    expect(offered()).toBe('panel');
  });

  it('withdraws the offer once the line lifts the part well clear of the hole', () => {
    const { router, hold, dowel, dragDowel, offered } = harness();
    dragDowel();
    hold.held = dowel;
    hold.height = 0.6;
    router.update(0);
    expect(offered()).toBeNull();
  });

  it('rides at the line height and keeps it, straight up, after the line lets go', () => {
    const { router, canvas, hold, dowel, moves, dragDowel, offered } = harness();
    const start = dragDowel();
    // Off the seat first, so the part is exactly where the finger puts it.
    const at = { clientX: start.clientX + 200, clientY: start.clientY };
    canvas.fire('pointermove', at);
    expect(offered()).toBeNull();
    const [x, , z] = moves.at(-1)!;
    hold.held = dowel;
    hold.height = 0.6;
    router.update(0);
    expect(moves.at(-1)![1]).toBeCloseTo(0.6, 9);
    expect(moves.at(-1)![0]).toBeCloseTo(x, 9);
    expect(moves.at(-1)![2]).toBeCloseTo(z, 9);
    // The line finger lifts; the drag finger moves on.
    hold.held = null;
    canvas.fire('pointermove', { clientX: at.clientX + 10, clientY: at.clientY });
    router.update(0);
    expect(moves.at(-1)![1]).toBeCloseTo(0.6, 9);
  });

  // Review round 2: seat assist moves y through the line, once per offer.
  it('eases the line to the seat height when a seat comes on offer for the held part', () => {
    const { router, hold, dowel, targets, dragDowel, offered } = harness();
    hold.held = dowel;
    hold.height = 0.061;
    dragDowel();
    expect(offered()).toBe('panel');
    // The dowel's end in the hole: its centre stands half its length above the hole.
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBeCloseTo(0.016 + PART_TYPES.dowel.size[1] / 2, 3);
    router.update(0);
    expect(targets).toHaveLength(1);
  });

  it('never retargets the line for a part it does not hold', () => {
    const { targets, dragDowel, offered } = harness();
    dragDowel();
    expect(offered()).toBe('panel');
    expect(targets).toEqual([]);
  });

  // Review round 3: the grab is re-anchored on where the finger puts the part, so seat
  // assist's pull is never baked into it.
  it('keeps the grab where the finger had it after assist and a hold change, once the finger moves off', () => {
    const run = (assistFor: number) => {
      const { router, canvas, hold, dowel, moves, dragDowel } = harness();
      const at = dragDowel();
      for (let i = 0; i < 10; i++) router.update(assistFor);
      hold.held = dowel;
      hold.height = 0.3;
      router.update(assistFor);
      canvas.fire('pointermove', { clientX: at.clientX + 200, clientY: at.clientY + 100 });
      return moves.at(-1)!;
    };
    const unassisted = run(0);
    const assisted = run(0.05);
    expect(assisted[0]).toBeCloseTo(unassisted[0], 9);
    expect(assisted[2]).toBeCloseTo(unassisted[2], 9);
    expect(assisted[1]).toBeCloseTo(0.3, 9);
  });

  // Review round 4: a seat on a part the line holds would be left floating when it drops.
  it('offers no seat on a part the line holds up', () => {
    const { hold, panel, dragDowel, offered } = harness();
    hold.held = panel;
    hold.height = 0.008;
    dragDowel();
    expect(offered()).toBeNull();
  });

  // Review round 1 (1.8.3.4): the line holding one panel of an assembly holds it all up.
  it('offers no seat on any part of an assembly the line holds up by another of its panels', () => {
    const h = harness({ joined: true });
    expect(h.router.carries(h.bottom)).toBe(true);
    h.hold.held = h.bottom;
    h.dragDowel();
    expect(h.offered()).toBeNull();
  });

  it('still offers the seat when the line holds nothing — the joined fixture works', () => {
    const { dragDowel, offered } = harness({ joined: true });
    dragDowel();
    expect(offered()).toBe('panel');
  });

  it('leaves a drag of any other part alone', () => {
    const { router, hold, moves, dragDowel } = harness();
    dragDowel();
    hold.held = makePart('other', 'dowel', [1, 0.015, 1]);
    hold.height = 0.6;
    router.update(0);
    expect(moves.every(([, y]) => y < 0.1)).toBe(true);
  });

  // Ben's manual pass (2026-10-09): a lift of the held part moves the line with it — else
  // the line's height pulls it straight back down. (A Shift-drag no longer lifts: 1.8.3.3.)
  it.each([
    ['the wheel', 'wheel'],
    ['a second finger', 'finger'],
  ])('a lift of the held part by %s carries the line up with it', (_, by) => {
    const { router, canvas, hold, dowel, moves, jumps, dragDowel } = harness();
    dragDowel();
    hold.held = dowel;
    hold.height = 0.3;
    router.update(0);
    if (by === 'wheel') {
      canvas.fire('wheel', { deltaY: -120 });
    } else {
      canvas.fire('pointerdown', { pointerId: 2, clientX: 900, clientY: 800 });
      canvas.fire('pointermove', { pointerId: 2, clientX: 900, clientY: 680 });
    }
    router.update(0);
    expect(jumps.length).toBeGreaterThan(0);
    expect(hold.height).toBeGreaterThan(0.35);
    expect(moves.at(-1)![1]).toBeCloseTo(hold.height, 9);
  });

  // Review round 6: under a Shift hold there is no line finger to win the height back.
  it('puts the line back where it was once the seat is no longer on offer', () => {
    const { canvas, hold, dowel, targets, dragDowel, offered } = harness();
    hold.held = dowel;
    hold.height = 0.061;
    hold.goal = 0.5;
    const at = dragDowel();
    expect(offered()).toBe('panel');
    expect(hold.goal).not.toBe(0.5);
    canvas.fire('pointermove', { clientX: at.clientX + 200, clientY: at.clientY });
    expect(offered()).toBeNull();
    expect(targets).toHaveLength(2);
    expect(hold.goal).toBe(0.5);
  });

  it('leaves the line where the finger moved it during the offer', () => {
    const { canvas, hold, dowel, targets, dragDowel, offered } = harness();
    hold.held = dowel;
    hold.height = 0.061;
    hold.goal = 0.5;
    const at = dragDowel();
    expect(offered()).toBe('panel');
    hold.goal = 0.9; // the line finger moved
    canvas.fire('pointermove', { clientX: at.clientX + 200, clientY: at.clientY });
    expect(offered()).toBeNull();
    expect(targets).toHaveLength(1);
    expect(hold.goal).toBe(0.9);
  });

  // Review round 8: a hold that starts with a seat already on offer pulls the line there
  // too, or the part hovers short of the seat and jumps in on release.
  it('pulls the line to the seat when the hold starts with one already on offer — each time', () => {
    const { router, hold, dowel, targets, dragDowel, offered } = harness();
    dragDowel();
    expect(offered()).toBe('panel');
    for (let i = 0; i < 5; i++) router.update(0.05); // assist pulls it partway
    const seatY = 0.016 + PART_TYPES.dowel.size[1] / 2;
    hold.held = dowel;
    hold.goal = hold.height = dowel.mesh.position.y;
    router.update(0);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBeCloseTo(seatY, 3);
    router.update(0);
    expect(targets).toHaveLength(1);
    // The hold ends and starts again over the same offer.
    hold.held = null;
    router.update(0);
    hold.held = dowel;
    hold.goal = hold.height = dowel.mesh.position.y;
    router.update(0);
    expect(targets).toHaveLength(2);
    expect(targets[1]).toBeCloseTo(seatY, 3);
  });
});

// 1.8.3.4 Step 4: a selected panel of a joined assembly gets the line, and holding it up
// carries the whole assembly — the dowel only seated in it too. The real hold over the real
// compound seam, wired as main.ts wires them; the simulation is a stub that lands every move.
const FLAT_SIDE: Pose = { position: [0, 0.008, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }; // holes up
const DOWN: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2]; // the bottom panel's holes 3 and 4 facing down
const FRAME = 1 / 60;
const holeAt = (index: number) => connectorInWorld(PART_TYPES.sidePanel.connectors[index], FLAT_SIDE);
const standing = (index: number, by: number): Vec3 => holeAt(index).position.map((v, i) => v + (i === 1 ? by : 0)) as Vec3;

// A side panel lying flat; a dowel pushed home in its hole 3 and the bottom panel pushed home
// on it, standing up (one assembly); a dowel seated only in its hole 4. `extra` parts lie aside.
// `joined: false`: the side panel alone with the dowel seated in it — a single panel carrying its dowel.
function assemblyHarness(extra: Part[] = [], { joined = true } = {}) {
  const dowelHalf = PART_TYPES.dowel.size[1] / 2;
  const side = makePart('sidePanel-1', 'sidePanel', FLAT_SIDE.position, FLAT_SIDE.rotation);
  const joiner = makePart('dowel-1', 'dowel', standing(3, dowelHalf));
  const hole3 = rotateVector(DOWN, PART_TYPES.topBottomPanel.connectors[3].position);
  const bottom = makePart('topBottomPanel-1', 'topBottomPanel', standing(3, 2 * dowelHalf).map((v, i) => v - hole3[i]) as Vec3, DOWN);
  const loose = makePart('dowel-2', 'dowel', standing(4, dowelHalf));
  const parts = [side, ...(joined ? [joiner, bottom] : []), loose, ...extra];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  if (joined) {
    assembly.drive(assembly.seat({ partA: joiner.id, connectorA: 0, partB: side.id, connectorB: 3, mover: joiner.id }).id);
    assembly.drive(assembly.seat({ partA: bottom.id, connectorA: 3, partB: joiner.id, connectorB: 1, mover: bottom.id }).id);
  }
  assembly.seat({ partA: loose.id, connectorA: 0, partB: side.id, connectorB: 4, mover: loose.id });

  // Bodies under direct control: grabbed, not since released.
  const kinematic = new Set<Body>();
  for (const part of parts) Object.assign(part.body, { isKinematic: () => kinematic.has(part.body) });
  const simulation = {
    grab: (body: Body) => kinematic.add(body),
    move: (body: Body, position: Vec3, rotation?: Quat) => {
      const { mesh } = parts.find((part) => part.body === body)!;
      mesh.position.set(...position);
      if (rotation) mesh.quaternion.set(...rotation);
      mesh.updateMatrixWorld(true);
    },
    release: (body: Body) => kinematic.delete(body),
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  };
  // A fake: the seams only call what the router and the hold do.
  const line = createLiftHold(createCompoundPhysics(simulation as unknown as PhysicsWorld, parts, assembly));
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  const router = createGestureRouter({
    domElement: new FakeCanvas() as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics: line,
    parts,
    assembly,
    hold: line,
  });
  router.sync();
  line.measure(router.verticalReachOf);
  // A frame as main.ts runs one: the hold eases, the simulation steps (a stub), the router follows.
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      line.update(FRAME);
      router.update(FRAME);
    }
  };
  const held = (part: Part) => kinematic.has(part.body);
  return { router, line, assembly, side, joiner, bottom, loose, frames, held, members: joined ? [joiner, bottom, loose] : [loose] };
}

describe('the line for a selected assembly (1.8.3.4 Step 4)', () => {
  it('carries a selected panel of a free-standing joined pair, whichever panel', () => {
    const h = assemblyHarness();
    expect(h.router.carries(h.side)).toBe(true);
    expect(h.router.carries(h.bottom)).toBe(true);
  });

  it('never carries hardware, a bare panel, or a panel with a tool on its assembly', () => {
    const bare = makePart('fixedShelf-1', 'fixedShelf', [1, 0.008, 1]);
    const bolt = makePart('camLockBolt-1', 'camLockBolt', standing(6, PART_TYPES.camLockBolt.size[1] / 2));
    const key = makePart('allenWrench-1', 'allenWrench', [0.5, 0.002, 0.5]);
    const h = assemblyHarness([bare, bolt, key]);
    expect(h.router.carries(h.joiner)).toBe(false);
    expect(h.router.carries(bare)).toBe(false);
    h.assembly.drive(h.assembly.seat({ partA: bolt.id, connectorA: 0, partB: h.side.id, connectorB: 6, mover: bolt.id }).id);
    expect(h.router.carries(h.side)).toBe(true);
    h.assembly.seat({ partA: key.id, connectorA: 0, partB: bolt.id, connectorB: 1, mover: key.id });
    expect(h.router.carries(h.side)).toBe(false);
  });

  it('never carries an assembly sitting in a seat outside itself', () => {
    // A dowel pushed home in a shelf lying aside, the bottom panel's free hole seated on it.
    const shelf = makePart('fixedShelf-1', 'fixedShelf', [1, 0.008, 1]);
    const other = makePart('dowel-9', 'dowel', [1, 0.03, 1]);
    const h = assemblyHarness([shelf, other]);
    h.assembly.drive(h.assembly.seat({ partA: other.id, connectorA: 0, partB: shelf.id, connectorB: 0, mover: other.id }).id);
    h.assembly.seat({ partA: h.bottom.id, connectorA: 4, partB: other.id, connectorB: 1, mover: h.bottom.id });
    expect(h.router.carries(h.side)).toBe(false);
  });

  // Review round 1: the reach is the box on whichever side it lies — the bottom panel stands
  // above the side panel, never below it.
  it("measures the line's range by the whole assembly's reach, on whichever side it lies", () => {
    const h = assemblyHarness();
    const [min, max] = liftRangeOf(h.side, FLAT_SIDE.rotation, h.router.verticalReachOf);
    const [, ownMax] = liftRangeOf(h.side, FLAT_SIDE.rotation, ownReach);
    // Lying on the floor already: the floor is where it lies.
    expect(min).toBeCloseTo(FLAT_SIDE.position[1], 9);
    // The bottom panel standing on it comes off the ceiling.
    expect(ownMax - max).toBeGreaterThan(PART_TYPES.topBottomPanel.size[0]);
    // Held by the bottom panel: its floor is where it stands, on the side panel.
    const [bottomMin] = liftRangeOf(h.bottom, h.bottom.mesh.quaternion.toArray(), h.router.verticalReachOf);
    expect(bottomMin).toBeCloseTo(h.bottom.mesh.position.y, 9);
  });

  // Review round 1: an assembly taken up where it lies stays there — no jump on the first frame.
  it.each([['side panel', 'side'], ['bottom panel', 'bottom']] as const)('holds a pair taken up by its %s where it lies', (_, by) => {
    const h = assemblyHarness();
    const part = by === 'side' ? h.side : h.bottom;
    const before = [h.side, ...h.members].map((p) => p.mesh.position.y);
    h.line.begin(part, 'line');
    h.line.target(part.mesh.position.y);
    h.frames(1);
    [h.side, ...h.members].forEach((p, n) => expect(p.mesh.position.y, p.id).toBeCloseTo(before[n], 9));
  });

  it('raises every member together on the line, the dowel only seated in it included', () => {
    const h = assemblyHarness();
    const before = [h.side, ...h.members].map((part) => part.mesh.position.y);
    h.line.begin(h.side, 'line');
    h.line.target(h.side.mesh.position.y + 0.4);
    h.frames(240);
    const rise = h.side.mesh.position.y - before[0];
    expect(rise).toBeGreaterThan(0.3);
    [h.side, ...h.members].forEach((part, n) => expect(part.mesh.position.y - before[n], part.id).toBeCloseTo(rise, 6));
    // Nothing came out of it.
    expect(h.assembly.all()).toHaveLength(3);
  });

  it('lets it all go as one when the line does, the seated dowel still riding in its panel', () => {
    const h = assemblyHarness();
    h.line.begin(h.side, 'line');
    h.line.target(h.side.mesh.position.y + 0.4);
    h.frames(60);
    for (const part of [h.side, h.joiner, h.bottom]) expect(h.held(part), part.id).toBe(true);
    h.line.end('line');
    h.router.update(FRAME);
    for (const part of [h.side, h.joiner, h.bottom]) expect(h.held(part), part.id).toBe(false);
    // The simulation drops the side panel: the dowel only seated in it goes with it.
    const gap = h.loose.mesh.position.y - h.side.mesh.position.y;
    h.side.mesh.position.y -= 0.2;
    h.router.update(FRAME);
    expect(h.loose.mesh.position.y - h.side.mesh.position.y).toBeCloseTo(gap, 9);
  });
});

// Test plan (1.8.3.4): the same gap closed for a single panel holding a dowel.
describe('the line for a selected panel holding its dowel (1.8.3.4 test plan)', () => {
  it('carries it, and raises the dowel with it', () => {
    const h = assemblyHarness([], { joined: false });
    expect(h.router.carries(h.side)).toBe(true);
    const before = [h.side, h.loose].map((part) => part.mesh.position.y);
    h.line.begin(h.side, 'line');
    h.line.target(h.side.mesh.position.y + 0.3);
    h.frames(240);
    const rise = h.side.mesh.position.y - before[0];
    expect(rise).toBeGreaterThan(0.25);
    expect(h.loose.mesh.position.y - before[1]).toBeCloseTo(rise, 6);
  });
});

// 1.8.3.3: Shift + scroll sets the held part's height, with or without a drag, through the
// hold — and stops the wheel there, so OrbitControls (listening on the same canvas, after
// the router's capture listener) never zooms. Without Shift the wheel is as it was.
describe('Shift + scroll sets the held part\'s height', () => {
  // A wheel event as the browser hands it, recording whether the router stopped it.
  const wheel = (init: { deltaX?: number; deltaY?: number; shiftKey: boolean }) => ({
    deltaX: 0,
    deltaY: 0,
    ...init,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  });
  const stopped = (event: ReturnType<typeof wheel>) =>
    event.preventDefault.mock.calls.length > 0 && event.stopImmediatePropagation.mock.calls.length > 0;

  it('listens in the capture phase, ahead of the camera\'s own wheel listener', () => {
    const { canvas } = harness();
    expect(canvas.options.get('wheel')).toMatchObject({ capture: true, passive: false });
  });

  it('raises a selected, held part with no drag, and stops the event so the camera never zooms', () => {
    const { canvas, hold, dowel, jumps } = harness();
    hold.held = dowel;
    hold.height = 0.3;
    const event = wheel({ deltaY: -100, shiftKey: true });
    canvas.fire('wheel', event);
    expect(jumps).toEqual([0.3 + 100 * GESTURE.desktopLiftRate]);
    expect(stopped(event)).toBe(true);
    const down = wheel({ deltaY: 40, shiftKey: true });
    canvas.fire('wheel', down);
    expect(hold.height).toBeCloseTo(0.3 + 60 * GESTURE.desktopLiftRate, 12);
  });

  it('reads the sideways scroll macOS turns a Shift-scroll into', () => {
    const { canvas, hold, dowel } = harness();
    hold.held = dowel;
    hold.height = 0.3;
    canvas.fire('wheel', wheel({ deltaX: -100, shiftKey: true }));
    expect(hold.height).toBeCloseTo(0.3 + 100 * GESTURE.desktopLiftRate, 12);
  });

  it('raises the held part mid-drag, the drag riding up with it, and stops the event', () => {
    const { router, canvas, hold, dowel, moves, jumps, dragDowel } = harness();
    dragDowel();
    hold.held = dowel;
    hold.height = 0.3;
    router.update(0);
    const event = wheel({ deltaY: -100, shiftKey: true });
    canvas.fire('wheel', event);
    router.update(0);
    expect(jumps.length).toBeGreaterThan(0);
    expect(hold.height).toBeGreaterThan(0.35);
    expect(moves.at(-1)![1]).toBeCloseTo(hold.height, 9);
    expect(stopped(event)).toBe(true);
  });

  it('leaves the wheel to the camera without Shift, and with Shift when nothing is held', () => {
    const { canvas, hold, dowel, jumps } = harness();
    hold.held = dowel;
    hold.height = 0.3;
    const plain = wheel({ deltaY: -100, shiftKey: false });
    canvas.fire('wheel', plain);
    expect(jumps).toEqual([]);
    expect(hold.height).toBe(0.3);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    expect(plain.stopImmediatePropagation).not.toHaveBeenCalled();
    hold.held = null;
    const free = wheel({ deltaY: -100, shiftKey: true });
    canvas.fire('wheel', free);
    expect(jumps).toEqual([]);
    expect(free.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('still lifts a drag on a plain wheel, as before', () => {
    const { router, canvas, dowel, moves, dragDowel } = harness();
    dragDowel();
    const before = dowel.mesh.position.y;
    const event = wheel({ deltaY: -100, shiftKey: false });
    canvas.fire('wheel', event);
    router.update(0);
    expect(moves.at(-1)![1]).toBeGreaterThan(before);
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
