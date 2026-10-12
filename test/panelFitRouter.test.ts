import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT, isFastenerEnd, KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, rotateVector } from '../tools/validate/lib/geometry.js';
import { COLORS, GESTURE, PANEL } from '../src/constants.js';
import { carryPose, createAssembly, relativePose } from '../src/game/assembly.js';
import { isFastened } from '../src/game/fasteners.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { createGhost } from '../src/scene/ghost.js';
import { createLiftHold } from '../src/scene/liftHold.js';
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
  // A hole marking on each socket, as partMesh.ts gives it: only its glow is read here.
  mesh.userData.decals = new Map(
    PART_TYPES[type].connectors.flatMap((c, index) => (isFastenerEnd(c.type) ? [] : [[index, new THREE.Mesh(undefined, new THREE.MeshStandardMaterial())] as const])),
  );
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
// A part's lowest point: its own box, not the hit proxy a small part carries.
function lowest({ mesh }: Part) {
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeBoundingBox();
  return new THREE.Box3().copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).min.y;
}
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
  // The elevation line's hold over the compound seam, wired as main.ts wires it.
  lift?: boolean;
}

function harness({ panelAt, dowels = [0, 1], home = [], extra = [], carrying, lift = false }: Options = {}) {
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

  // Bodies under direct control: grabbed, not since released.
  const kinematic = new Set<Body>();
  const simulation: GestureRouterOptions['physics'] = {
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
  const held = (part: Part) => kinematic.has(part.body);
  // A fastened compound moves as one, as main.ts wires it. A fake: the seam only calls what the router does.
  const seam = createCompoundPhysics(simulation as unknown as PhysicsWorld, parts, assembly);
  const line = lift ? createLiftHold(seam) : null;
  const physics = line ?? seam;
  const offers: StampedEvent[] = [];
  const seats: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  events.on(EVENT.SEAT, (event) => seats.push(event));
  if (line) {
    // As main.ts: a seat naming the held part, or moved by it, ends the hold.
    events.on(EVENT.SEAT, ({ hardware, host }) => {
      if (line.held && (hardware === line.held.id || host === line.held.id)) line.end();
    });
    events.on(EVENT.SEAT, ({ joint }) => {
      const mover = typeof joint === 'number' ? assembly.get(joint)?.mover : undefined;
      if (line.held && mover && assembly.compoundOf(line.held.id).has(mover)) line.end();
    });
  }
  const shown: TargetRing[][] = [];
  const targetRings = { show: (rings: readonly TargetRing[]) => shown.push([...rings]), hide: () => shown.push([]) };
  const ghosts: (Pose & { whereItGoes: boolean })[] = [];
  const ghost = {
    show: (_mesh: THREE.Mesh, pose: Pose, whereItGoes = false) => ghosts.push({ position: [...pose.position], rotation: [...pose.rotation], whereItGoes }),
    hide() {},
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
    targetRings,
    ghost,
    hold: line ?? undefined,
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  // The joints the setup made, as the game's would be: physics follows the graph.
  router.sync();
  // As main.ts: the line measures a held part's reach by the router's.
  line?.measure(router.verticalReachOf);
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
  return { router, canvas, assembly, parts, side, dowels: dowelParts, carried: carriedParts, panel: panel!, held, line, drag, tap, hold, screen, offered, offers, seats, shown, ghosts, jointsMovedBy };
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

  // Review round 4: bonded to its own dowels from the start, it must not be let go before a
  // seat it was carried into holds it.
  it.each([['seated', 'seated'], ['pushed home', 'home']] as const)('stays held on its seat, dowels %s, while another part is picked up and put down', (_, carrying) => {
    const h = harness({ dowels: [], carrying, panelAt: NEAR, extra: [{ id: 'dowel-9', type: 'dowel', pose: { position: [0.6, 0.004, 0.4], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] } }] });
    h.canvas.fire('pointerup', h.drag(h.panel));
    h.router.update(0);
    const seat = poseOf(h.panel);
    expect(h.held(h.panel)).toBe(true);
    const loose = h.parts.find((p) => p.id === 'dowel-9')!;
    h.canvas.fire('pointerup', h.drag(loose));
    h.router.update(0);
    expect(h.held(h.panel)).toBe(true);
    expect(poseOf(h.panel)).toEqual(seat);
    const onSide = h.assembly.all().filter((j) => j.host === h.side.id);
    expect(onSide).toHaveLength(2);
    for (const joint of onSide) expect(isFastened(joint.fastener)).toBe(false);
    // Pushed home, its joints hold it: let go.
    h.tap(h.panel);
    expect(h.held(h.panel)).toBe(false);
  });

  // Review round 4: let go while the line holds it, it seats where the ghost showed — not at
  // the line's height, its dowels floating over their holes.
  it.each([['seated', 'seated'], ['pushed home', 'home']] as const)('seats at the ghost, not the line, when let go with the line held, dowels %s', (_, carrying) => {
    const h = harness({ dowels: [], carrying, panelAt: NEAR, lift: true });
    const at = h.drag(h.panel);
    const ghost = h.ghosts.at(-1)!;
    // The line takes it as it is, then the finger lets go before the line's ease lands.
    h.line!.begin(h.panel, 'line');
    h.canvas.fire('pointerup', at);
    expect(gap(h.panel.mesh.position.toArray(), ghost.position)).toBeLessThan(1e-6);
    h.router.update(0);
    for (const joint of h.assembly.all().filter((j) => j.host === h.side.id)) {
      expect(gap(freeEnd(h.parts.find((p) => p.id === joint.hardware)!), sideHole(joint.hostConnector).position)).toBeLessThan(1e-6);
    }
    expect(h.line!.held).toBeNull();
  });

  // Review round 4: the line is the phone's lift, and its own range knew only the panel.
  it.each([['seated', 'seated'], ['pushed home', 'home']] as const)('never lowers the dowels it carries, %s, through the floor on the line', (_, carrying) => {
    // Upright, its dowels pointing down, well clear of the side panel and anything to seat on.
    const away = lowered({ position: [SEAT.position[0] - 0.7, SEAT.position[1] + 0.3, SEAT.position[2] + 0.5], rotation: SEAT.rotation });
    const h = harness({ dowels: [], carrying, panelAt: away, lift: true });
    h.drag(h.panel);
    h.line!.begin(h.panel, 'line');
    // The line's knob dragged to the bottom.
    h.line!.target(0);
    for (let frame = 0; frame < 240; frame++) {
      h.line!.update(FRAME);
      h.router.update(FRAME);
    }
    // Standing on its dowels: a dowel sink or two proud, pushed home or only seated.
    expect(lowest(h.panel)).toBeGreaterThan(0.01);
    for (const dowel of h.carried) expect(lowest(dowel), dowel.id).toBeGreaterThan(-1e-6);
    expect(Math.min(...h.carried.map(lowest))).toBeLessThan(0.002);
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

// Ben, phone round 3: the ghost (and the seat glow) is green when the fit on offer is where
// the panel goes; any other fit keeps today's amber.
describe('a green ghost where it goes (1.8.3.1, phone round 3)', () => {
  const OFF_BY_ONE = lowered({ ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2] + (TOPS[1][2] - TOPS[0][2])] });
  // The hole marking glowing on the carried panel, if any, and its colour.
  const glowing = (part: Part) => [...(part.mesh.userData.decals as Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>).values()].map((d) => d.material).find((m) => m.emissiveIntensity > 0 && m.emissive.getHex() !== COLORS.unlit);

  it('shows where it goes green, and lights its hole green', () => {
    const h = harness({ panelAt: lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) });
    h.drag(h.panel);
    h.router.update(0);
    expect(h.ghosts.at(-1)?.whereItGoes).toBe(true);
    expect(glowing(h.panel)?.emissive.getHex()).toBe(COLORS.whereItGoes);
  });

  it('keeps a fit that is not where it goes amber', () => {
    const h = harness({ panelAt: OFF_BY_ONE });
    h.drag(h.panel);
    h.router.update(0);
    expect(h.ghosts.at(-1)?.whereItGoes).toBe(false);
    expect(glowing(h.panel)?.emissive.getHex()).toBe(COLORS.decalFlash);
  });

  it('shows hardware seats amber, as before', () => {
    const hole = sideHole(3);
    const h = harness({ dowels: [], extra: [{ id: 'dowel-9', type: 'dowel', pose: lowered({ position: [hole.position[0] + 0.01, hole.position[1] + 0.03, hole.position[2]], rotation: IDENTITY }) }] });
    h.drag(h.parts.at(-1)!);
    expect(h.ghosts.at(-1)?.whereItGoes).toBe(false);
  });

  it('the ghost turns green or amber as told', () => {
    const ghost = createGhost();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    ghost.show(mesh, SEAT, true);
    expect((ghost.object.material as THREE.MeshBasicMaterial).color.getHex()).toBe(COLORS.whereItGoes);
    ghost.show(mesh, SEAT);
    expect((ghost.object.material as THREE.MeshBasicMaterial).color.getHex()).toBe(COLORS.ghost);
  });
});

// 1.8.3.4: once two panels are joined, grabbing either carries the whole assembly as one
// panel is carried — the one carry, its single-panel case the assembly of one.
// A joined pair: the bottom panel pushed home on two dowels pushed home in the side panel
// (one assembly), and a dowel seated only in the side panel's hole 3, standing at its mouth.
const SINK = CONTRACT.sinkDepth.dowel!;
const HOME_SEAT: Pose = { ...SEAT, position: [SEAT.position[0], SEAT.position[1] - 2 * SINK, SEAT.position[2]] };
// A point on the side panel's top face, clear of everything standing on it.
const ON_SIDE: Vec3 = [0.4, 0.016, 0.05];
// A cam bolt standing in the side panel's middle cam-bolt hole, in view, and its head.
const BOLT_HALF = PART_TYPES.camLockBolt.size[1] / 2;
const BOLT_IN_SIDE = { id: 'camLockBolt-1', type: 'camLockBolt', pose: { position: sideHole(6).position.map((v, i) => v + (i === 1 ? BOLT_HALF : 0)) as Vec3, rotation: IDENTITY } };
const BOLT_HEAD = sideHole(6).position.map((v, i) => v + (i === 1 ? 2 * BOLT_HALF : 0)) as Vec3;
const TIP_DOWN: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

function pair({ extra = [], lift = false }: Pick<Options, 'extra' | 'lift'> = {}) {
  const h = harness({ home: [0, 1], panelAt: HOME_SEAT, lift, extra: [{ id: 'dowel-3', type: 'dowel', pose: dowelIn(3) }, ...extra] });
  [3, 4].forEach((hole, n) => {
    const joint = h.assembly.seat({ partA: h.panel.id, connectorA: hole, partB: `dowel-${n + 1}`, connectorB: 1, mover: h.panel.id });
    h.assembly.drive(joint.id);
  });
  h.assembly.seat({ partA: 'dowel-3', connectorA: 0, partB: h.side.id, connectorB: 3, mover: 'dowel-3' });
  h.router.sync();
  const loose = h.parts.find((p) => p.id === 'dowel-3')!;
  // Pressed on the side panel and nudged past the tap distance, still held.
  function grabSide(dx = 0, dy = 12) {
    const at = h.screen(ON_SIDE);
    h.canvas.fire('pointerdown', at);
    h.canvas.fire('pointermove', { clientX: at.clientX + dx / 2, clientY: at.clientY + dy / 2 });
    const to = { clientX: at.clientX + dx, clientY: at.clientY + dy };
    h.canvas.fire('pointermove', to);
    return to;
  }
  return { ...h, loose, grabSide, members: [h.panel, ...h.dowels, loose] };
}

describe('a panel carries its whole assembly (1.8.3.4 Step 1)', () => {
  const inSide = (h: ReturnType<typeof pair>, part: Part) => relativePose(poseOf(h.side), poseOf(part));

  it('grabbing the side panel of a joined pair is a carry, not a compound drag', () => {
    const h = pair();
    expect(h.assembly.compoundOf(h.side.id).has(h.panel.id)).toBe(true);
    h.grabSide();
    expect(h.router.dragging).toEqual({ part: h.side, mode: 'move' });
  });

  it('moves every member rigidly with the grabbed panel, the dowel seated only in it too', () => {
    const h = pair();
    const before = h.members.map((part) => inSide(h, part));
    const at = h.grabSide();
    h.canvas.fire('pointermove', { clientX: at.clientX - 80, clientY: at.clientY + 40 });
    h.router.update(0);
    expect(gap(poseOf(h.side).position, ON_SIDE)).toBeGreaterThan(0.01);
    h.members.forEach((part, n) => {
      const now = inSide(h, part);
      expect(gap(now.anchor, before[n].anchor), part.id).toBeLessThan(1e-6);
      expect(angleBetween(now.rotation, before[n].rotation), part.id).toBeLessThan(1e-6);
    });
    // Nothing inside it is unseated: the pair's four seats and the loose dowel's.
    expect(h.assembly.all()).toHaveLength(5);
    // The seated-only dowel is held where it sits, not left to the simulation.
    expect(h.held(h.loose)).toBe(true);
  });

  it('keeps the lowest member above the floor on the line, however low the line is taken', () => {
    const h = pair({ lift: true });
    h.grabSide();
    h.line!.begin(h.side, 'line');
    h.line!.target(0);
    for (let frame = 0; frame < 240; frame++) {
      h.line!.update(FRAME);
      h.router.update(FRAME);
    }
    for (const part of [h.side, ...h.members]) expect(lowest(part), part.id).toBeGreaterThan(-1e-6);
    // Review round 1: the reach is on whichever side it lies — down to the floor, never
    // held up by the bottom panel standing on it.
    expect(lowest(h.side)).toBeLessThan(0.002);
  });

  // Review round 1: a lift by the wheel raises it by the wheel's travel, never by the height
  // of what stands on the grabbed panel.
  it('lifts a pair grabbed by its bottom-most panel by the wheel, without a jump', () => {
    const h = pair();
    const at = h.grabSide();
    const before = h.side.mesh.position.y;
    h.canvas.fire('wheel', { ...at, deltaY: -10 });
    const rise = h.side.mesh.position.y - before;
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(0.05);
  });

  it('grabbing a piece of hardware of the assembly is never a carry: it drags the compound, as before', () => {
    const h = pair({ extra: [BOLT_IN_SIDE] });
    h.assembly.drive(h.assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: h.side.id, connectorB: 6, mover: 'camLockBolt-1' }).id);
    h.router.sync();
    const bolt = h.parts.find((p) => p.id === 'camLockBolt-1')!;
    const at = h.drag(bolt);
    expect(h.router.dragging).toEqual({ part: bolt, mode: 'compound' });
    // Let go by the side panel's free dowel holes: a compound never seats.
    h.canvas.fire('pointerup', at);
    expect(h.seats).toEqual([]);
  });

  it('a panel pushed home onto another still pulls back off it, as before', () => {
    const h = pair();
    h.drag(h.panel);
    expect(h.router.dragging).toEqual({ part: h.panel, mode: 'pull' });
  });

  it('a tool on any member refuses the carry: the assembly drags as a compound, as before', () => {
    const tip = rotateVector(TIP_DOWN, PART_TYPES.allenWrench.connectors[0].position);
    const h = pair({ extra: [BOLT_IN_SIDE, { id: 'allenWrench-1', type: 'allenWrench', pose: { position: BOLT_HEAD.map((v, i) => v - tip[i]) as Vec3, rotation: TIP_DOWN } }] });
    h.assembly.drive(h.assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: h.side.id, connectorB: 6, mover: 'camLockBolt-1' }).id);
    h.assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'camLockBolt-1', connectorB: 1, mover: 'allenWrench-1' });
    h.router.sync();
    h.grabSide();
    expect(h.router.dragging).toEqual({ part: h.side, mode: 'compound' });
  });
});

