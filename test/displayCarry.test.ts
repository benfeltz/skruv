// Test plan (1.8.3.4) step 13, automated half: the built display JOHNNY against the back wall is
// one assembly, so grabbing one of its horizontals is now a carry of the whole bookcase — every
// fastened part moving rigidly with it, as the compound drag moved it before — and the
// elevation line measures the whole bookcase's reach. The real router over a recording stub;
// whether it should offer fits near loose parts is the manual plan's call.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectorInWorld, placeLayout } from '../tools/validate/lib/geometry.js';
import { DISPLAY } from '../src/constants.js';
import { createAssembly, relativePose, seatHome } from '../src/game/assembly.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { liftRangeOf } from '../src/scene/liftHold.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

const SIZE = 1000;
const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

const BOTTOM = 'topBottomPanel-1';
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angleBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const poseOf = ({ mesh }: Part): Pose => ({ position: mesh.position.toArray(), rotation: mesh.quaternion.toArray() });

function harness() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(DISPLAY.position[0], 0.45, DISPLAY.position[2] + 1.2);
  camera.lookAt(DISPLAY.position[0], 0.068, DISPLAY.position[2]);
  camera.updateMatrixWorld(true);
  const half = DISPLAY.yaw / 2;
  const posed = placeLayout(ASSEMBLED.parts, { position: DISPLAY.position, rotation: [0, Math.sin(half), 0, Math.cos(half)] });
  const kinematic = new Set<Body>();
  const parts = posed.map(({ id, type, position, rotation }) => {
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
  });
  const assembly = createAssembly((id) => parts.find((part) => part.id === id)!.type);
  // As the display shelf is put in (src/scene/displayShelf.ts): every pair seated and driven home.
  seatHome(
    assembly,
    ASSEMBLED.joints.map((j) => ({ partA: j.hardware, connectorA: j.hardwareConnector, partB: j.host, connectorB: j.hostConnector, mover: j.mover, ctx: { through: j.through, captured: j.captured } })),
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
  const listeners = new Map<string, (event: object) => void>();
  const canvas = {
    addEventListener: (type: string, fn: (event: object) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE }),
    setPointerCapture() {},
  };
  const fire = (type: string, init: object) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...init });
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    // A fake: the seam only calls what the router does.
    physics: createCompoundPhysics(simulation as unknown as PhysicsWorld, parts, assembly),
    parts,
    assembly,
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  router.sync();
  const bottom = parts.find((part) => part.id === BOTTOM)!;
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // The bottom panel pressed on its upper face, toward the front, and moved `dx`, `dy` px.
  function grabBottom(dx: number, dy: number) {
    // Laid with a half turn about z: its local −y face is the one facing up.
    const face = connectorInWorld({ position: [0.1, -PART_TYPES.topBottomPanel.size[1] / 2, 0.08], axis: [0, -1, 0] }, poseOf(bottom)).position;
    const at = screen(face);
    fire('pointerdown', at);
    fire('pointermove', { clientX: at.clientX + dx / 2, clientY: at.clientY + dy / 2 });
    fire('pointermove', { clientX: at.clientX + dx, clientY: at.clientY + dy });
  }
  return { router, assembly, parts, bottom, grabBottom };
}

describe('the display JOHNNY carried by a horizontal (1.8.3.4 test plan, step 13)', () => {
  it('is a carry of the whole bookcase: every fastened part moves rigidly with the bottom panel', () => {
    const h = harness();
    const whole = h.assembly.compoundOf(BOTTOM);
    const members = h.parts.filter((part) => part !== h.bottom && whole.has(part.id));
    // The bookcase is one assembly: both sides, the four horizontals, the back and their hardware.
    for (const id of ['sidePanel-1', 'sidePanel-2', 'plinth-1', 'fixedShelf-1', 'topBottomPanel-2', 'backPanel-1']) expect(whole.has(id), id).toBe(true);
    const before = members.map((part) => relativePose(poseOf(h.bottom), poseOf(part)));
    const start = poseOf(h.bottom).position;
    h.grabBottom(120, 40);
    expect(h.router.dragging).toEqual({ part: h.bottom, mode: 'move' });
    expect(gap(poseOf(h.bottom).position, start)).toBeGreaterThan(0.02);
    members.forEach((part, n) => {
      const now = relativePose(poseOf(h.bottom), poseOf(part));
      expect(gap(now.anchor, before[n].anchor), part.id).toBeLessThan(1e-6);
      expect(angleBetween(now.rotation, before[n].rotation), part.id).toBeLessThan(1e-6);
    });
  });

  it("measures the line's range by the whole bookcase: the bottom panel can go no lower than it stands", () => {
    const h = harness();
    const [min] = liftRangeOf(h.bottom, h.bottom.mesh.quaternion.toArray(), h.router.verticalReachOf);
    expect(min).toBeCloseTo(h.bottom.mesh.position.y, 6);
  });
});
