// Automated half of 1.8.2.1's acceptance (tools seat): JOHNNY's two tool steps done start
// to finish by touch, in build order, through the real router over a recording physics
// stub. A cam bolt stands seated in a side panel's hole; a shelf lies recess-up with a cam
// lock seated in it, its recess within capture reach of that bolt's head (capture is
// instance-agnostic and purely geometric). The Allen key and the screwdriver lie flat,
// well off to the side. No gizmo is used. How it feels on a phone is Test Plan.md.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { FASTENER } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../src/physics/world.js';
import type { TargetRing } from '../src/scene/targetRings.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

const SIZE = 1000;
const FRAME = 1 / 60;
type Listener = (event: object) => void;

const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

// A part whose body keeps its own pose, as the simulation's does: a move lands on both body
// and mesh, as a step would, while the fastener progress the router draws (a bolt sinking
// and turning) lands on the mesh alone.
function makePart(id: string, type: string, position: Vec3, rotation: Quat = [0, 0, 0, 1]): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  const pose = { position: new THREE.Vector3(...position), quaternion: new THREE.Quaternion(...rotation) };
  mesh.position.copy(pose.position);
  mesh.quaternion.copy(pose.quaternion);
  mesh.updateMatrixWorld(true);
  const body = {
    id,
    pose,
    translation: () => ({ x: pose.position.x, y: pose.position.y, z: pose.position.z }),
    rotation: () => ({ x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only keeps a pose.
  return { id, type, mesh, body } as unknown as Part;
}

// The side panel flat, holes up; the cam bolt upright in cam-bolt hole 2.
const SIDE_POSE = { position: [0, 0.008, 0] as Vec3, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as Quat };
const BOLT_HOLE = 2;
const HOLE = connectorInWorld(PART_TYPES.sidePanel.connectors[BOLT_HOLE], SIDE_POSE).position;
const BOLT_HALF = PART_TYPES.camLockBolt.size[1] / 2;
const HEAD: Vec3 = [HOLE[0], HOLE[1] + 2 * BOLT_HALF, HOLE[2]];
// The shelf flipped recess-up, its recess 1 cm along x from the bolt head.
const RECESS = 2;
const RECESS_LOCAL = PART_TYPES.topBottomPanel.connectors[RECESS].position;
const RECESS_AT: Vec3 = [HEAD[0] + 0.01, HEAD[1], HEAD[2]];
const SHELF_POSE = {
  position: [RECESS_AT[0] - RECESS_LOCAL[0], RECESS_AT[1] + RECESS_LOCAL[1], RECESS_AT[2]] as Vec3,
  rotation: [1, 0, 0, 0] as Quat,
};
const CAM_HALF = PART_TYPES.camLock.size[1] / 2;
const SLOT: Vec3 = [RECESS_AT[0], RECESS_AT[1] + 2 * CAM_HALF, RECESS_AT[2]];
// The tools lying flat off to the side, clear of both panels.
const KEY_AT: Vec3 = [HEAD[0] - 0.05, 0.002, HEAD[2] + 0.25];
const DRIVER_AT: Vec3 = [HEAD[0] + 0.1, 0.011, HEAD[2] + 0.3];
const DRIVER_FLAT: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

function bench() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const side = makePart('sidePanel-1', 'sidePanel', SIDE_POSE.position, SIDE_POSE.rotation);
  const bolt = makePart('camLockBolt-1', 'camLockBolt', [HOLE[0], HOLE[1] + BOLT_HALF, HOLE[2]]);
  const shelf = makePart('topBottomPanel-1', 'topBottomPanel', SHELF_POSE.position, SHELF_POSE.rotation);
  const cam = makePart('camLock-1', 'camLock', [RECESS_AT[0], RECESS_AT[1] + CAM_HALF, RECESS_AT[2]]);
  const key = makePart('allenWrench-1', 'allenWrench', KEY_AT);
  const driver = makePart('screwdriver-1', 'screwdriver', DRIVER_AT, DRIVER_FLAT);
  const parts = [side, bolt, shelf, cam, key, driver];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  const boltSeat = assembly.seat({ partA: bolt.id, connectorA: 0, partB: side.id, connectorB: BOLT_HOLE, mover: bolt.id });
  const camSeat = assembly.seat({ partA: cam.id, connectorA: 0, partB: shelf.id, connectorB: RECESS, mover: cam.id });

  const events = createBus();
  const log: StampedEvent[] = [];
  for (const type of [EVENT.SEAT, EVENT.UNSEAT, EVENT.RELEASE, EVENT.FASTEN]) events.on(type, (event) => log.push(event));
  const shown: TargetRing[][] = [];
  const listeners = new Map<string, Listener>();
  const canvas = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE }),
    setPointerCapture() {},
  };
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics: {
      grab: () => {},
      move: (body: Body, position: Vec3, rotation?: Quat) => {
        const { mesh } = parts.find((part) => part.body === body)!;
        const { pose } = body as unknown as { pose: { position: THREE.Vector3; quaternion: THREE.Quaternion } }; // makePart's fake body
        pose.position.set(...position);
        if (rotation) pose.quaternion.set(...rotation);
        mesh.position.copy(pose.position);
        mesh.quaternion.copy(pose.quaternion);
        mesh.updateMatrixWorld(true);
      },
      release: () => {},
      join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
      unjoin: () => {},
    },
    parts,
    assembly,
    events,
    targetRings: { show: (rings) => shown.push([...rings]), hide: () => {} },
  });

  let t = 0;
  const fire = (type: string, at: { clientX: number; clientY: number }) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: (t += 16), ...at });
  const screen = (point: Vec3 | THREE.Vector3) => {
    const v = (Array.isArray(point) ? new THREE.Vector3(...point) : point.clone()).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // A point on `part`, `local` from its middle, where a finger would press it.
  const on = (part: Part, local: Vec3 = [0, 0, 0]) => screen(new THREE.Vector3(...local).applyQuaternion(part.mesh.quaternion).add(part.mesh.position));

  // Carried from `from` to the screen point of `to` and let go there — or, `back`, carried
  // back and let go where it started — a frame per move.
  function carry(from: { clientX: number; clientY: number }, to: Vec3, back = false) {
    const end = screen(to);
    fire('pointerdown', from);
    for (let i = 1; i <= 8; i++) {
      fire('pointermove', { clientX: from.clientX + ((end.clientX - from.clientX) * i) / 8, clientY: from.clientY + ((end.clientY - from.clientY) * i) / 8 });
      router.update(FRAME);
    }
    const carried = router.dragging;
    const lit = shown.at(-1) ?? [];
    if (back) fire('pointermove', from);
    fire('pointerup', back ? from : end);
    return { carried, lit };
  }

  // Pressed at `from`, then swept clockwise round `centre` on screen for `turns` turns.
  function crank(from: { clientX: number; clientY: number }, centre: Vec3, turns: number) {
    const c = screen(centre);
    const radius = 60;
    fire('pointerdown', from);
    fire('pointermove', { clientX: c.clientX + radius, clientY: c.clientY });
    const mode = router.dragging?.mode;
    for (let deg = 10; deg <= 360 * turns; deg += 10) {
      const a = (deg * Math.PI) / 180;
      fire('pointermove', { clientX: c.clientX + radius * Math.cos(a), clientY: c.clientY + radius * Math.sin(a) });
      router.update(FRAME);
    }
    fire('pointerup', { clientX: c.clientX + radius, clientY: c.clientY });
    return mode;
  }

  const tap = (at: { clientX: number; clientY: number }) => {
    fire('pointerdown', at);
    fire('pointerup', at);
  };
  const near = (ring: TargetRing, point: Vec3) => ring.position.every((v, i) => Math.abs(v - point[i]) < 1e-6);
  const toolOn = (tool: Part) => assembly.all().find((j) => j.kind === KIND.TOOL && j.hardware === tool.id) ?? null;
  return { assembly, key, driver, bolt, cam, boltSeat, camSeat, log, carry, crank, tap, on, near, toolOn };
}