// A stack (1.8.3.4 Step 2): side panel 2 lying across the top of the bottom panel, joined by
// two dowels pushed home in it and then in the bottom panel — the bottom panel the one pushed
// on, so side panel 2 is the one to grab. Built where the bottom panel sits at SEAT, then the
// whole of it moved rigidly to start with the bottom panel at `panelAt`.
const DOWEL = PART_TYPES.dowel.size[1];
const UP: Vec3 = [0, 1, 0];
const along = (from: Vec3, by: number): Vec3 => from.map((v, i) => v + UP[i] * by) as Vec3;
const bottomTop = (n: number) => connectorInWorld(PART_TYPES.topBottomPanel.connectors[n], SEAT).position;
const STACK_SIDE: Pose = (() => {
  const local = rotateVector(HOLES_DOWN, PART_TYPES.sidePanel.connectors[0].position);
  return { position: along(bottomTop(0), DOWEL - 2 * SINK).map((v, i) => v - local[i]) as Vec3, rotation: HOLES_DOWN };
})();
const STACK_DOWELS: Pose[] = [0, 1].map((n) => ({ position: along(bottomTop(n), DOWEL / 2 - SINK), rotation: IDENTITY }));

function stack({ carrying, lift = false, home = [], panelAt = lowered(skewed(SEAT, 20 * DEG, TOPS[0], [0.02, 0.03, 0])) }: { carrying?: 'seated'; lift?: boolean; home?: number[]; panelAt?: Pose } = {}) {
  const moved = (pose: Pose) => carryPose(SEAT, panelAt, pose);
  const h = harness({
    dowels: carrying ? [] : [0, 1],
    home,
    carrying,
    panelAt,
    lift,
    extra: [
      { id: 'sidePanel-2', type: 'sidePanel', pose: moved(STACK_SIDE) },
      ...STACK_DOWELS.map((pose, n) => ({ id: `dowel-${21 + n}`, type: 'dowel', pose: moved(pose) })),
    ],
  });
  const top = h.parts.find((p) => p.id === 'sidePanel-2')!;
  [0, 1].forEach((n) => {
    h.assembly.drive(h.assembly.seat({ partA: `dowel-${21 + n}`, connectorA: 1, partB: top.id, connectorB: n, mover: `dowel-${21 + n}` }).id);
    h.assembly.drive(h.assembly.seat({ partA: h.panel.id, connectorA: n, partB: `dowel-${21 + n}`, connectorB: 0, mover: h.panel.id }).id);
  });
  h.router.sync();
  // A point on side panel 2's top face, clear of the bottom panel under its end.
  const onTop = (): Vec3 => connectorInWorld({ position: [-0.008, 0.3, 0], axis: UP }, poseOf(top)).position;
  function grabTop(dy = 12) {
    const at = h.screen(onTop());
    h.canvas.fire('pointerdown', at);
    h.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + dy / 2 });
    const to = { clientX: at.clientX, clientY: at.clientY + dy };
    h.canvas.fire('pointermove', to);
    return to;
  }
  return { ...h, top, grabTop };
}

