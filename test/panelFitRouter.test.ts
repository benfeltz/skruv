import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT, KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, rotateVector } from '../tools/validate/lib/geometry.js';
import { GESTURE, PANEL } from '../src/constants.js';
import { carryPose, createAssembly } from '../src/game/assembly.js';
import { isFastened } from '../src/game/fasteners.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { GestureRouterOptions } from '../src/scene/gestureRouter.js';
import type { TargetRing } from '../src/scene/targetRings.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The real gesture router carrying a panel onto its dowels (1.8.3.1), with the real catalog:
// a side panel lying flat, holes up, two dowels standing in its bottom dowel holes, and the
// bottom panel carried onto them, holes down.

const SIZE = 1000;
const DEG = Math.PI / 180;
const FRAME = 1 / 60;
type FakeListener = (event: object) => void;

class FakeCanvas {
  listeners = new Map<string, FakeListener>();
  addEventListener(type: string, fn: FakeListener) {
    this.listeners.set(type, fn);
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
function makePart(id: string, type: string, { position, rotation }: Pose): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.quaternion.set(...rotation);
  mesh.updateMatrixWorld(true);
  const body = {
    id,
    isKinematic: () => true,
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only reports its pose.
  return { id, type, mesh, body } as unknown as Part;
}

const IDENTITY: Quat = [0, 0, 0, 1];
const HALF_TURN_Z: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // the side panel's hole faces up
const SIDE: Pose = { position: [0, 0.008, 0], rotation: HALF_TURN_Z };
const DOWEL_HALF = PART_TYPES.dowel.size[1] / 2;
// The bottom panel standing on its edge, its right-hand holes (3 and 4) facing down.
const HOLES_DOWN: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];
const sideHole = (index: number) => connectorInWorld(PART_TYPES.sidePanel.connectors[index], SIDE);
// A dowel standing in side-panel hole `index`, seated at its mouth; and its free top end.
const dowelIn = (index: number): Pose => ({ position: sideHole(index).position.map((v, i) => v + (i === 1 ? DOWEL_HALF : 0)) as Vec3, rotation: IDENTITY });
const topOf = (index: number) => sideHole(index).position.map((v, i) => v + (i === 1 ? 2 * DOWEL_HALF : 0)) as Vec3;
// The bottom panel seated on both dowels: its hole 3 on the first, hole 4 on the second.
const SEAT: Pose = (() => {
  const offset = rotateVector(HOLES_DOWN, PART_TYPES.topBottomPanel.connectors[3].position);
  return { position: topOf(0).map((v, i) => v - offset[i]) as Vec3, rotation: HOLES_DOWN };
})();

/** `pose` turned `angle` about the vertical through `centre`, then moved by `shift`. */
function skewed(pose: Pose, angle: number, centre: Vec3, shift: Vec3 = [0, 0, 0]): Pose {
  const turn: Quat = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const arm = rotateVector(turn, pose.position.map((v, i) => v - centre[i]) as Vec3);
  return { position: arm.map((v, i) => v + centre[i] + shift[i]) as Vec3, rotation: multiplyQuaternions(turn, pose.rotation) };
}

// Picked up, a part rides GESTURE.hoverLift higher: start it that much lower.
const lowered = ({ position, rotation }: Pose): Pose => ({ position: [position[0], position[1] - GESTURE.hoverLift, position[2]], rotation });

const angleBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const poseOf = (part: Part): Pose => ({ position: part.mesh.position.toArray(), rotation: part.mesh.quaternion.toArray() });

interface Options {
  // Where the bottom panel starts (before pick-up); omitted, there is none.
  panelAt?: Pose;
  // Side-panel holes with a dowel standing in them.
  dowels?: number[];
  // Of those dowels (by position in `dowels`), the ones tapped home: a dowel sink lower, and fastened.
  home?: number[];
  extra?: { id: string; type: string; pose: Pose }[];
  // The bottom panel carries two dowels of its own in its holes 3 and 4, their free ends
  // down — pushed home in it (bonded) or only seated.
  carrying?: 'seated' | 'home';
}

function harness({ panelAt, dowels = [0, 1], home = [], extra = [], carrying }: Options = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0.9, 1.3, 1.1);
  camera.lookAt(0.9, 0.2, 0);
  camera.updateMatrixWorld(true);

