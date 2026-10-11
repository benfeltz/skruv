// Automated half of 1.8.3.1's acceptance (panel fit): a JOHNNY panel put on its dowels by
// touch, start to finish, through the real router over a recording physics stub. A side
// panel lies flat, holes up; two dowels lie flat beside its bottom dowel holes; the bottom
// panel stands near where it goes, tipped 30°. No gizmo is used. How it feels on a phone is
// the PR's manual checks.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, rotateVector } from '../tools/validate/lib/geometry.js';
import { GESTURE } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { isFastened } from '../src/game/fasteners.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { TargetRing } from '../src/scene/targetRings.js';
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

const FLAT: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // a dowel lying on its side
const ALONG_X: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2]; // a dowel lying along x, its first end toward -x
const SIDE: Pose = { position: [0, 0.008, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }; // holes up
const HOLES_DOWN: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2]; // the bottom panel's holes 3 and 4 facing down
const DOWEL_LENGTH = PART_TYPES.dowel.size[1];
const sideHole = (index: number) => connectorInWorld(PART_TYPES.sidePanel.connectors[index], SIDE);
const tops = [0, 1].map((index) => sideHole(index).position.map((v, i) => v + (i === 1 ? DOWEL_LENGTH : 0)) as Vec3);
// The bottom panel squarely on both dowels standing at their holes' mouths.
const SEAT: Pose = (() => {
  const offset = rotateVector(HOLES_DOWN, PART_TYPES.topBottomPanel.connectors[3].position);
  return { position: tops[0].map((v, i) => v - offset[i]) as Vec3, rotation: HOLES_DOWN };
})();
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

// `seated`: the dowels start standing in their holes, seated at the mouth, rather than lying
// beside them. `beside`: the holes they lie beside — the side panel's (0 and 1), or the
// bottom panel's (3 and 4), as the booklet's step 1 has it.
function harness(panelAt: Pose, { seated = false, beside = 'side' }: { seated?: boolean; beside?: 'side' | 'panel' } = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0.9, 1.3, 1.1);
  camera.lookAt(0.9, 0.2, 0);
  camera.updateMatrixWorld(true);

  const side = makePart('sidePanel-1', 'sidePanel', SIDE);
  // Each dowel lying flat a little above and in front of its hole, or standing in it.
  const dowels = [0, 1].map((index) => {
    if (beside === 'panel') {
      // Lying along the panel's end holes, a little out from them and level with them.
      const { position } = connectorInWorld(PART_TYPES.topBottomPanel.connectors[3 + index], panelAt);
      return makePart(`dowel-${index + 1}`, 'dowel', { position: [position[0] + DOWEL_LENGTH / 2 + 0.02, position[1], position[2]], rotation: ALONG_X });
    }
    const { position } = sideHole(index);
    const pose: Pose = seated
      ? { position: [position[0], position[1] + DOWEL_LENGTH / 2, position[2]], rotation: [0, 0, 0, 1] }
      : lowered({ position: [position[0], position[1] + 0.05, position[2] - 0.02], rotation: FLAT });
    return makePart(`dowel-${index + 1}`, 'dowel', pose);
  });
  const panel = makePart('topBottomPanel-1', 'topBottomPanel', beside === 'panel' ? panelAt : lowered(panelAt));
  const parts = [side, ...dowels, panel];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  if (seated) dowels.forEach((dowel, index) => assembly.seat({ partA: dowel.id, connectorA: 0, partB: side.id, connectorB: index, mover: dowel.id }));
  const simulation = {
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
  const seats: StampedEvent[] = [];
  const offers: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SEAT, (event) => seats.push(event));
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  const shown: TargetRing[][] = [];
  const ghosts: Pose[] = [];
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
    physics,
    parts,
    assembly,
    events,
    targetRings: { show: (rings) => shown.push([...rings]), hide: () => shown.push([]) },
    ghost: { show: (_mesh, pose) => ghosts.push({ position: [...pose.position], rotation: [...pose.rotation] }), hide() {} },
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  const screen = (part: Part) => {
    const v = part.mesh.position.clone().project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // Picked up and nudged; held still for `frames`; let go.
  function carry(part: Part, frames: number) {
    const at = screen(part);
    fire('pointerdown', at);
    fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 6 });
    const to = { clientX: at.clientX, clientY: at.clientY + 12 };
    fire('pointermove', to);
    expect(router.dragging?.part).toBe(part);
    for (let i = 0; i < frames; i++) router.update(FRAME);
    return () => fire('pointerup', to);
  }
  // Pressed, carried across the screen to `to` (a world point on the drag plane), and lifted
  // `lift` scroll px, still held.
  function carryTo(part: Part, to: Vec3, lift: number) {
    const from = screen(part);
    const v = new THREE.Vector3(...to).project(camera);
    const end = { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
    fire('pointerdown', from);
    for (let i = 1; i <= 10; i++) fire('pointermove', { clientX: from.clientX + ((end.clientX - from.clientX) * i) / 10, clientY: from.clientY + ((end.clientY - from.clientY) * i) / 10 });
    expect(router.dragging?.part).toBe(part);
    fire('wheel', { deltaY: -lift });
    return () => fire('pointerup', end);
  }
  function tap(part: Part) {
    const at = screen(part);
    fire('pointerdown', at);
    fire('pointerup', at);
  }
  const hold = (frames: number) => {
    for (let i = 0; i < frames; i++) router.update(FRAME);
  };
  return { router, assembly, side, dowels, panel, carry, carryTo, tap, hold, seats, offers, shown, ghosts };
}

