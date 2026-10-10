import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, rotateVector } from '../tools/validate/lib/geometry.js';
import { RING, SNAP } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../src/physics/world.js';
import type { GestureRouterOptions } from '../src/scene/gestureRouter.js';
import type { TargetRing } from '../src/scene/targetRings.js';
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

// A part whose body reports its mesh's pose; moves land on the mesh, as a step would. A
// `stepped` body reports instead the pose committed at the last `step()` — as Rapier's
// kinematic bodies do, a move landing only on the next physics step.
function makePart(id: string, type: string, position: Vec3, rotation: Quat = [0, 0, 0, 1], stepped = false): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.quaternion.set(...rotation);
  mesh.updateMatrixWorld(true);
  const committed = { position: mesh.position.clone(), quaternion: mesh.quaternion.clone() };
  const at = stepped ? committed : mesh;
  const body = {
    id,
    translation: () => ({ x: at.position.x, y: at.position.y, z: at.position.z }),
    rotation: () => ({ x: at.quaternion.x, y: at.quaternion.y, z: at.quaternion.z, w: at.quaternion.w }),
    step: () => {
      committed.position.copy(mesh.position);
      committed.quaternion.copy(mesh.quaternion);
    },
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

const IDENTITY: Quat = [0, 0, 0, 1];
// Lying flat on its side: tip axis horizontal, 90° off a head that points up.
const FLAT_BESIDE: Vec3 = [HEAD[0] - TIP[0], HEAD[1] + 0.01, HEAD[2]];
const FRAME = 1 / 60;

// How far the key's tip is from pointing straight down into an upward head.
const tipMisalignment = (part: Part) => {
  const { x, y, z, w } = part.mesh.quaternion;
  return Math.acos(Math.min(1, Math.max(-1, -rotateVector([x, y, z, w], PART_TYPES.allenWrench.connectors[0].axis)[1])));
};

interface Options {
  seated?: boolean;
  keyAt?: Vec3;
  keyRotation?: Quat;
  extra?: { type: string; at: Vec3; rotation?: Quat };
  screwed?: boolean;
  // A bolt lying loose somewhere else, instead of standing in the hole.
  boltAt?: { at: Vec3; rotation: Quat };
  // Bodies report their pose as of the last physics step, not the last move.
  stepped?: boolean;
}

function harness({ seated = true, keyAt, keyRotation = TIP_DOWN, extra, screwed = false, boltAt, stepped = false }: Options = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const panel = makePart('sidePanel-1', 'sidePanel', PANEL_POSE.position, PANEL_POSE.rotation);
  const bolt = boltAt ? makePart('camLockBolt-1', 'camLockBolt', boltAt.at, boltAt.rotation) : makePart('camLockBolt-1', 'camLockBolt', [HOLE[0], HOLE[1] + BOLT_HALF, HOLE[2]]);
  // Tip-down, its tip a little above the head, beside it.
  const tipOffset = new THREE.Vector3(...TIP).applyQuaternion(new THREE.Quaternion(...keyRotation));
  const key = makePart('allenWrench-1', 'allenWrench', keyAt ?? [HEAD[0] - tipOffset.x, HEAD[1] - tipOffset.y + 0.02, HEAD[2] - tipOffset.z], keyRotation, stepped);
  const parts = [panel, bolt, key];
  if (extra) parts.push(makePart(`${extra.type}-9`, extra.type, extra.at, extra.rotation));
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  if (seated) {
    const joint = assembly.seat({ partA: bolt.id, connectorA: 0, partB: panel.id, connectorB: CAM_BOLT_HOLE, mover: bolt.id });
    if (screwed) assembly.drive(joint.id);
  }

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
  const releases: StampedEvent[] = [];
  const unseats: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  events.on(EVENT.SEAT, (event) => seats.push(event));
  events.on(EVENT.RELEASE, (event) => releases.push(event));
  events.on(EVENT.UNSEAT, (event) => unseats.push(event));

  // Every show the rings get, and how many hides.
  const shown: TargetRing[][] = [];
  const ringCalls = { hides: 0 };
  const targetRings = { show: (rings: readonly TargetRing[]) => shown.push([...rings]), hide: () => ringCalls.hides++ };

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
  const hold = (frames: number) => {
    for (let i = 0; i < frames; i++) router.update(FRAME);
  };
  return { router, canvas, assembly, parts, panel, bolt, key, camera, drag, hold, screen, offered, seats, toolJoints, shown, ringCalls, releases, unseats };
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

// Review round 1: a snap pairs connectors either way round, so a loose bolt carried to a
// resting key would seat the key on it just the same.
describe('a loose bolt carried to a tool never seats it either (review round 1)', () => {
  // The Allen key lying flat on the floor, clear of the panel; a loose bolt beside it, its
  // head facing the key's tip 2 cm away and pointing straight back at it.
  const KEY_AT: Vec3 = [0.3, 0.004, 0.3];
  const KEY_TIP: Vec3 = [KEY_AT[0] + TIP[0], KEY_AT[1] + TIP[1], KEY_AT[2] + TIP[2]];
  const HEAD_BACK: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // the bolt's +y (head) onto -z
  const boltAt = { at: [KEY_TIP[0], KEY_TIP[1], KEY_TIP[2] + 0.02 + BOLT_HALF] as Vec3, rotation: HEAD_BACK };

  it.each([
    [0, 15],
    [15, 0],
    [0, -15],
  ])('offers the resting key no seat on the dragged bolt (nudged %i, %i px)', (dx, dy) => {
    const { canvas, bolt, drag, router, offered, toolJoints } = harness({ seated: false, keyAt: KEY_AT, keyRotation: IDENTITY, boltAt });
    const at = drag(bolt, dx, dy);
    expect(router.dragging?.part).toBe(bolt);
    expect(offered()).toBeNull();
    canvas.fire('pointerup', at);
    expect(toolJoints()).toEqual([]);
  });
});

describe('a carried tool aims itself (1.8.2.1 step 4)', () => {
  it('turns a flat Allen key near a seated bolt to point into it while the finger holds still, and offers the seat', () => {
    const { canvas, key, drag, hold, offered, toolJoints } = harness({ keyAt: FLAT_BESIDE, keyRotation: IDENTITY });
    const at = drag(key);
    // Picked up flat it is 90° off: no seat on offer yet.
    expect(tipMisalignment(key)).toBeCloseTo(Math.PI / 2, 6);
    expect(offered()).toBeNull();
    // No pointer events from here on: the aim runs from update() alone.
    hold(60);
    expect(tipMisalignment(key)).toBeLessThan(SNAP.maxAngle);
    expect(offered()).toBe('camLockBolt-1');
    canvas.fire('pointerup', at);
    expect(toolJoints()).toHaveLength(1);
  });

  it('leaves a key outside the aim zone exactly as it was picked up', () => {
    const { key, drag, hold, offered } = harness({ keyAt: [HEAD[0] + 0.45, HEAD[1], HEAD[2]], keyRotation: IDENTITY });
    drag(key);
    const before = key.mesh.quaternion.toArray();
    hold(60);
    expect(key.mesh.quaternion.toArray()).toEqual(before);
    expect(offered()).toBeNull();
  });

  it('never aims at a loose bolt', () => {
    const { key, drag, hold } = harness({ seated: false, keyAt: FLAT_BESIDE, keyRotation: IDENTITY });
    drag(key);
    const before = key.mesh.quaternion.toArray();
    hold(60);
    expect(key.mesh.quaternion.toArray()).toEqual(before);
  });

  it.each([
    ['a dowel lying beside the bolt', { type: 'dowel', at: [HEAD[0] - 0.03, HEAD[1], HEAD[2]] as Vec3, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as Quat }],
    ['a panel carried over it', { type: 'topBottomPanel', at: [HEAD[0], HEAD[1] + 0.1, HEAD[2] + 0.1] as Vec3 }],
  ])('never turns %s', (_, extra) => {
    const { parts, drag, hold, router, offered } = harness({ extra });
    const part = parts.at(-1)!;
    drag(part);
    expect(router.dragging?.part).toBe(part);
    expect(offered()).toBeNull();
    const before = part.mesh.quaternion.toArray();
    hold(60);
    expect(part.mesh.quaternion.toArray()).toEqual(before);
  });
});

describe('rings light the fasteners a carried tool can work (1.8.2.1 step 6)', () => {
  const headRing = (shown: TargetRing[][]) => shown.at(-1)?.find(({ position }) => position.every((v, i) => Math.abs(v - HEAD[i]) < 1e-6));

  it('lights a seated, unscrewed bolt near the finger and puts the rings away on release', () => {
    const { router, canvas, key, drag, shown, ringCalls } = harness({ keyAt: FLAT_BESIDE, keyRotation: IDENTITY });
    const at = drag(key);
    router.update(0);
    expect(headRing(shown)?.strength).toBeGreaterThan(0);
    const hides = ringCalls.hides;
    canvas.fire('pointerup', at);
    expect(ringCalls.hides).toBeGreaterThan(hides);
  });

  it.each([
    ['a loose bolt', { seated: false }],
    ['a bolt already screwed home', { screwed: true }],
  ])('never lights %s', (_, options) => {
    const { router, key, drag, shown } = harness({ keyAt: FLAT_BESIDE, keyRotation: IDENTITY, ...options });
    drag(key);
    router.update(0);
    expect(shown.length).toBeGreaterThan(0);
    expect(headRing(shown)).toBeUndefined();
  });

  it('draws no rings while anything but a tool is dragged', () => {
    const { router, parts, drag, shown } = harness({ extra: { type: 'dowel', at: [HEAD[0] - 0.03, HEAD[1], HEAD[2]], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } });
    drag(parts.at(-1)!);
    router.update(0);
    expect(shown).toEqual([]);
  });
});

describe('letting a tool go over a lit ring seats it (1.8.2.1 step 7)', () => {
  // Pressed on `part`, carried until the finger is `miss` px right of the bolt head on
  // screen, then let go — with no frame in between, so nothing aims.
  function dropOverHead(h: ReturnType<typeof harness>, part: Part, miss = 0) {
    const from = h.screen(part.mesh.position.toArray());
    const head = h.screen(HEAD);
    h.canvas.fire('pointerdown', from);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      h.canvas.fire('pointermove', {
        clientX: from.clientX + ((head.clientX + miss - from.clientX) * i) / steps,
        clientY: from.clientY + ((head.clientY - from.clientY) * i) / steps,
      });
    }
    expect(h.router.dragging?.part).toBe(part);
    expect(h.offered()).toBeNull();
    h.canvas.fire('pointerup', { clientX: head.clientX + miss, clientY: head.clientY });
  }
  // Off-axis and off to the side: no snap would ever be offered from here.
  const OFF_AXIS = { keyAt: [HEAD[0] + 0.15, HEAD[1], HEAD[2] + 0.1] as Vec3, keyRotation: IDENTITY };

  it('seats a far, off-axis Allen key on the ring under the finger, with the SEAT event', () => {
    const h = harness(OFF_AXIS);
    dropOverHead(h, h.key);
    expect(h.toolJoints()).toHaveLength(1);
    expect(h.toolJoints()[0]).toMatchObject({ hardware: 'allenWrench-1', host: 'camLockBolt-1' });
    expect(h.seats.at(-1)).toMatchObject({ hardware: 'allenWrench-1', host: 'camLockBolt-1' });
    expect(h.releases.at(-1)).toMatchObject({ part: 'allenWrench-1', seated: true });
    // Seated as a snap seats it: tip straight down into the head.
    expect(tipMisalignment(h.key)).toBeCloseTo(0, 6);
  });

  // Review round 1: under Rapier a kinematic move lands on the next step, so the seat just
  // made must not be judged on the tool's pre-drop pose — a far drop would unseat at once.
  it('keeps a far drop seated while the physics step has yet to carry the tool there', () => {
    const h = harness({ ...OFF_AXIS, keyAt: [HEAD[0] + 0.15, HEAD[1] + 0.08, HEAD[2] + 0.1], stepped: true });
    dropOverHead(h, h.key);
    expect(h.toolJoints()).toHaveLength(1);
    expect(h.unseats).toEqual([]);
  });

  it('does not seat it let go outside the hit radius', () => {
    const h = harness(OFF_AXIS);
    dropOverHead(h, h.key, RING.hitRadius + 20);
    expect(h.toolJoints()).toEqual([]);
    expect(h.releases.at(-1)).toMatchObject({ part: 'allenWrench-1', seated: false });
  });

  it('never seats it over a loose bolt: no ring lights there', () => {
    const h = harness({ ...OFF_AXIS, seated: false });
    dropOverHead(h, h.key);
    expect(h.toolJoints()).toEqual([]);
  });

  it('leaves anything but a tool unaffected over a ring point', () => {
    const h = harness({ extra: { type: 'dowel', at: [HEAD[0] + 0.15, HEAD[1], HEAD[2] + 0.1], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } });
    const before = h.assembly.all().length;
    dropOverHead(h, h.parts.at(-1)!);
    expect(h.assembly.all()).toHaveLength(before);
    expect(h.seats).toEqual([]);
  });
});

// Review round 2: the screwdriver's tip is 10 cm from its middle, so an aim that turned it
// about its middle swung the tip away from the slot and through the panel under it. A shelf
// lies recess-up with a cam lock seated in it; the screwdriver lies flat on the shelf, its
// tip 3.5 cm short of the cam lock's slot.
describe('a carried screwdriver aims about its tip (review round 2)', () => {
  const SHELF_POSE = { position: [0, 0.008, 0] as Vec3, rotation: [1, 0, 0, 0] as Quat };
  const RECESS = 2;
  const SHELF_TOP = 0.016;
  const recess = connectorInWorld(PART_TYPES.topBottomPanel.connectors[RECESS], SHELF_POSE).position;
  const CAM_HALF = PART_TYPES.camLock.size[1] / 2;
  const SLOT: Vec3 = [recess[0], recess[1] + 2 * CAM_HALF, recess[2]];
  const DRIVER_FLAT: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // its tip (local -y) onto +x
  const DRIVER = PART_TYPES.screwdriver.connectors[0];
  const DRIVER_HALF = PART_TYPES.screwdriver.size[0] / 2;

  function camHarness() {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0, 1.2, 0.8);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const shelf = makePart('topBottomPanel-1', 'topBottomPanel', SHELF_POSE.position, SHELF_POSE.rotation);
    const cam = makePart('camLock-1', 'camLock', [recess[0], recess[1] + CAM_HALF, recess[2]]);
    const driver = makePart('screwdriver-1', 'screwdriver', [SLOT[0] - 0.035 + DRIVER.position[1], SHELF_TOP + DRIVER_HALF, SLOT[2]], DRIVER_FLAT);
    const parts = [shelf, cam, driver];
    const typeById = new Map(parts.map(({ id, type }) => [id, type]));
    const assembly = createAssembly((id) => typeById.get(id)!);
    assembly.seat({ partA: cam.id, connectorA: 0, partB: shelf.id, connectorB: RECESS, mover: cam.id });
    const offers: StampedEvent[] = [];
    const events = createBus();
    events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
    const canvas = new FakeCanvas();
    const router = createGestureRouter({
      domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
      camera,
      cameraControls: { enable() {}, disable() {} },
      physics: {
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
      },
      parts,
      assembly,
      events,
    });
    const v = driver.mesh.position.clone().project(camera);
    const at = { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
    canvas.fire('pointerdown', at);
    canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 8 });
    canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 16 });
    const tip = () => new THREE.Vector3(...DRIVER.position).applyQuaternion(driver.mesh.quaternion).add(driver.mesh.position);
    return { router, canvas, driver, tip, finger: { clientX: at.clientX, clientY: at.clientY + 16 }, offered: () => offers.at(-1)?.target ?? null };
  }

  it('turns it upright over the slot, held still, keeping its tip clear of the shelf, and offers the slot', () => {
    const { router, driver, tip, offered } = camHarness();
    expect(router.dragging?.part).toBe(driver);
    expect(offered()).toBeNull();
    const before = tip().distanceTo(new THREE.Vector3(...SLOT));
    for (let i = 0; i < 180; i++) {
      router.update(FRAME);
      expect(tip().y).toBeGreaterThan(SHELF_TOP);
    }
    expect(offered()).toBe('camLock-1');
    expect(tip().distanceTo(new THREE.Vector3(...SLOT))).toBeLessThan(before);
  });
});

describe('a turned tool carries on from where the aim left it (review round 2)', () => {
  it('stays put when the finger next moves a pixel, rather than jumping back to the old grab', () => {
    const h = harness({ keyAt: FLAT_BESIDE, keyRotation: IDENTITY });
    const at = h.drag(h.key);
    // Turned partway, still short of an offer.
    h.hold(3);
    expect(h.offered()).toBeNull();
    const before = h.key.mesh.position.clone();
    h.canvas.fire('pointermove', { clientX: at.clientX + 1, clientY: at.clientY });
    expect(h.key.mesh.position.distanceTo(before)).toBeLessThan(0.003);
  });
});