  const side = makePart('sidePanel-1', 'sidePanel', SIDE);
  const dowelParts = dowels.map((index, n) => {
    const { position, rotation } = dowelIn(index);
    const sink = home.includes(n) ? CONTRACT.sinkDepth.dowel! : 0;
    return makePart(`dowel-${n + 1}`, 'dowel', { position: [position[0], position[1] - sink, position[2]], rotation });
  });
  const panel = panelAt ? makePart('topBottomPanel-1', 'topBottomPanel', panelAt) : null;
  const carriedParts = panel && carrying ? CARRIED.map((at, n) => makePart(`dowel-${11 + n}`, 'dowel', carryPose(SEAT, panelAt!, sunk(at, carrying === 'home')))) : [];
  const parts = [side, ...dowelParts, ...(panel ? [panel] : []), ...carriedParts, ...extra.map(({ id, type, pose }) => makePart(id, type, pose))];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  dowels.forEach((index, n) => {
    const joint = assembly.seat({ partA: `dowel-${n + 1}`, connectorA: 0, partB: side.id, connectorB: index, mover: `dowel-${n + 1}` });
    if (home.includes(n)) assembly.drive(joint.id);
  });
  carriedParts.forEach((dowel, n) => {
    const joint = assembly.seat({ partA: dowel.id, connectorA: 0, partB: panel!.id, connectorB: 3 + n, mover: dowel.id });
    if (carrying === 'home') assembly.drive(joint.id);
  });

  const simulation: GestureRouterOptions['physics'] = {
    grab: () => {},
    move: (body: Body, position: Vec3, rotation?: Quat) => {
      const { mesh } = parts.find((part) => part.body === body)!;
      mesh.position.set(...position);
      if (rotation) mesh.quaternion.set(...rotation);
      mesh.updateMatrixWorld(true);
    },
    release: () => {},
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  };
  // A fastened compound moves as one, as main.ts wires it. A fake: the seam only calls what the router does.
  const physics = createCompoundPhysics(simulation as unknown as PhysicsWorld, parts, assembly);
  const offers: StampedEvent[] = [];
  const seats: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  events.on(EVENT.SEAT, (event) => seats.push(event));
  const shown: TargetRing[][] = [];
  const targetRings = { show: (rings: readonly TargetRing[]) => shown.push([...rings]), hide: () => shown.push([]) };
  const ghosts: Pose[] = [];
  const ghost = { show: (_mesh: THREE.Mesh, pose: Pose) => ghosts.push({ position: [...pose.position], rotation: [...pose.rotation] }), hide() {} };

  const canvas = new FakeCanvas();
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics,
    parts,
    assembly,
    events,
    targetRings,
    ghost,
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  // The joints the setup made, as the game's would be: physics follows the graph.
  router.sync();
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // Pressed on a part and nudged past the tap distance, still held.
  function drag(part: Part, dx = 0, dy = 12) {
    const at = screen(part.mesh.position.toArray());
    canvas.fire('pointerdown', at);
    canvas.fire('pointermove', { clientX: at.clientX + dx / 2, clientY: at.clientY + dy / 2 });
    const to = { clientX: at.clientX + dx, clientY: at.clientY + dy };
    canvas.fire('pointermove', to);
    return to;
  }
  // Pressed and let go where it is: a tap.
  function tap(part: Part) {
    const at = screen(part.mesh.position.toArray());
    canvas.fire('pointerdown', at);
    canvas.fire('pointerup', at);
  }
  const offered = () => offers.at(-1)?.target ?? null;
  const hold = (frames: number) => {
    for (let i = 0; i < frames; i++) router.update(FRAME);
  };
  const jointsMovedBy = (part: Part) => assembly.all().filter((j) => j.mover === part.id);
  return { router, canvas, assembly, parts, side, dowels: dowelParts, carried: carriedParts, panel: panel!, drag, tap, hold, screen, offered, offers, seats, shown, ghosts, jointsMovedBy };
}

