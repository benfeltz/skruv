import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { FASTENER, GESTURE, TURN_RING } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../src/physics/world.js';
import type { GestureRouterOptions } from '../src/scene/gestureRouter.js';
import type { Dial } from '../src/ui/turnRing.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The real gesture router driving a seated tool (1.8.2.2): the turn ring, hold-to-drive and
// the ratchet, with the real catalog. A side panel lies flat, holes up, a cam bolt seated in
// one of its cam-bolt holes, and the Allen key is let go onto its head — the 1.8.2.1 way.

const SIZE = 1000;
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
  // A fake: a plain-material mesh and a body that only reports its pose.
  return { id, type, mesh, body } as unknown as Part;
}

const PANEL_POSE = { position: [0, 0.008, 0] as Vec3, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as Quat };
const CAM_BOLT_HOLE = 2;
const HOLE = connectorInWorld(PART_TYPES.sidePanel.connectors[CAM_BOLT_HOLE], PANEL_POSE).position;
const BOLT_HALF = PART_TYPES.camLockBolt.size[1] / 2;
const HEAD: Vec3 = [HOLE[0], HOLE[1] + 2 * BOLT_HALF, HOLE[2]];
// The Allen key's short leg (its tip axis, local +z) pointing straight down.
const TIP_DOWN: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const TIP = PART_TYPES.allenWrench.connectors[0].position;

// The real router over `parts`, a recording bus and dial overlay, and a fake canvas.
function mount(parts: Part[]) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);

  const physics: GestureRouterOptions['physics'] = {
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
  };
  const log: StampedEvent[] = [];
  const events = createBus();
  for (const type of [EVENT.SEAT, EVENT.UNSEAT, EVENT.FASTEN, EVENT.UNFASTEN, EVENT.GRAB]) events.on(type, (event) => log.push(event));
  // Every show the dials get (null for a hide).
  const dials: (Dial[] | null)[] = [];
  const turnRing = { show: (shown: readonly Dial[]) => dials.push([...shown]), hide: () => dials.push(null) };
  const taps: (Part | null)[] = [];
  const ratchet: number[] = [];

  const canvas = new FakeCanvas();
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics,
    parts,
    assembly,
    events,
    turnRing,
    onTap: (part) => taps.push(part),
    onRatchet: (count) => ratchet.push(count),
  });
  const screen = (point: Vec3 | THREE.Vector3) => {
    const v = (Array.isArray(point) ? new THREE.Vector3(...point) : point.clone()).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  const hold = (frames: number) => {
    for (let i = 0; i < frames; i++) router.update(FRAME);
  };
  const tap = (at: { clientX: number; clientY: number }) => {
    canvas.fire('pointerdown', at);
    canvas.fire('pointerup', at);
  };
  const fastens = () => log.filter((e) => e.type === EVENT.FASTEN);
  const clicks = () => ratchet.reduce((sum, n) => sum + n, 0);
  // Pressed at `from`, then swept `degrees` round `centre` on screen (clockwise positive),
  // `radius` px out, a frame per 10°, and let go.
  function circle(from: { clientX: number; clientY: number }, centre: Vec3, degrees: number, start = 0, radius = TURN_RING.radius) {
    const c = screen(centre);
    const at = (deg: number) => {
      const a = start + (deg * Math.PI) / 180;
      return { clientX: c.clientX + radius * Math.cos(a), clientY: c.clientY + radius * Math.sin(a) };
    };
    canvas.fire('pointerdown', from);
    canvas.fire('pointermove', at(0));
    for (let d = 10; d <= Math.abs(degrees); d += 10) {
      canvas.fire('pointermove', at(Math.sign(degrees) * d));
      router.update(FRAME);
    }
    canvas.fire('pointerup', at(degrees));
  }
  return { router, canvas, assembly, log, dials, taps, ratchet, screen, hold, tap, fastens, clicks, circle };
}

