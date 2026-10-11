// Automated half of 1.8.3.4's acceptance (assembly lift and fit): JOHNNY's half-built carcass
// carried onto the second side panel by touch, through the real router, the real elevation
// line and the real compound seam over a recording physics stub. The carcass is the booklet's
// state after its step 5 — dowels pushed home in the four horizontals, the horizontals pushed
// home on side panel 1, its cam bolts screwed and the cams locked on them — put in through the
// assembly's own events (seatHome), as the display shelf is. Side panel 2 lies flat, holes up;
// the carcass stands over it, side panel 1 on top, turned a little and held a little high. How
// it feels on a phone, and the frame rate carrying it, are the PR's manual checks.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, placeLayout, rotateVector } from '../tools/validate/lib/geometry.js';
import { GESTURE } from '../src/constants.js';
import { carryPose, createAssembly, seatHome } from '../src/game/assembly.js';
import { isFastened } from '../src/game/fasteners.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { createLiftHold } from '../src/scene/liftHold.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

const SIZE = 1000;
const FRAME = 1 / 60;
const DEG = Math.PI / 180;
type Listener = (event: object) => void;

const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

// The finished JOHNNY laid on its right side: side panel 2 flat on the floor, holes up, at the
// middle of the room; everything else stands on it where it goes.
const ON_RIGHT: Pose = { position: [-1.01, 0.4, 0], rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] };
const LAID = new Map(placeLayout(ASSEMBLED.parts, ON_RIGHT).map((part) => [part.id, part]));
const TARGET = 'sidePanel-2';
const SHELF = 'fixedShelf-1';
// The half-built carcass: side panel 1, the four horizontals, all fourteen dowels, side panel
// 1's cam bolts and the cams that lock on them.
const CARCASS = ['sidePanel-1', 'plinth-1', 'topBottomPanel-1', SHELF, 'topBottomPanel-2', ...Array.from({ length: 14 }, (_, n) => `dowel-${n + 1}`), 'camLockBolt-1', 'camLockBolt-2', 'camLockBolt-3', 'camLockBolt-4', 'camLock-2', 'camLock-3', 'camLock-4', 'camLock-7'];
// The dowels that go into side panel 2.
const INTO_TARGET = ASSEMBLED.joints.filter((j) => j.host === TARGET && j.kind === KIND.DOWEL).map((j) => j.hardware);

// A part whose body reports its mesh's pose; moves land on the mesh, as a step would.
function makePart(id: string, type: string, { position, rotation }: Pose, kinematic: Set<Body>): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.quaternion.set(...rotation);
  mesh.updateMatrixWorld(true);
  const body = {
    id,
    isKinematic: () => kinematic.has(body as unknown as Body),
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only reports its pose.
  return { id, type, mesh, body } as unknown as Part;
}

const angleBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const poseOf = ({ mesh }: Part): Pose => ({ position: mesh.position.toArray(), rotation: mesh.quaternion.toArray() });

// The carcass where it goes, turned `angle` about unit `axis` through the shelf's centre,
// then moved by `shift` — and lowered by the pick-up's hover, so the drag lifts it back.
function startOf(angle: number, shift: Vec3, axis: Vec3 = [0, 1, 0]): (pose: Pose) => Pose {
  const centre = LAID.get(SHELF)!.position;
  const s = Math.sin(angle / 2);
  const turn: Quat = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  return ({ position, rotation }) => {
    const arm = rotateVector(turn, position.map((v, i) => v - centre[i]) as Vec3);
    return {
      position: arm.map((v, i) => v + centre[i] + shift[i] - (i === 1 ? GESTURE.hoverLift : 0)) as Vec3,
      rotation: multiplyQuaternions(turn, rotation),
    };
  };
}

function harness(start: (pose: Pose) => Pose) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0.8, 0.45, 1.5);
  camera.lookAt(0, 0.4, 0);
  camera.updateMatrixWorld(true);

  const kinematic = new Set<Body>();
  const at = (id: string) => (id === TARGET ? LAID.get(id)! : start(LAID.get(id)!));
  const parts = [TARGET, ...CARCASS].map((id) => makePart(id, LAID.get(id)!.type, at(id), kinematic));
  const byId = (id: string) => parts.find((part) => part.id === id)!;
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  const inCarcass = new Set(CARCASS);
  seatHome(
    assembly,
    ASSEMBLED.joints
      .filter((j) => inCarcass.has(j.hardware) && inCarcass.has(j.host))
      .map((j) => ({ partA: j.hardware, connectorA: j.hardwareConnector, partB: j.host, connectorB: j.hostConnector, mover: j.mover, ctx: { through: j.through, captured: j.captured } })),
  );

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
  // As main.ts wires them: the hold over the compound seam. A fake: the seams only call what the router does.
  const line = createLiftHold(createCompoundPhysics(simulation as unknown as PhysicsWorld, parts, assembly));
  const seats: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SEAT, (event) => seats.push(event));
  // As main.ts: a seat naming the held part, or moved by any panel of its assembly, ends the hold.
  events.on(EVENT.SEAT, ({ hardware, host }) => {
    if (line.held && (hardware === line.held.id || host === line.held.id)) line.end();
  });
  events.on(EVENT.SEAT, ({ joint }) => {
    const mover = typeof joint === 'number' ? assembly.get(joint)?.mover : undefined;
    if (line.held && mover && assembly.compoundOf(line.held.id).has(mover)) line.end();
  });
  const ghosts: (Pose & { whereItGoes: boolean })[] = [];
  const lit: number[] = [];
  const listeners = new Map<string, Listener>();
  const canvas = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE }),
    setPointerCapture() {},
  };
  const fire = (type: string, init: object) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...init });
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics: line,
    parts,
    assembly,
    events,
    hold: line,
    targetRings: { show: (rings) => lit.push(rings.length), hide: () => lit.push(0) },
    ghost: { show: (_mesh, pose, whereItGoes = false) => ghosts.push({ position: [...pose.position], rotation: [...pose.rotation], whereItGoes }), hide() {} },
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  router.sync();
  line.measure(router.halfHeightOf);
  const shelf = byId(SHELF);
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // A frame as main.ts runs one: the hold eases, the simulation steps (a stub), the router follows.
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      line.update(FRAME);
      router.update(FRAME);
    }
  };
  // The shelf pressed on its face toward the camera and nudged, still held.
  function grabShelf() {
    const face = connectorInWorld({ position: [0.1, PART_TYPES.fixedShelf.size[1] / 2, 0.05], axis: [0, 1, 0] }, poseOf(shelf)).position;
    const from = screen(face);
    fire('pointerdown', from);
    fire('pointermove', { clientX: from.clientX, clientY: from.clientY + 6 });
    const to = { clientX: from.clientX, clientY: from.clientY + 12 };
    fire('pointermove', to);
    return () => fire('pointerup', to);
  }
  function tap(part: Part, point: Vec3) {
    const at = screen(point);
    fire('pointerdown', at);
    fire('pointerup', at);
    return part;
  }
  return { router, assembly, line, parts, byId, shelf, target: byId(TARGET), frames, grabShelf, tap, seats, ghosts, lit };
}