const TOPS = [topOf(0), topOf(1)];

// The bottom panel at SEAT carrying dowels in its holes 3 and 4, seated at their mouths:
// each dowel's free end down, on side-panel holes 0 and 1's mouths. (Their seated end goes
// up into the panel: a half turn about x.)
const CARRIED: Pose[] = [0, 1].map((index) => ({ position: sideHole(index).position.map((v, i) => v + (i === 1 ? DOWEL_HALF : 0)) as Vec3, rotation: [1, 0, 0, 0] }));
// A carried dowel pushed home in the panel sits a dowel sink further up into it.
const sunk = (pose: Pose, home: boolean): Pose => ({ ...pose, position: [pose.position[0], pose.position[1] + (home ? CONTRACT.sinkDepth.dowel! : 0), pose.position[2]] });

describe('a carried panel seats on every matched hole (1.8.3.1 Step 3)', () => {
  it('releases onto two seated dowels as two joints, the panel the mover, with two SEAT events', () => {
    const h = harness({ panelAt: lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) });
    const at = h.drag(h.panel);
    expect(h.router.dragging?.part).toBe(h.panel);
    expect(h.offered()).toBe('dowel-1');
    // The ghost shows the whole fit: the panel squarely on both dowels.
    const ghost = h.ghosts.at(-1)!;
    expect(gap(ghost.position, SEAT.position)).toBeLessThan(1e-6);
    expect(angleBetween(ghost.rotation, SEAT.rotation)).toBeLessThan(1e-6);
    h.canvas.fire('pointerup', at);
    const joints = h.jointsMovedBy(h.panel);
    expect(joints).toHaveLength(2);
    expect(new Set(joints.map((j) => j.hardware))).toEqual(new Set(['dowel-1', 'dowel-2']));
    expect(new Set(joints.map((j) => j.hostConnector))).toEqual(new Set([3, 4]));
    expect(h.seats.map((e) => e.host)).toEqual(['topBottomPanel-1', 'topBottomPanel-1']);
    expect(gap(h.panel.mesh.position.toArray(), SEAT.position)).toBeLessThan(1e-6);
  });

  // Review round 1: a dowel tapped home stands a sink lower than one only at its hole's mouth.
  it('seats both holes over one dowel pushed home and one not', () => {
    const h = harness({ home: [0], panelAt: lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) });
    expect(isFastened(h.assembly.all().find((j) => j.hardware === 'dowel-1')!.fastener)).toBe(true);
    h.canvas.fire('pointerup', h.drag(h.panel));
    const joints = h.jointsMovedBy(h.panel);
    expect(new Set(joints.map((j) => j.hardware))).toEqual(new Set(['dowel-1', 'dowel-2']));
    expect(h.seats).toHaveLength(2);
  });

  it('then a tap on the panel pushes both dowels home', () => {
    const h = harness({ panelAt: lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) });
    h.canvas.fire('pointerup', h.drag(h.panel));
    h.tap(h.panel);
    const joints = h.jointsMovedBy(h.panel);
    expect(joints).toHaveLength(2);
    for (const joint of joints) expect(isFastened(joint.fastener)).toBe(true);
  });

  it('seats a panel let go one hole off where it is put (a forced wrong fit)', () => {
    // Its hole 3 over the second dowel, where hole 4 belongs; where it goes is out of reach.
    const off = { ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2] + (TOPS[1][2] - TOPS[0][2])] as Vec3 };
    const h = harness({ panelAt: lowered(off) });
    h.canvas.fire('pointerup', h.drag(h.panel));
    const joints = h.jointsMovedBy(h.panel);
    expect(joints).toHaveLength(1);
    expect(joints[0].hardware).toBe('dowel-2');
    expect(joints[0].hostConnector).toBe(3);
  });

  it('offers a panel far from any dowel nothing', () => {
    const h = harness({ panelAt: lowered({ ...SEAT, position: [SEAT.position[0] - 0.4, SEAT.position[1] + 0.3, SEAT.position[2]] }) });
    const at = h.drag(h.panel);
    expect(h.router.dragging?.part).toBe(h.panel);
    expect(h.offered()).toBeNull();
    h.canvas.fire('pointerup', at);
    expect(h.jointsMovedBy(h.panel)).toEqual([]);
  });
});

