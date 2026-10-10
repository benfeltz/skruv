import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { createAssembly } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../src/physics/world.js';
import type { GestureRouterOptions } from '../src/scene/gestureRouter.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The real gesture router carrying a tool to a fastener (1.8.2.1), with the real catalog: a
// side panel lying flat, holes up, a cam bolt standing in one of its cam-bolt holes — seated
// or merely put there — and an Allen key.

const SIZE = 1000;
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

const HALF_TURN_Z: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // the panel's local +x (its hole faces) up
const PANEL_POSE = { position: [0, 0.008, 0] as Vec3, rotation: HALF_TURN_Z };
const CAM_BOLT_HOLE = 2;
const HOLE = connectorInWorld(PART_TYPES.sidePanel.connectors[CAM_BOLT_HOLE], PANEL_POSE).position;
const BOLT_HALF = PART_TYPES.camLockBolt.size[1] / 2;
// The bolt upright in the hole, its head on top.
const HEAD: Vec3 = [HOLE[0], HOLE[1] + 2 * BOLT_HALF, HOLE[2]];
// The Allen key's short leg (its tip axis, local +z) pointing straight down.
const TIP_DOWN: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const TIP = PART_TYPES.allenWrench.connectors[0].position;

interface Options {
  seated?: boolean;
  keyAt?: Vec3;
  keyRotation?: Quat;
}

function harness({ seated = true, keyAt, keyRotation = TIP_DOWN }: Options = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const panel = makePart('sidePanel-1', 'sidePanel', PANEL_POSE.position, PANEL_POSE.rotation);
  const bolt = makePart('camLockBolt-1', 'camLockBolt', [HOLE[0], HOLE[1] + BOLT_HALF, HOLE[2]]);
  // Tip-down, its tip a little above the head, beside it.
  const tipOffset = new THREE.Vector3(...TIP).applyQuaternion(new THREE.Quaternion(...keyRotation));
  const key = makePart('allenWrench-1', 'allenWrench', keyAt ?? [HEAD[0] - tipOffset.x, HEAD[1] - tipOffset.y + 0.02, HEAD[2] - tipOffset.z], keyRotation);
  const parts = [panel, bolt, key];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  if (seated) assembly.seat({ partA: bolt.id, connectorA: 0, partB: panel.id, connectorB: CAM_BOLT_HOLE, mover: bolt.id });

  const physics: GestureRouterOptions['physics'] = {
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
  const offers: StampedEvent[] = [];
  const seats: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  events.on(EVENT.SEAT, (event) => seats.push(event));

  const canvas = new FakeCanvas();
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics,
    parts,
    assembly,
    events,
  });
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // Pressed on a part and nudged past the tap distance, still held.
  function drag(part: Part, dx = 0, dy = 15) {
    const at = screen(part.mesh.position.toArray());
    canvas.fire('pointerdown', at);
    canvas.fire('pointermove', { clientX: at.clientX + dx / 2, clientY: at.clientY + dy / 2 });
    const to = { clientX: at.clientX + dx, clientY: at.clientY + dy };
    canvas.fire('pointermove', to);
    return to;
  }
  const offered = () => offers.at(-1)?.target ?? null;
  const toolJoints = () => assembly.all().filter((j) => j.kind === KIND.TOOL);
  return { router, canvas, assembly, panel, bolt, key, camera, drag, screen, offered, seats, toolJoints };
}

describe('a tool never seats on loose hardware (1.8.2.1 step 2)', () => {
  it("offers a seated bolt's head to an Allen key, and the release seats it", () => {
    const { router, canvas, key, drag, offered, seats, toolJoints } = harness();
    const at = drag(key);
    expect(router.dragging?.part).toBe(key);
    expect(offered()).toBe('camLockBolt-1');
    canvas.fire('pointerup', at);
    expect(toolJoints()).toHaveLength(1);
    expect(seats.at(-1)?.hardware).toBe('allenWrench-1');
  });

  it("never offers a loose bolt's head", () => {
    const { router, canvas, key, drag, offered, toolJoints } = harness({ seated: false });
    const at = drag(key);
    expect(router.dragging?.part).toBe(key);
    expect(offered()).toBeNull();
    canvas.fire('pointerup', at);
    expect(toolJoints()).toEqual([]);
  });
});