describe('JOHNNY: the half-built carcass onto the second side panel (1.8.3.4 Step 5)', () => {
  it('lifts on the line, turns in by itself, shows the green whole fit, seats every dowel, and bonds', () => {
    // Tipped 45° about the side panels' long way: only a wrong fit is in reach of its dowel ends.
    const h = harness(startOf(45 * DEG, [0.02, 0.05, -0.015], [1, 0, 0]));
    // The shelf's cams are locked on side panel 1's bolts: it carries, never pulls out.
    expect(h.assembly.pullable(SHELF)).toEqual([]);
    const release = h.grabShelf();
    expect(h.router.dragging).toEqual({ part: h.shelf, mode: 'move' });
    expect(h.ghosts.at(-1)?.whereItGoes).toBe(false);
    // On the line: it holds the whole carcass, and the fit coming on offer eases the line to it.
    h.line.begin(h.shelf, 'line');
    h.frames(240);
    expect(h.line.held).toBe(h.shelf);
    for (const id of CARCASS) expect(h.byId(id).mesh.position.y, id).toBeGreaterThan(-1e-6);
    // Turned in by itself: the whole fit on offer is where it goes, its dowel ends lit, and the
    // carcass eased onto it.
    expect(angleBetween(poseOf(h.shelf).rotation, LAID.get(SHELF)!.rotation)).toBeLessThan(1e-3);
    const ghost = h.ghosts.at(-1)!;
    expect(ghost.whereItGoes).toBe(true);
    expect(angleBetween(ghost.rotation, LAID.get(SHELF)!.rotation)).toBeLessThan(1e-6);
    expect(h.lit.some((n) => n > 0)).toBe(true);

    // Let go: every dowel into side panel 2 seats, each moved by the horizontal it is in.
    release();
    expect(h.line.held).toBeNull();
    const seated = h.assembly.all().filter((j) => j.host === TARGET);
    expect(new Set(seated.map((j) => j.hardware))).toEqual(new Set(INTO_TARGET));
    for (const joint of seated) {
      const horizontal = h.assembly.all().find((j) => j.hardware === joint.hardware && j.host !== TARGET)!.host;
      expect(joint.mover, joint.hardware).toBe(horizontal);
    }
    // The whole carcass went there as one: every part where the finished JOHNNY has it.
    h.frames(1);
    for (const id of CARCASS) {
      const at = poseOf(h.byId(id));
      const goal = carryPose(LAID.get(SHELF)!, poseOf(h.shelf), LAID.get(id)!);
      expect(gap(at.position, goal.position), id).toBeLessThan(1e-6);
    }
    expect(gap(poseOf(h.shelf).position, LAID.get(SHELF)!.position)).toBeLessThan(0.04);

    // A tap on the shelf pushes them all home: one JOHNNY carcass, side panel 2 and all.
    h.tap(h.shelf, connectorInWorld({ position: [0.1, PART_TYPES.fixedShelf.size[1] / 2, 0.05], axis: [0, 1, 0] }, poseOf(h.shelf)).position);
    for (const joint of h.assembly.all().filter((j) => j.host === TARGET)) expect(isFastened(joint.fastener), joint.hardware).toBe(true);
    expect(h.assembly.compoundOf(SHELF).has(TARGET)).toBe(true);
  });

  it('still seats a forced fit one dowel pitch off, amber', () => {
    // Slid along the side panel by the pitch of its bottom dowels: no longer where it goes.
    const pitch = 2 * 0.09;
    const h = harness(startOf(0, [0, 0.01, pitch]));
    const release = h.grabShelf();
    h.frames(30);
    const ghost = h.ghosts.at(-1);
    expect(ghost?.whereItGoes).toBe(false);
    release();
    const seated = h.assembly.all().filter((j) => j.host === TARGET);
    expect(seated.length).toBeGreaterThan(0);
    expect(seated.length).toBeLessThan(INTO_TARGET.length);
  });
});