describe('hardware and tools seat exactly as before (1.8.3.1 Step 3)', () => {
  // A free side-panel hole's mouth and axis.
  const mouth = (index: number) => sideHole(index);

  it('seats a dowel by one end in a free hole, the dowel the mover', () => {
    const hole = mouth(3);
    const h = harness({ dowels: [], extra: [{ id: 'dowel-9', type: 'dowel', pose: lowered({ position: [hole.position[0] + 0.01, hole.position[1] + 0.03, hole.position[2]], rotation: IDENTITY }) }] });
    const dowel = h.parts.at(-1)!;
    h.canvas.fire('pointerup', h.drag(dowel));
    const joints = h.jointsMovedBy(dowel);
    expect(joints).toHaveLength(1);
    expect(joints[0]).toMatchObject({ kind: KIND.DOWEL, host: 'sidePanel-1', hostConnector: 3 });
    expect(h.seats).toHaveLength(1);
    const end = connectorInWorld(PART_TYPES.dowel.connectors[joints[0].hardwareConnector], poseOf(dowel)).position;
    expect(gap(end, hole.position)).toBeLessThan(1e-9);
  });

  it('seats a cam bolt by its thread', () => {
    const hole = mouth(2);
    const h = harness({ dowels: [], extra: [{ id: 'camLockBolt-9', type: 'camLockBolt', pose: lowered({ position: [hole.position[0], hole.position[1] + 0.03, hole.position[2]], rotation: IDENTITY }) }] });
    const bolt = h.parts.at(-1)!;
    h.canvas.fire('pointerup', h.drag(bolt));
    const joints = h.jointsMovedBy(bolt);
    expect(joints).toHaveLength(1);
    expect(joints[0]).toMatchObject({ kind: KIND.BOLT, hostConnector: 2 });
  });

  it('seats an Allen key on a seated bolt', () => {
    const hole = mouth(2);
    const boltHalf = PART_TYPES.camLockBolt.size[1] / 2;
    const head: Vec3 = [hole.position[0], hole.position[1] + 2 * boltHalf, hole.position[2]];
    const tipDown: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const tip = rotateVector(tipDown, PART_TYPES.allenWrench.connectors[0].position);
    const h = harness({
      dowels: [],
      extra: [
        { id: 'camLockBolt-1', type: 'camLockBolt', pose: { position: [hole.position[0], hole.position[1] + boltHalf, hole.position[2]], rotation: IDENTITY } },
        { id: 'allenWrench-1', type: 'allenWrench', pose: lowered({ position: [head[0] - tip[0], head[1] - tip[1] + 0.02, head[2] - tip[2]], rotation: tipDown }) },
      ],
    });
    h.assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: 'sidePanel-1', connectorB: 2, mover: 'camLockBolt-1' });
    const key = h.parts.at(-1)!;
    h.canvas.fire('pointerup', h.drag(key));
    expect(h.assembly.all().filter((j) => j.kind === KIND.TOOL)).toHaveLength(1);
    expect(h.seats.at(-1)?.hardware).toBe('allenWrench-1');
  });
});

// `pose` tipped `angle` about the horizontal z line through its own centre.
function tipped(pose: Pose, angle: number): Pose {
  return { position: pose.position, rotation: multiplyQuaternions([0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], pose.rotation) };
}