describe('a panel goes on its dowels by touch (1.8.3.1 acceptance)', () => {
  it('dowels in, pushed home; the bottom panel carried in tipped 30° turns in, shows the whole fit, seats on every hole, and bonds', () => {
    const tipped: Pose = { position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2]], rotation: multiplyQuaternions([0, 0, Math.sin(15 * DEG), Math.cos(15 * DEG)], SEAT.rotation) };
    const h = harness(tipped);

    // Each dowel aims itself into its hole, seats on release, and a tap pushes it home.
    for (const dowel of h.dowels) {
      h.carry(dowel, 60)();
      expect(h.assembly.jointsOf(dowel.id)).toHaveLength(1);
      h.tap(dowel);
      expect(isFastened(h.assembly.jointsOf(dowel.id)[0].fastener)).toBe(true);
    }

    // The panel: no fit on offer as picked up; held still, it turns in until the ghost shows
    // it squarely on both dowels, their ends lit.
    const offersBefore = h.offers.length;
    const release = h.carry(h.panel, 120);
    expect(h.offers.length).toBeGreaterThan(offersBefore);
    const ghost = h.ghosts.at(-1)!;
    expect(gap(ghost.position, SEAT.position)).toBeLessThan(1e-6);
    expect(angleBetween(ghost.rotation, SEAT.rotation)).toBeLessThan(1e-6);
    const lit = h.shown.at(-1)!;
    expect(lit).toHaveLength(2);
    for (const top of tops) expect(lit.some(({ position }) => gap(position, top) < 1e-9)).toBe(true);

    // Let go: every matched hole seats, the panel the mover.
    const seatsBefore = h.seats.length;
    release();
    const joints = h.assembly.all().filter((j) => j.mover === h.panel.id);
    expect(joints).toHaveLength(2);
    expect(new Set(joints.map((j) => j.hardware))).toEqual(new Set(['dowel-1', 'dowel-2']));
    expect(h.seats.length - seatsBefore).toBe(2);

    // A tap pushes both home; the panels are one compound.
    h.tap(h.panel);
    for (const joint of h.assembly.all().filter((j) => j.mover === h.panel.id)) expect(isFastened(joint.fastener)).toBe(true);
    expect(h.assembly.compoundOf(h.panel.id).has(h.side.id)).toBe(true);
  });

  it('seats a deliberately off-by-one placement where it is put', () => {
    // Hole 3 over the second dowel, where hole 4 belongs: where it goes is out of reach.
    const offByOne: Pose = { position: [SEAT.position[0], SEAT.position[1] + 0.02, SEAT.position[2] + (tops[1][2] - tops[0][2])], rotation: SEAT.rotation };
    const h = harness(offByOne, { seated: true });
    h.carry(h.panel, 0)();
    const joints = h.assembly.all().filter((j) => j.mover === h.panel.id);
    expect(joints).toHaveLength(1);
    expect(joints[0]).toMatchObject({ kind: KIND.DOWEL, hardware: 'dowel-2', hostConnector: 3 });
    expect(gap(h.panel.mesh.position.toArray(), SEAT.position)).toBeGreaterThan(0.1);
  });
});