describe('a carried assembly seats by every member (1.8.3.4 Step 2)', () => {
  it("seats the non-grabbed panel's holes on a third panel's dowels, that panel the mover", () => {
    const h = stack();
    expect(h.assembly.pullable(h.top.id)).toEqual([]);
    const at = h.grabTop();
    expect(h.router.dragging).toEqual({ part: h.top, mode: 'move' });
    expect(h.offered()).not.toBeNull();
    const before = relativePose(poseOf(h.panel), poseOf(h.top));
    h.canvas.fire('pointerup', at);
    const onDowels = h.assembly.all().filter((j) => j.hardware === 'dowel-1' || j.hardware === 'dowel-2').filter((j) => j.host === h.panel.id);
    expect(onDowels).toHaveLength(2);
    for (const joint of onDowels) expect(joint.mover).toBe(h.panel.id);
    expect(new Set(onDowels.map((j) => j.hostConnector))).toEqual(new Set([3, 4]));
    expect(h.seats).toHaveLength(2);
    // The whole of it went there as one: the bottom panel squarely on the dowels, side panel 2 on it.
    expect(gap(poseOf(h.panel).position, SEAT.position)).toBeLessThan(1e-6);
    expect(angleBetween(poseOf(h.panel).rotation, SEAT.rotation)).toBeLessThan(1e-6);
    const after = relativePose(poseOf(h.panel), poseOf(h.top));
    expect(gap(after.anchor, before.anchor)).toBeLessThan(1e-6);
  });

  it('seats the dowel ends a member carries in a target\'s holes, the panel they sit in the mover', () => {
    const h = stack({ carrying: 'seated' });
    h.canvas.fire('pointerup', h.grabTop());
    const onSide = h.assembly.all().filter((j) => j.host === h.side.id);
    expect(onSide).toHaveLength(2);
    for (const joint of onSide) expect(joint).toMatchObject({ kind: KIND.DOWEL, mover: h.panel.id, hardwareConnector: 1 });
    // Each dowel's free end at its hole's mouth: they rode the bottom panel there.
    for (const joint of onSide) {
      const end = connectorInWorld(PART_TYPES.dowel.connectors[1], poseOf(h.parts.find((p) => p.id === joint.hardware)!)).position;
      expect(gap(end, sideHole(joint.hostConnector).position)).toBeLessThan(1e-6);
    }
  });

  it('stays held on its seats until they are pushed home, and a tap on the grabbed panel pushes them: then it is one compound', () => {
    // Side panel 1's dowels pushed home in it, so the seats close the whole thing up.
    const h = stack({ home: [0, 1] });
    h.canvas.fire('pointerup', h.grabTop());
    h.router.update(0);
    expect(h.assembly.all().filter((j) => j.host === h.panel.id && !isFastened(j.fastener))).toHaveLength(2);
    expect(h.held(h.top)).toBe(true);
    h.tap(h.top);
    for (const joint of h.assembly.all()) expect(isFastened(joint.fastener), `joint ${joint.id}`).toBe(true);
    const whole = h.assembly.compoundOf(h.top.id);
    for (const part of [h.side, h.panel, ...h.dowels]) expect(whole.has(part.id), part.id).toBe(true);
    expect(h.held(h.top)).toBe(false);
  });

  it('seats at the ghost, not the line, with the line holding it: a seat moved by any member ends the hold', () => {
    const h = stack({ lift: true });
    const at = h.grabTop();
    const ghost = h.ghosts.at(-1)!;
    h.line!.begin(h.top, 'line');
    h.canvas.fire('pointerup', at);
    expect(h.line!.held).toBeNull();
    expect(gap(h.top.mesh.position.toArray(), ghost.position)).toBeLessThan(1e-6);
    expect(gap(poseOf(h.panel).position, SEAT.position)).toBeLessThan(1e-6);
  });
});