describe('a carried panel turns toward where it goes (1.8.3.1 Step 4)', () => {
  // Over where it goes but tipped 30°: its holes swing ~19 cm off the dowels, and 30° off them.
  const TIPPED = lowered(tipped({ ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2]] }, 30 * DEG));

  it('turns a still panel, 30° off near where it goes, until the whole fit is on offer — the finger keeps its position', () => {
    const h = harness({ panelAt: TIPPED });
    const at = h.drag(h.panel);
    expect(h.offered()).toBeNull();
    const position = h.panel.mesh.position.toArray();
    const before = angleBetween(poseOf(h.panel).rotation, SEAT.rotation);
    h.hold(1);
    expect(angleBetween(poseOf(h.panel).rotation, SEAT.rotation)).toBeLessThan(before);
    expect(h.offered()).toBeNull();
    expect(h.panel.mesh.position.toArray()).toEqual(position);
    h.hold(120);
    expect(h.offered()).not.toBeNull();
    h.canvas.fire('pointerup', at);
    expect(h.jointsMovedBy(h.panel)).toHaveLength(2);
    expect(angleBetween(poseOf(h.panel).rotation, SEAT.rotation)).toBeLessThan(1e-6);
  });

  it('leaves a panel outside PANEL.zone as it was picked up', () => {
    const away = { ...TIPPED, position: [TIPPED.position[0] - PANEL.zone - 0.05, TIPPED.position[1], TIPPED.position[2]] as Vec3 };
    const h = harness({ panelAt: away });
    h.drag(h.panel);
    const before = h.panel.mesh.quaternion.toArray();
    h.hold(60);
    expect(h.panel.mesh.quaternion.toArray()).toEqual(before);
    expect(h.offered()).toBeNull();
  });

  it('never turns toward a fit that is not where it goes', () => {
    // Dowels in the side panel's plinth holes, beside where the bottom panel goes: it fits
    // them only one at a time, and where it goes has no dowel to go on.
    const h = harness({ dowels: [14, 15], panelAt: TIPPED });
    h.drag(h.panel);
    expect(h.offered()).toBeNull();
    const before = h.panel.mesh.quaternion.toArray();
    h.hold(60);
    expect(h.panel.mesh.quaternion.toArray()).toEqual(before);
  });

  it('still aims a carried dowel into a free hole', () => {
    const hole = sideHole(3);
    const flat: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const h = harness({ dowels: [], extra: [{ id: 'dowel-9', type: 'dowel', pose: lowered({ position: [hole.position[0], hole.position[1] + 0.05, hole.position[2] - 0.02], rotation: flat }) }] });
    const dowel = h.parts.at(-1)!;
    const at = h.drag(dowel);
    expect(h.router.dragging?.part).toBe(dowel);
    expect(h.offered()).toBeNull();
    h.hold(60);
    expect(h.offered()).toBe('sidePanel-1');
    h.canvas.fire('pointerup', at);
    expect(h.jointsMovedBy(dowel)).toHaveLength(1);
  });
});

describe('the dowel ends where a carried panel goes light up (1.8.3.1 Step 5)', () => {
  const TIPPED = lowered(tipped({ ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2]] }, 30 * DEG));
  const lit = (shown: TargetRing[][]) => shown.at(-1) ?? [];

  it('lights exactly the dowel ends of where it goes, brighter the nearer', () => {
    const h = harness({ panelAt: TIPPED });
    h.drag(h.panel);
    h.router.update(0);
    const rings = lit(h.shown);
    expect(rings).toHaveLength(2);
    for (const top of TOPS) expect(rings.some(({ position }) => gap(position, top) < 1e-9)).toBe(true);
    for (const { strength } of rings) expect(strength).toBeGreaterThan(0);
    const near = rings[0].strength;
    // Carried further off (still inside the zone), they dim.
    const far = harness({ panelAt: { ...TIPPED, position: [TIPPED.position[0] - 0.2, TIPPED.position[1], TIPPED.position[2]] } });
    far.drag(far.panel);
    far.router.update(0);
    expect(lit(far.shown)[0].strength).toBeLessThan(near);
  });

  it('lights nothing outside PANEL.zone', () => {
    const h = harness({ panelAt: { ...TIPPED, position: [TIPPED.position[0] - PANEL.zone - 0.05, TIPPED.position[1], TIPPED.position[2]] } });
    h.drag(h.panel);
    h.router.update(0);
    expect(lit(h.shown)).toEqual([]);
  });

  it('lights no fit that is not where it goes', () => {
    const h = harness({ dowels: [14, 15], panelAt: TIPPED });
    h.drag(h.panel);
    h.router.update(0);
    expect(lit(h.shown)).toEqual([]);
  });

  it("still lights a carried dowel's free hole", () => {
    const hole = sideHole(3);
    const h = harness({ dowels: [], extra: [{ id: 'dowel-9', type: 'dowel', pose: lowered({ position: [hole.position[0], hole.position[1] + 0.05, hole.position[2] - 0.02], rotation: IDENTITY }) }] });
    h.drag(h.parts.at(-1)!);
    h.router.update(0);
    expect(lit(h.shown).some(({ position, strength }) => strength > 0 && gap(position, hole.position) < 1e-9)).toBe(true);
  });
});