// `engaged`: the key is let go onto the seated bolt's head before the test starts.
function harness({ engaged = true } = {}) {
  const panel = makePart('sidePanel-1', 'sidePanel', PANEL_POSE.position, PANEL_POSE.rotation);
  const bolt = makePart('camLockBolt-1', 'camLockBolt', [HOLE[0], HOLE[1] + BOLT_HALF, HOLE[2]]);
  const tipOffset = new THREE.Vector3(...TIP).applyQuaternion(new THREE.Quaternion(...TIP_DOWN));
  const key = makePart('allenWrench-1', 'allenWrench', [HEAD[0] - tipOffset.x, HEAD[1] - tipOffset.y + 0.02, HEAD[2] - tipOffset.z], TIP_DOWN);
  const m = mount([panel, bolt, key]);
  const { router, canvas, assembly, log, dials, screen, hold } = m;
  const boltSeat = assembly.seat({ partA: bolt.id, connectorA: 0, partB: panel.id, connectorB: CAM_BOLT_HOLE, mover: bolt.id });
  const toolJoint = () => assembly.all().find((j) => j.kind === KIND.TOOL) ?? null;
  const progress = () => assembly.get(boltSeat.id)!.fastener.progress;
  const centre = () => screen(HEAD);
  // A point on the ring's drawn circle at `angle` (screen radians, clockwise from three
  // o'clock), or `r` px out instead.
  const ringAt = (angle: number, r: number = TURN_RING.radius) => {
    const c = centre();
    return { clientX: c.clientX + r * Math.cos(angle), clientY: c.clientY + r * Math.sin(angle) };
  };
  // The bearing on screen from the head to the key's middle: the ring the other way is clear of it.
  const keyBearing = () => {
    const c = centre();
    const k = screen(key.mesh.position);
    return Math.atan2(k.clientY - c.clientY, k.clientX - c.clientX);
  };
  const awayFromKey = () => keyBearing() + Math.PI;

  // Pressed at `from`, then swept round the head on the ring for `degrees` (clockwise on
  // screen), a frame per 10°; let go there unless `keep`.
  function sweep(from: { clientX: number; clientY: number }, start: number, degrees: number, keep = false) {
    canvas.fire('pointerdown', from);
    let at = ringAt(start);
    canvas.fire('pointermove', at);
    for (let d = 10; d <= Math.abs(degrees); d += 10) {
      at = ringAt(start + (Math.sign(degrees) * d * Math.PI) / 180);
      canvas.fire('pointermove', at);
      router.update(FRAME);
    }
    const mode = router.dragging?.mode;
    if (!keep) canvas.fire('pointerup', at);
    return mode;
  }

  if (engaged) {
    // Pressed on the key, nudged off and back past the tap distance, let go on the head.
    const at = screen(key.mesh.position);
    canvas.fire('pointerdown', at);
    canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY + 15 });
    canvas.fire('pointermove', at);
    canvas.fire('pointerup', at);
    hold(1);
    log.length = 0;
    dials.length = 0;
  }
  return { ...m, key, bolt, boltSeat, toolJoint, progress, centre, ringAt, keyBearing, awayFromKey, sweep };
}

describe('the turn ring shows on a seated tool (1.8.2.2 step 5)', () => {
  it('draws one dial round the head while the bolt is not home', () => {
    const h = harness();
    expect(h.toolJoint()).toMatchObject({ host: 'camLockBolt-1' });
    h.hold(1);
    const shown = h.dials.at(-1)!;
    expect(shown).toHaveLength(1);
    expect(shown[0].centre[0]).toBeCloseTo(h.centre().clientX, 6);
    expect(shown[0].centre[1]).toBeCloseTo(h.centre().clientY, 6);
    expect(shown[0]).toMatchObject({ progress: 0, flashing: false });
  });

  it('flashes once the bolt is home, then goes', () => {
    const h = harness();
    h.hold(1);
    h.assembly.drive(h.boltSeat.id);
    h.hold(1);
    expect(h.dials.at(-1)).toMatchObject([{ progress: 1, flashing: true }]);
    h.hold(Math.ceil(TURN_RING.flashMs / 1000 / FRAME) + 1);
    expect(h.dials.at(-1)).toBeNull();
  });

  it('shows nothing with no tool seated', () => {
    const h = harness({ engaged: false });
    h.hold(2);
    expect(h.dials.every((d) => d === null)).toBe(true);
  });
});