describe('JOHNNY\'s tool steps by touch, in build order (1.8.2.1 acceptance)', () => {
  it('Allen key onto the cam bolt and home, then the screwdriver onto the cam lock and locked — no gizmo', () => {
    const b = bench();

    // The cam lock can't be worked before its bolt is home: no ring lights on its slot.
    const early = b.carry(b.on(b.driver), SLOT, true);
    expect(early.carried?.part).toBe(b.driver);
    expect(early.lit.some((ring) => b.near(ring, SLOT))).toBe(false);
    expect(b.toolOn(b.driver)).toBeNull();

    // The Allen key carried flat to the bolt: its head lights, and letting go there seats it.
    const keyDrop = b.carry(b.on(b.key), HEAD);
    expect(keyDrop.carried?.part).toBe(b.key);
    expect(keyDrop.lit.some((ring) => b.near(ring, HEAD) && ring.strength > 0)).toBe(true);
    expect(b.toolOn(b.key)).toMatchObject({ host: 'camLockBolt-1' });
    expect(b.log.filter((e) => e.type === EVENT.RELEASE).at(-1)).toMatchObject({ part: 'allenWrench-1', seated: true });

    // Circling the seated key screws the bolt home, as cranking always has.
    const keyEnd: Vec3 = [-0.025, 0, 0];
    expect(b.crank(b.on(b.key, keyEnd), HEAD, Math.ceil(FASTENER.screwRadians / (2 * Math.PI)) + 1)).toBe('crank');
    console.log("DBG", JSON.stringify(b.assembly.get(b.boltSeat.id)!.fastener), JSON.stringify(b.toolOn(b.key)));
    expect(b.assembly.get(b.boltSeat.id)!.fastener.state).toBe(STATE.SCREWED);
    expect(b.log.some((e) => e.type === EVENT.FASTEN && e.hardware === 'camLockBolt-1')).toBe(true);

    // A tap takes the key off; the screwed bolt no longer lights for it.
    b.tap(b.on(b.key, keyEnd));
    expect(b.toolOn(b.key)).toBeNull();

    // Now the cam lock is workable: its slot lights, and the screwdriver seats there.
    const driverDrop = b.carry(b.on(b.driver), SLOT);
    expect(driverDrop.lit.some((ring) => b.near(ring, SLOT) && ring.strength > 0)).toBe(true);
    expect(b.toolOn(b.driver)).toMatchObject({ host: 'camLock-1' });

    // A turn of the screwdriver locks the cam onto the screwed bolt.
    expect(b.crank(b.on(b.driver, [0, 0.05, 0]), SLOT, 1)).toBe('crank');
    expect(b.assembly.get(b.camSeat.id)).toMatchObject({ captured: 'camLockBolt-1', fastener: { state: STATE.LOCKED } });
  });

  it('never lights the screwed bolt for the Allen key once it is home', () => {
    const b = bench();
    b.assembly.drive(b.boltSeat.id);
    const drop = b.carry(b.on(b.key), HEAD);
    expect(drop.lit.some((ring) => b.near(ring, HEAD))).toBe(false);
  });
});