// Test plan (1.8.3.1): edges the manual plan would otherwise carry.
describe('panel fit edges (1.8.3.1 test plan)', () => {
  it('lifts a flat panel clear of the floor as it turns toward where it goes, never through it, and seats it', () => {
    // Lying flat a little above the side panel, beside where it goes standing up.
    const flat: Pose = { position: [SEAT.position[0] - 0.03, 0.1, SEAT.position[2]], rotation: IDENTITY };
    const h = harness({ panelAt: lowered(flat) });
    const at = h.drag(h.panel);
    expect(h.offered()).toBeNull();
    for (let frame = 0; frame < 180; frame++) {
      h.router.update(FRAME);
      expect(new THREE.Box3().setFromObject(h.panel.mesh).min.y, `frame ${frame}`).toBeGreaterThan(-1e-6);
    }
    expect(h.offered()).not.toBeNull();
    h.canvas.fire('pointerup', at);
    expect(h.jointsMovedBy(h.panel)).toHaveLength(2);
  });

  it("reports the whole fit's first pair as the offer, once per offer, and its withdrawal", () => {
    const h = harness({ panelAt: lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) });
    const at = h.drag(h.panel);
    const offers = h.offers.filter((e) => e.target !== null);
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer.part).toBe('topBottomPanel-1');
    expect(['dowel-1', 'dowel-2']).toContain(offer.target);
    expect([3, 4]).toContain(offer.connector);
    // A dowel's top end: its second connector.
    expect(offer.targetConnector).toBe(1);
    const count = h.offers.length;
    h.hold(30);
    expect(h.offers.length).toBe(count);
    // Carried well away: withdrawn (an absent field reports as null).
    h.canvas.fire('pointermove', { clientX: at.clientX - 400, clientY: at.clientY - 300 });
    expect(h.offers.at(-1)?.target).toBeNull();
  });

  it('never seats a panel whose drag is cancelled, and puts its rings away', () => {
    const h = harness({ panelAt: lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) });
    const at = h.drag(h.panel);
    h.router.update(0);
    expect((h.shown.at(-1) ?? []).length).toBeGreaterThan(0);
    h.canvas.fire('pointercancel', at);
    expect(h.jointsMovedBy(h.panel)).toEqual([]);
    expect(h.shown.at(-1)).toEqual([]);
  });
});