describe('the turn ring takes presses (1.8.2.2 step 5)', () => {
  it('cranks the bolt from a drag on the ring, as circling from the key does', () => {
    const ring = harness();
    const start = ring.awayFromKey();
    expect(ring.sweep(ring.ringAt(start), start, 180)).toBe('crank');
    const viaKey = harness();
    expect(viaKey.sweep(viaKey.screen(viaKey.key.mesh.position), start, 180)).toBe('crank');
    // Each turns the bolt by exactly the sweep its crank saw, over the bolt's two turns: from
    // the key, all 180°; from the ring, whose press is already on the circle, 170° — its
    // first 10° step is what takes it past the tap distance.
    const span = (FASTENER.screwRadians * 180) / Math.PI;
    expect(viaKey.progress()).toBeCloseTo(180 / span, 9);
    expect(ring.progress()).toBeCloseTo(170 / span, 9);
  });

  it('takes a press anywhere on the band, never inside it', () => {
    const h = harness();
    const start = h.awayFromKey();
    h.canvas.fire('pointerdown', h.ringAt(start, TURN_RING.radius + TURN_RING.band - 1));
    h.canvas.fire('pointermove', h.ringAt(start + 0.5, TURN_RING.radius + TURN_RING.band - 1));
    expect(h.router.dragging?.mode).toBe('crank');
    h.canvas.fire('pointerup', h.ringAt(start + 0.5));
  });

  it('leaves the tool seated after a tap on the ring', () => {
    const h = harness();
    h.tap(h.ringAt(h.awayFromKey()));
    expect(h.toolJoint()).not.toBeNull();
    expect(h.log.filter((e) => e.type === EVENT.UNSEAT)).toEqual([]);
    expect(h.taps).toEqual([]);
  });

  it('still takes the tool off on a tap on the tool', () => {
    const h = harness();
    h.tap(h.screen(h.key.mesh.position));
    expect(h.toolJoint()).toBeNull();
  });

  it('takes no press once the bolt is home, and the key taps off from where the ring was', () => {
    const h = harness();
    h.assembly.drive(h.boltSeat.id);
    h.hold(Math.ceil(TURN_RING.flashMs / 1000 / FRAME) + 2);
    h.tap(h.ringAt(h.awayFromKey()));
    expect(h.taps).toEqual([null]);
    expect(h.toolJoint()).not.toBeNull();
  });

  it('leaves hit-testing as it was with no tool seated: a tap there is on the panel under it', () => {
    const h = harness({ engaged: false });
    h.tap(h.ringAt(h.awayFromKey()));
    expect(h.taps.map((part) => part?.id ?? null)).toEqual(['sidePanel-1']);
  });
});

// A shelf lying recess-up with a cam lock seated in its recess and the screwdriver standing
// on its slot — no screwed bolt anywhere, so the cam can turn but never lock.
const SLOT: Vec3 = [0, 0.028, 0];
function camBench() {
  const shelf = makePart('topBottomPanel-1', 'topBottomPanel', [0.35, 0.008, 0], [1, 0, 0, 0]);
  const cam = makePart('camLock-1', 'camLock', [0, 0.022, 0]);
  const driver = makePart('screwdriver-1', 'screwdriver', [0, 0.128, 0]);
  const m = mount([shelf, cam, driver]);
  const camSeat = m.assembly.seat({ partA: cam.id, connectorA: 0, partB: shelf.id, connectorB: 2, mover: cam.id });
  m.assembly.seat({ partA: driver.id, connectorA: 0, partB: cam.id, connectorB: 1, mover: driver.id });
  return { ...m, driver, camSeat };
}

// Frames past a tap, then enough to drive any fastener home, with a few to spare.
const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;