// 1.8.3.4 Step 3: where an assembly goes is where any of its panels goes.
describe('where a carried assembly goes (1.8.3.4 Step 3)', () => {
  it('shows the fit green when a member, not the grabbed panel, is where it goes', () => {
    // Side panel 2 goes nowhere on side panel 1; the bottom panel it carries does.
    const h = stack();
    h.grabTop();
    h.router.update(0);
    expect(h.ghosts.at(-1)?.whereItGoes).toBe(true);
  });

  it('keeps a fit one hole off amber, and still seats it', () => {
    const off = lowered({ ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2] + (TOPS[1][2] - TOPS[0][2])] });
    const h = stack({ panelAt: off });
    const at = h.grabTop();
    h.router.update(0);
    expect(h.ghosts.at(-1)?.whereItGoes).toBe(false);
    h.canvas.fire('pointerup', at);
    const onDowels = h.assembly.all().filter((j) => j.host === h.panel.id && (j.hardware === 'dowel-1' || j.hardware === 'dowel-2'));
    expect(onDowels).toHaveLength(1);
    expect(onDowels[0]).toMatchObject({ hardware: 'dowel-2', hostConnector: 3, mover: h.panel.id });
  });

  it('lights the dowel ends where the member goes', () => {
    const h = stack();
    h.grabTop();
    h.router.update(0);
    const lit = h.shown.at(-1) ?? [];
    expect(lit).toHaveLength(2);
    for (const top of TOPS) expect(lit.some(({ position }) => gap(position, top) < 1e-9)).toBe(true);
  });
});