// Ben, phone round 3: the booklet puts dowels in a shelf, top, bottom or plinth first, then
// presses those dowels into a side panel. A panel carrying its own dowels lifts, aims, lights
// the holes they go in, and seats every one of them.
describe('a panel carrying its own dowels (1.8.3.1, phone round 3)', () => {
  const NEAR = lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0]));
  const freeEnd = (dowel: Part) => connectorInWorld(PART_TYPES.dowel.connectors[1], poseOf(dowel)).position;

  it.each([['seated', 'seated'], ['pushed home', 'home']] as const)('picks the panel up as a free drag with its dowels %s riding along', (_, carrying) => {
    const h = harness({ dowels: [], carrying, panelAt: NEAR });
    const before = h.carried.map((dowel) => gap(dowel.mesh.position.toArray(), h.panel.mesh.position.toArray()));
    const at = h.drag(h.panel);
    h.router.update(0);
    // A free part's drag — what the elevation line lifts — never a compound's.
    expect(h.router.dragging).toEqual({ part: h.panel, mode: 'move' });
    expect(h.carried.map((dowel) => gap(dowel.mesh.position.toArray(), h.panel.mesh.position.toArray()))).toEqual(before.map((d) => expect.closeTo(d, 6)));
    // Its own seats kept.
    expect(h.assembly.all().filter((j) => j.host === h.panel.id)).toHaveLength(2);
    h.canvas.fire('pointercancel', at);
  });

  it.each([['seated', 'seated'], ['pushed home', 'home']] as const)('seats every carried dowel %s in the side panel on release, the panel the mover', (_, carrying) => {
    const h = harness({ dowels: [], carrying, panelAt: NEAR });
    const at = h.drag(h.panel);
    expect(h.offered()).toBe('sidePanel-1');
    h.canvas.fire('pointerup', at);
    h.router.update(0);
    const onSide = h.assembly.all().filter((j) => j.host === h.side.id);
    expect(onSide).toHaveLength(2);
    for (const joint of onSide) expect(joint).toMatchObject({ kind: KIND.DOWEL, mover: h.panel.id, hardwareConnector: 1 });
    expect(new Set(onSide.map((j) => j.hostConnector))).toEqual(new Set([0, 1]));
    // Each dowel's free end at its hole's mouth.
    for (const joint of onSide) expect(gap(freeEnd(h.parts.find((p) => p.id === joint.hardware)!), sideHole(joint.hostConnector).position)).toBeLessThan(1e-6);
    expect(h.seats.filter((e) => e.host === h.side.id)).toHaveLength(2);
  });

  it('then a tap on the panel pushes them home, and the panels are one', () => {
    const h = harness({ dowels: [], carrying: 'seated', panelAt: NEAR });
    h.canvas.fire('pointerup', h.drag(h.panel));
    // No frame between the release and the tap: the dowels ride the panel all the same.
    h.tap(h.panel);
    const joints = h.assembly.all();
    expect(joints).toHaveLength(4);
    for (const joint of joints) expect(isFastened(joint.fastener)).toBe(true);
    expect(h.assembly.compoundOf(h.panel.id).has(h.side.id)).toBe(true);
  });

  it('turns toward where it goes and lights the free holes its dowels go in', () => {
    const tipped30 = lowered({ position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2]], rotation: multiplyQuaternions([0, 0, Math.sin(15 * DEG), Math.cos(15 * DEG)], SEAT.rotation) });
    const h = harness({ dowels: [], carrying: 'seated', panelAt: tipped30 });
    h.drag(h.panel);
    expect(h.offered()).toBeNull();
    h.router.update(0);
    const lit = h.shown.at(-1) ?? [];
    expect(lit).toHaveLength(2);
    for (const index of [0, 1]) expect(lit.some(({ position }) => gap(position, sideHole(index).position) < 1e-9)).toBe(true);
    h.hold(120);
    expect(h.offered()).toBe('sidePanel-1');
  });

  it('still seats a deliberately wrong fit, one hole off', () => {
    const off = lowered({ ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2] + (TOPS[1][2] - TOPS[0][2])] });
    const h = harness({ dowels: [], carrying: 'seated', panelAt: off });
    h.canvas.fire('pointerup', h.drag(h.panel));
    const onSide = h.assembly.all().filter((j) => j.host === h.side.id);
    expect(onSide).toHaveLength(1);
    expect(onSide[0]).toMatchObject({ hardware: 'dowel-11', hostConnector: 1 });
  });

  it('pulls back off the side panel once pushed home, its dowels coming with it', () => {
    const h = harness({ dowels: [], carrying: 'seated', panelAt: NEAR });
    h.canvas.fire('pointerup', h.drag(h.panel));
    h.tap(h.panel);
    // Dragged up, away from the side panel: out along its holes' axis.
    const at = h.screen(h.panel.mesh.position.toArray());
    h.canvas.fire('pointerdown', at);
    for (let i = 1; i <= 10; i++) h.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY - 20 * i });
    expect(h.assembly.all().filter((j) => j.host === h.side.id)).toEqual([]);
    expect(h.assembly.all().filter((j) => j.host === h.panel.id)).toHaveLength(2);
    expect(h.router.dragging).toEqual({ part: h.panel, mode: 'move' });
  });
});