describe('a still hold drives the fastener home (1.8.2.2 step 6)', () => {
  it('drives a seated bolt to screwed and stops there, and the key stays on after', () => {
    const h = harness();
    const at = h.screen(h.key.mesh.position);
    h.canvas.fire('pointerdown', at);
    h.hold(TAP_FRAMES + DRIVE_FRAMES);
    expect(h.assembly.get(h.boltSeat.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    h.hold(30);
    expect(h.progress()).toBe(1);
    expect(h.fastens()).toHaveLength(1);
    h.canvas.fire('pointerup', at);
    expect(h.toolJoint()).not.toBeNull();
    expect(h.log.filter((e) => e.type === EVENT.UNSEAT)).toEqual([]);
  });

  it('drives from a hold on the ring too', () => {
    const h = harness();
    const at = h.ringAt(h.awayFromKey());
    h.canvas.fire('pointerdown', at);
    h.hold(TAP_FRAMES + DRIVE_FRAMES);
    expect(h.progress()).toBe(1);
    h.canvas.fire('pointerup', at);
    expect(h.toolJoint()).not.toBeNull();
  });

  it('takes nothing for a press let go before a tap is up: it taps the key off', () => {
    const h = harness();
    const at = h.screen(h.key.mesh.position);
    h.canvas.fire('pointerdown', at);
    h.hold(TAP_FRAMES - 2);
    expect(h.progress()).toBe(0);
    h.canvas.fire('pointerup', at);
    expect(h.toolJoint()).toBeNull();
  });

  it('turns a cam with no screwed bolt in reach all the way, but never locks it', () => {
    const c = camBench();
    c.canvas.fire('pointerdown', c.screen(c.driver.mesh.position));
    c.hold(TAP_FRAMES + DRIVE_FRAMES);
    expect(c.assembly.get(c.camSeat.id)!.fastener).toMatchObject({ state: STATE.SEATED, progress: 1 });
    expect(c.fastens()).toEqual([]);
  });

  it('only ever tightens', () => {
    const h = harness();
    h.assembly.apply(h.boltSeat.id, { type: 'crank', radians: FASTENER.screwRadians / 2 });
    h.canvas.fire('pointerdown', h.screen(h.key.mesh.position));
    let last = h.progress();
    for (let i = 0; i < TAP_FRAMES + DRIVE_FRAMES; i++) {
      h.hold(1);
      expect(h.progress()).toBeGreaterThanOrEqual(last);
      last = h.progress();
    }
    expect(last).toBe(1);
  });

  it('hands over to the crank once the press moves', () => {
    const h = harness();
    const start = h.awayFromKey();
    h.canvas.fire('pointerdown', h.ringAt(start));
    h.hold(TAP_FRAMES + 10);
    const driven = h.progress();
    expect(driven).toBeGreaterThan(0);
    // Swept back the loosening way: the crank turns it back, the hold no longer drives.
    for (let d = 10; d <= 90; d += 10) {
      h.canvas.fire('pointermove', h.ringAt(start - (d * Math.PI) / 180));
      h.hold(1);
    }
    expect(h.router.dragging?.mode).toBe('crank');
    expect(h.progress()).toBeLessThan(driven);
  });
});

describe('the ratchet ticks every eighth of a turn (1.8.2.2 step 7)', () => {
  it("clicks 16 times over a bolt's two turns, held", () => {
    const h = harness();
    const at = h.screen(h.key.mesh.position);
    h.canvas.fire('pointerdown', at);
    h.hold(TAP_FRAMES + DRIVE_FRAMES);
    h.canvas.fire('pointerup', at);
    expect(h.progress()).toBe(1);
    expect(h.clicks()).toBe(16);
  });

  it("clicks 16 times over a bolt's two turns, cranked", () => {
    const h = harness();
    h.circle(h.ringAt(h.awayFromKey()), HEAD, 3 * 360, h.awayFromKey());
    expect(h.progress()).toBe(1);
    expect(h.clicks()).toBe(16);
  });

  it("clicks twice over a cam's quarter turn, held or cranked", () => {
    const held = camBench();
    const at = held.screen(held.driver.mesh.position);
    held.canvas.fire('pointerdown', at);
    held.hold(TAP_FRAMES + DRIVE_FRAMES);
    held.canvas.fire('pointerup', at);
    expect(held.clicks()).toBe(2);

    const cranked = camBench();
    cranked.circle(cranked.screen(cranked.driver.mesh.position), SLOT, 180);
    expect(cranked.assembly.get(cranked.camSeat.id)!.fastener.progress).toBe(1);
    expect(cranked.clicks()).toBe(2);
  });

  it('clicks loosening too, once per eighth crossed', () => {
    const h = harness();
    h.assembly.apply(h.boltSeat.id, { type: 'crank', radians: FASTENER.screwRadians / 2 });
    const before = h.progress() * FASTENER.screwRadians;
    h.circle(h.ringAt(h.awayFromKey()), HEAD, -120, h.awayFromKey());
    const after = h.progress() * FASTENER.screwRadians;
    expect(after).toBeLessThan(before);
    expect(h.clicks()).toBeGreaterThan(0);
    expect(h.clicks()).toBe(Math.floor(before / FASTENER.ratchetRadians) - Math.floor(after / FASTENER.ratchetRadians));
  });

  it('never clicks for a drag that turns nothing', () => {
    const h = harness();
    const bearing = h.awayFromKey();
    // Straight out along one bearing from the head: no sweep, no turn.
    h.canvas.fire('pointerdown', h.ringAt(bearing));
    for (let r = TURN_RING.radius + 5; r <= TURN_RING.radius + 60; r += 5) {
      h.canvas.fire('pointermove', h.ringAt(bearing, r));
      h.hold(1);
    }
    expect(h.router.dragging?.mode).toBe('crank');
    h.canvas.fire('pointerup', h.ringAt(bearing, TURN_RING.radius + 60));
    expect(h.progress()).toBeCloseTo(0, 9);
    expect(h.ratchet).toEqual([]);
  });

  it('puts nothing on the bus for a click', () => {
    const h = harness();
    h.circle(h.ringAt(h.awayFromKey()), HEAD, 90, h.awayFromKey());
    expect(h.clicks()).toBeGreaterThan(0);
    expect(h.log.map((e) => e.type)).toEqual([EVENT.GRAB]);
  });
});