// Test plan (1.8.3.4): an assembly carry let go away from anything, or interrupted.
describe('an assembly carry let go or cancelled (1.8.3.4 test plan)', () => {
  it.each([['let go away from anything', 'pointerup'], ['cancelled', 'pointercancel']] as const)('%s: nothing seats, it is let go as one, and the dowel only seated in it still rides', (_, type) => {
    const h = pair();
    const at = h.grabSide();
    // Carried well away from the bottom panel's free holes and anything else.
    const away = { clientX: at.clientX - 300, clientY: at.clientY + 200 };
    h.canvas.fire('pointermove', away);
    h.router.update(0);
    expect(h.offered()).toBeNull();
    const inSide = (part: Part) => relativePose(poseOf(h.side), poseOf(part));
    const before = h.members.map(inSide);
    h.canvas.fire(type, away);
    h.router.update(0);
    expect(h.seats).toEqual([]);
    expect(h.assembly.all()).toHaveLength(5);
    for (const part of [h.side, h.panel, ...h.dowels]) expect(h.held(part), part.id).toBe(false);
    expect(h.held(h.loose)).toBe(true);
    // The simulation drops the side panel: the seated dowel goes with it.
    h.side.mesh.position.y -= 0.1;
    h.router.update(0);
    h.members.slice(-1).forEach((part) => expect(gap(inSide(part).anchor, before.at(-1)!.anchor), part.id).toBeLessThan(1e-6));
  });
});