// Ben, phone round 3: the booklet's own order. Step 1 puts the dowels in the bottom panel;
// step 3 presses those dowels into a side panel lying flat.
describe("the booklet's step 1 then step 3, by touch (1.8.3.1, phone round 3)", () => {
  // The bottom panel lying flat on the floor, front of the side panel; its end holes 3 and 4 face +x.
  const FLAT_PANEL: Pose = { position: [0.3, PART_TYPES.topBottomPanel.size[1] / 2, 0.55], rotation: [0, 0, 0, 1] };

  it('dowels into the bottom panel and pushed home; the panel carried over, lifted, turned in by itself, and pressed onto the side panel by every dowel', () => {
    const h = harness(FLAT_PANEL, { beside: 'panel' });

    // Step 1: each dowel aims itself into its end hole, seats on release, and a tap pushes it home.
    for (const dowel of h.dowels) {
      h.carry(dowel, 60)();
      expect(h.assembly.jointsOf(dowel.id)).toMatchObject([{ host: h.panel.id }]);
      h.tap(dowel);
      expect(isFastened(h.assembly.jointsOf(dowel.id)[0].fastener)).toBe(true);
    }

    // Step 3: the panel, dowels and all, is a free part's drag — it lifts — and carried over
    // the side panel, then held still: it turns upright onto where it goes, its dowels' holes lit.
    const release = h.carryTo(h.panel, [SEAT.position[0] - 0.03, 0.016, SEAT.position[2]], 60);
    expect(h.router.dragging).toEqual({ part: h.panel, mode: 'move' });
    expect(h.panel.mesh.position.y).toBeGreaterThan(0.1);
    const panelOffer = () => h.offers.filter((e) => e.part === h.panel.id).at(-1)?.target ?? null;
    expect(panelOffer()).toBeNull();
    let lit = false;
    for (let frame = 0; frame < 180 && !panelOffer(); frame++) {
      h.router.update(FRAME);
      // Turning upright never takes the panel, or the dowels it carries, through the floor.
      // (Once a fit is on offer, seat assist eases it in from there.)
      if (!panelOffer()) for (const part of [h.panel, ...h.dowels]) expect(lowest(part), `${part.id}, frame ${frame}`).toBeGreaterThan(-1e-6);
      lit ||= (h.shown.at(-1) ?? []).filter(({ position }) => [0, 1].some((i) => gap(position, sideHole(i).position) < 1e-6)).length === 2;
    }
    expect(lit).toBe(true);
    expect(panelOffer()).toBe('sidePanel-1');
    h.hold(30);

    // Let go: both dowels seat in the side panel, the panel the mover, and they ride with it.
    release();
    const onSide = h.assembly.all().filter((j) => j.host === h.side.id);
    expect(onSide).toHaveLength(2);
    for (const joint of onSide) expect(joint.mover).toBe(h.panel.id);
    expect(new Set(onSide.map((j) => j.hostConnector))).toEqual(new Set([0, 1]));
    expect(angleBetween(h.panel.mesh.quaternion.toArray(), SEAT.rotation)).toBeLessThan(1e-6);

    // A tap on the panel pushes them home: one carcass.
    h.tap(h.panel);
    for (const joint of h.assembly.all()) expect(isFastened(joint.fastener)).toBe(true);
    expect(h.assembly.all()).toHaveLength(4);
    expect(h.assembly.compoundOf(h.panel.id).has(h.side.id)).toBe(true);
  });
});