// 1.8.3.4 phone finding 1 (Fable review): what a fit on offer seats on is held still under it,
// and a fit is judged again at release, so it never seats onto something that has moved off.
describe('the target of a fit on offer (1.8.3.4 phone finding 1)', () => {
  it('is held still while the fit is on offer, and let go when the drag ends', () => {
    // Side panel 1 with its dowels pushed home: one free assembly, nothing holding it.
    const h = stack({ home: [0, 1] });
    const target = h.side;
    expect(h.held(target)).toBe(false);
    const at = h.grabTop();
    expect(h.offered()).not.toBeNull();
    expect(h.held(target)).toBe(true);
    h.canvas.fire('pointercancel', at);
    expect(h.held(target)).toBe(false);
  });

  it('stays held still with the panel seated on it until a tap pushes the seats home', () => {
    const h = stack({ home: [0, 1] });
    h.canvas.fire('pointerup', h.grabTop());
    h.router.update(0);
    expect(h.assembly.all().filter((j) => j.host === h.panel.id && !isFastened(j.fastener))).toHaveLength(2);
    expect(h.held(h.side)).toBe(true);
    h.tap(h.top);
    expect(h.held(h.top)).toBe(false);
    expect(h.held(h.side)).toBe(false);
  });

  it('is handed back the moment the player picks it up', () => {
    const h = stack({ home: [0, 1] });
    h.canvas.fire('pointerup', h.grabTop());
    expect(h.held(h.side)).toBe(true);
    // Grabbed on its face, clear of what stands on it, and let go in place.
    const at = h.screen([0.4, 0.016, 0.05]);
    h.canvas.fire('pointerdown', at);
    h.canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 12 });
    h.canvas.fire('pointercancel', at);
    expect(h.held(h.side)).toBe(false);
  });

  it('seats nothing when what the fit seats on has moved off since it was offered', () => {
    const h = stack();
    const at = h.grabTop();
    expect(h.offered()).not.toBeNull();
    // Knocked away under the held fit: the side panel and its dowels, 30 cm off.
    for (const part of [h.side, ...h.dowels]) {
      part.mesh.position.x += 0.3;
      part.mesh.updateMatrixWorld(true);
    }
    h.canvas.fire('pointerup', at);
    expect(h.assembly.all().filter((j) => j.hardware === 'dowel-1' || j.hardware === 'dowel-2').filter((j) => j.host === h.panel.id)).toEqual([]);
  });
});
