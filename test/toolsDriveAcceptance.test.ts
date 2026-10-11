// Automated half of 1.8.2.2's acceptance (tools drive): JOHNNY's two tool steps driven by
// the turn ring and hold-to-drive, through the real router over a recording physics stub,
// with the haptics wired as src/main.ts wires them into a fake buzzer. A cam bolt stands
// seated in a side panel's cam-bolt hole; a shelf lies recess-up with a cam lock seated in
// it, its recess within capture reach of that bolt's head. The Allen key and the
// screwdriver lie flat off to the side. How it feels on a phone is the manual plan.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { FASTENER, GESTURE, TURN_RING } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { STATE } from '../src/game/fasteners.js';
import { createHaptics, CUE, cueFor, homeCue } from '../src/game/haptics.js';
import { PART_TYPES } from '../src/game/item.js';
import { ANY, createBus } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { Cue } from '../src/game/haptics.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../src/physics/world.js';
import type { Dial } from '../src/ui/turnRing.js';
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
// and mesh, while the fastener progress the router draws lands on the mesh alone.
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

// The 1.8.2.1 acceptance layout: the side panel flat, holes up, the cam bolt upright in
// cam-bolt hole 2; the shelf flipped recess-up, its recess 1 cm along x from the bolt head.
const SIDE_POSE = { position: [0, 0.008, 0] as Vec3, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as Quat };
const BOLT_HOLE = 2;
const HOLE = connectorInWorld(PART_TYPES.sidePanel.connectors[BOLT_HOLE], SIDE_POSE).position;
const BOLT_HALF = PART_TYPES.camLockBolt.size[1] / 2;
const HEAD: Vec3 = [HOLE[0], HOLE[1] + 2 * BOLT_HALF, HOLE[2]];
const RECESS = 2;
const RECESS_LOCAL = PART_TYPES.topBottomPanel.connectors[RECESS].position;
const RECESS_AT: Vec3 = [HEAD[0] + 0.01, HEAD[1], HEAD[2]];
const SHELF_POSE = {
  position: [RECESS_AT[0] - RECESS_LOCAL[0], RECESS_AT[1] + RECESS_LOCAL[1], RECESS_AT[2]] as Vec3,
  rotation: [1, 0, 0, 0] as Quat,
};
const CAM_HALF = PART_TYPES.camLock.size[1] / 2;
const SLOT: Vec3 = [RECESS_AT[0], RECESS_AT[1] + 2 * CAM_HALF, RECESS_AT[2]];
const KEY_AT: Vec3 = [HEAD[0] - 0.05, 0.002, HEAD[2] + 0.25];
const DRIVER_AT: Vec3 = [HEAD[0] + 0.1, 0.011, HEAD[2] + 0.3];
const DRIVER_FLAT: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

// The cam bolt lying on its side on the floor, 20 cm from its hole (1.8.2.1's layout).
const BOLT_FLAT = { at: [HOLE[0], 0.004, HOLE[2] - 0.2] as Vec3, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as Quat };

// `boltSeated`: the cam bolt starts standing seated in its hole (the default), else loose.
function bench({ boltSeated = true } = {}) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const side = makePart('sidePanel-1', 'sidePanel', SIDE_POSE.position, SIDE_POSE.rotation);
  const bolt = boltSeated
    ? makePart('camLockBolt-1', 'camLockBolt', [HOLE[0], HOLE[1] + BOLT_HALF, HOLE[2]])
    : makePart('camLockBolt-1', 'camLockBolt', BOLT_FLAT.at, BOLT_FLAT.rotation);
  const shelf = makePart('topBottomPanel-1', 'topBottomPanel', SHELF_POSE.position, SHELF_POSE.rotation);
  const cam = makePart('camLock-1', 'camLock', [RECESS_AT[0], RECESS_AT[1] + CAM_HALF, RECESS_AT[2]]);
  const key = makePart('allenWrench-1', 'allenWrench', KEY_AT);
  const driver = makePart('screwdriver-1', 'screwdriver', DRIVER_AT, DRIVER_FLAT);
  const parts = [side, bolt, shelf, cam, key, driver];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  const boltSeat = boltSeated ? assembly.seat({ partA: bolt.id, connectorA: 0, partB: side.id, connectorB: BOLT_HOLE, mover: bolt.id }) : null;
  const camSeat = assembly.seat({ partA: cam.id, connectorA: 0, partB: shelf.id, connectorB: RECESS, mover: cam.id });

  // The haptics as src/main.ts wires them, into a buzzer that records its cues.
  const cues: Cue[] = [];
  const haptics = createHaptics({ buzzer: (cue) => cues.push(cue) });
  const events = createBus();
  events.on(ANY, (event) => {
    const cue = cueFor(event);
    if (cue) haptics.cue(cue);
  });
  // Every show the dials get (null for a hide).
  const dials: (Dial[] | null)[] = [];
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
    turnRing: { show: (shown) => dials.push([...shown]), hide: () => dials.push(null) },
    onRatchet: () => haptics.cue(CUE.TICK),
    onRehome: (kind) => {
      const cue = homeCue(kind);
      if (cue) haptics.cue(cue);
    },
  });

  let t = 0;
  const fire = (type: string, at: { clientX: number; clientY: number }) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: (t += 16), ...at });
  const screen = (point: Vec3 | THREE.Vector3) => {
    const v = (Array.isArray(point) ? new THREE.Vector3(...point) : point.clone()).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  const on = (part: Part, local: Vec3 = [0, 0, 0]) => screen(new THREE.Vector3(...local).applyQuaternion(part.mesh.quaternion).add(part.mesh.position));
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) router.update(FRAME);
  };

  // Carried from `from` to the screen point of `to` and let go there, a frame per move.
  function carry(from: { clientX: number; clientY: number }, to: Vec3) {
    const end = screen(to);
    fire('pointerdown', from);
    for (let i = 1; i <= 8; i++) {
      fire('pointermove', { clientX: from.clientX + ((end.clientX - from.clientX) * i) / 8, clientY: from.clientY + ((end.clientY - from.clientY) * i) / 8 });
      router.update(FRAME);
    }
    fire('pointerup', end);
    router.update(FRAME);
  }

  const tap = (at: { clientX: number; clientY: number }) => {
    fire('pointerdown', at);
    fire('pointerup', at);
  };
  const toolOn = (tool: Part) => assembly.all().find((j) => j.kind === KIND.TOOL && j.hardware === tool.id) ?? null;
  const shownNow = () => dials.at(-1) ?? null;
  return { router, assembly, key, driver, bolt, cam, boltSeat, camSeat, cues, dials, fire, screen, on, frames, carry, tap, toolOn, shownNow };
}

// Consecutive ticks read as one run: how many frames ticked is the ratchet's business.
const runs = (cues: Cue[]) => cues.filter((cue, i) => cue !== CUE.TICK || cues[i - 1] !== CUE.TICK);

const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;
const FLASH_FRAMES = Math.ceil(TURN_RING.flashMs / 1000 / FRAME) + 2;

describe("JOHNNY's tool steps by ring and hold (1.8.2.2 acceptance)", () => {
  it('a hold drives the bolt home under the Allen key, then a drag on the ring locks the cam under the screwdriver — every moment buzzing in order', () => {
    const b = bench();

    // The Allen key let go onto the seated bolt's head: it engages, and its dial shows.
    b.carry(b.on(b.key), HEAD);
    expect(b.toolOn(b.key)).toMatchObject({ host: 'camLockBolt-1' });
    expect(b.shownNow()).toMatchObject([{ progress: 0, flashing: false }]);

    // A still hold on the key drives the bolt home and stops; letting go leaves the key on.
    const keyEnd: Vec3 = [-0.025, 0, 0];
    const press = b.on(b.key, keyEnd);
    b.fire('pointerdown', press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    expect(b.assembly.get(b.boltSeat!.id)!.fastener).toMatchObject({ state: STATE.SCREWED, progress: 1 });
    b.fire('pointerup', press);
    expect(b.toolOn(b.key)).not.toBeNull();

    // Home: the dial flashes, then stays full while the key is on.
    expect(b.shownNow()).toMatchObject([{ progress: 1, flashing: true }]);
    b.frames(FLASH_FRAMES);
    expect(b.shownNow()).toMatchObject([{ progress: 1, flashing: false, stalled: false }]);

    // A tap on the key takes it off, and its dial with it.
    b.tap(b.on(b.key, keyEnd));
    expect(b.toolOn(b.key)).toBeNull();
    b.frames(1);
    expect(b.shownNow()).toBeNull();

    // The screwdriver onto the cam lock's slot: it engages, and its dial shows.
    b.carry(b.on(b.driver), SLOT);
    expect(b.toolOn(b.driver)).toMatchObject({ host: 'camLock-1' });
    const [dial] = b.shownNow()!;
    expect(dial).toMatchObject({ progress: 0, flashing: false });

    // A drag round the ring, the way its arrows point, locks the cam onto the screwed bolt.
    // Pressed below the slot on screen, clear of the screwdriver standing up from it.
    const sense = dial.clockwise ? 1 : -1;
    const at = (deg: number) => {
      const a = Math.PI / 2 + (sense * deg * Math.PI) / 180;
      return { clientX: dial.centre[0] + TURN_RING.radius * Math.cos(a), clientY: dial.centre[1] + TURN_RING.radius * Math.sin(a) };
    };
    b.fire('pointerdown', at(0));
    for (let deg = 10; deg <= 150; deg += 10) {
      b.fire('pointermove', at(deg));
      b.frames(1);
    }
    b.fire('pointerup', at(150));
    expect(b.assembly.get(b.camSeat.id)).toMatchObject({ captured: 'camLockBolt-1', fastener: { state: STATE.LOCKED } });
    expect(b.toolOn(b.driver)).not.toBeNull();
    b.frames(FLASH_FRAMES);
    expect(b.shownNow()).toMatchObject([{ progress: 1, flashing: false, stalled: false }]);

    // engage, ticks, home; engage, ticks, lock — the last tick before each home.
    expect(runs(b.cues)).toEqual([CUE.ENGAGE, CUE.TICK, CUE.HOME, CUE.ENGAGE, CUE.TICK, CUE.LOCK]);
    expect(b.cues.filter((cue) => cue === CUE.TICK)).toHaveLength(16 + 2);
  });
});

// Review round 1: JOHNNY's cam recess sits a centimetre from the bolt head, so the
// screwdriver's ring lies across most of the Allen key. A press on the key is the key's.
describe("a neighbouring tool's ring never takes a press on a seated tool (review round 1)", () => {
  // The bolt driven home under the key, then the screwdriver seated on the unlocked cam: both
  // dials show — the key's full on the home bolt, the screwdriver's empty on the cam.
  function bothSeated() {
    const b = bench();
    b.carry(b.on(b.key), HEAD);
    b.assembly.drive(b.boltSeat!.id);
    b.frames(FLASH_FRAMES);
    b.carry(b.on(b.driver), SLOT);
    expect(b.toolOn(b.key)).not.toBeNull();
    expect(b.toolOn(b.driver)).toMatchObject({ host: 'camLock-1' });
    const slot = b.screen(SLOT);
    // The screwdriver's dial: the one round the slot on screen.
    const dial = b.shownNow()!.find((d) => Math.hypot(d.centre[0] - slot.clientX, d.centre[1] - slot.clientY) < 1)!;
    expect(dial).toMatchObject({ progress: 0, flashing: false });
    expect(b.shownNow()).toHaveLength(2);
    const press = b.on(b.key, [-0.025, 0, 0]);
    // The press on the key lies in the screwdriver's ring band.
    const reach = Math.hypot(press.clientX - dial.centre[0], press.clientY - dial.centre[1]);
    expect(Math.abs(reach - TURN_RING.radius)).toBeLessThanOrEqual(TURN_RING.band);
    return { ...b, press, dial };
  }

  it('takes the key off on a tap on it', () => {
    const b = bothSeated();
    b.tap(b.press);
    expect(b.toolOn(b.key)).toBeNull();
    expect(b.toolOn(b.driver)).not.toBeNull();
  });

  it('never turns the cam from a hold on the key', () => {
    const b = bothSeated();
    b.fire('pointerdown', b.press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    b.fire('pointerup', b.press);
    expect(b.assembly.get(b.camSeat.id)!.fastener).toMatchObject({ state: STATE.SEATED, progress: 0 });
    expect(b.toolOn(b.key)).not.toBeNull();
  });
});

// Test plan (1.8.2.2): the regression risks and ACs pinned end to end, beside the flow above.
describe('the ring and the hold leave the rest of the gesture alone (1.8.2.2 test plan)', () => {
  // The Allen key let go onto the seated bolt's head; its dial live.
  function keyOn() {
    const b = bench();
    b.carry(b.on(b.key), HEAD);
    const [dial] = b.shownNow()!;
    return { ...b, dial };
  }

  // Pressed on the key's end, then swept clockwise (the dial's tighten way) `degrees` round
  // the head, `radius` px out, a frame per 10°, and let go.
  function circleAt(b: ReturnType<typeof keyOn>, radius: number, degrees: number) {
    const sense = b.dial.clockwise ? 1 : -1;
    const at = (deg: number) => {
      const a = (sense * deg * Math.PI) / 180;
      return { clientX: b.dial.centre[0] + radius * Math.cos(a), clientY: b.dial.centre[1] + radius * Math.sin(a) };
    };
    b.fire('pointerdown', b.on(b.key, [-0.025, 0, 0]));
    b.fire('pointermove', at(0));
    for (let deg = 10; deg <= degrees; deg += 10) {
      b.fire('pointermove', at(deg));
      b.frames(1);
    }
    b.fire('pointerup', at(degrees));
  }

  it.each([
    ['inside the ring', FASTENER.crankDeadzone + 10],
    ['well outside it', TURN_RING.radius + TURN_RING.band + 80],
  ])('still cranks from circling %s', (_where, radius) => {
    const b = keyOn();
    circleAt(b, radius, 180);
    const progress = b.assembly.get(b.boltSeat!.id)!.fastener.progress;
    expect(progress).toBeGreaterThan(0.2);
    expect(progress).toBeLessThan(0.3);
  });

  it('stops driving when the press is cancelled, and the key stays on', () => {
    const b = keyOn();
    const press = b.on(b.key, [-0.025, 0, 0]);
    b.fire('pointerdown', press);
    b.frames(TAP_FRAMES + 20);
    const driven = b.assembly.get(b.boltSeat!.id)!.fastener.progress;
    expect(driven).toBeGreaterThan(0);
    b.fire('pointercancel', press);
    b.frames(DRIVE_FRAMES);
    expect(b.assembly.get(b.boltSeat!.id)!.fastener.progress).toBe(driven);
    expect(b.toolOn(b.key)).not.toBeNull();
  });

  it('drives home in driveSeconds at 30 fps as at 60', () => {
    const b = keyOn();
    b.fire('pointerdown', b.on(b.key, [-0.025, 0, 0]));
    const slow = 1 / 30;
    let seconds = 0;
    while (b.assembly.get(b.boltSeat!.id)!.fastener.progress < 1 && seconds < 10) {
      b.router.update(slow);
      seconds += slow;
    }
    expect(seconds).toBeGreaterThan(FASTENER.driveSeconds + GESTURE.tapMaxMs / 1000 - 2 * slow);
    expect(seconds).toBeLessThan(FASTENER.driveSeconds + GESTURE.tapMaxMs / 1000 + 2 * slow);
  });

  it('turns nothing from a hold on a key whose bolt is home, and the release leaves it on', () => {
    const b = keyOn();
    b.assembly.drive(b.boltSeat!.id);
    const before = b.cues.length;
    const press = b.on(b.key, [-0.025, 0, 0]);
    b.fire('pointerdown', press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    b.fire('pointerup', press);
    expect(b.toolOn(b.key)).not.toBeNull();
    expect(b.cues.slice(before)).toEqual([]);
  });

  it('buzzes a plain seat as seat, not engage', () => {
    const b = bench({ boltSeated: false });
    // The loose cam bolt carried from the floor into its hole by touch.
    b.carry(b.on(b.bolt), HOLE);
    expect(b.assembly.all().some((j) => j.hardware === b.bolt.id && j.kind === KIND.BOLT)).toBe(true);
    expect(b.cues).toEqual([CUE.SEAT]);
  });
});

// Review round 3: with every seated tool keeping its dial, the key's full ring on the home
// bolt all but covers the screwdriver's — a press on the screwdriver's ring is the cam's.
describe("the screwdriver's ring turns the cam with the key still on its home bolt (review round 3)", () => {
  function bothSeated() {
    const b = bench();
    b.carry(b.on(b.key), HEAD);
    b.assembly.drive(b.boltSeat!.id);
    b.frames(FLASH_FRAMES);
    b.carry(b.on(b.driver), SLOT);
    const slot = b.screen(SLOT);
    const dial = b.shownNow()!.find((d) => Math.hypot(d.centre[0] - slot.clientX, d.centre[1] - slot.clientY) < 1)!;
    return { ...b, dial };
  }

  // Bearings on screen (radians, clockwise from three o'clock) round the slot, a tool's
  // middle from its dial's centre — presses within 50° of one land on the tool itself.
  const bearing = (b: ReturnType<typeof bothSeated>, part: Part) => {
    const at = b.on(part);
    return Math.atan2(at.clientY - b.dial.centre[1], at.clientX - b.dial.centre[0]);
  };
  const apart = (a: number, c: number) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
  const ringAt = (b: ReturnType<typeof bothSeated>, angle: number) => ({
    clientX: b.dial.centre[0] + TURN_RING.radius * Math.cos(angle),
    clientY: b.dial.centre[1] + TURN_RING.radius * Math.sin(angle),
  });
  // Twelve angles round the ring, 30° apart, less those within 50° of either tool's bearing.
  function clearAngles() {
    const b = bothSeated();
    const tools = [bearing(b, b.key), bearing(b, b.driver)];
    return Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6).filter((a) => tools.every((t) => apart(a, t) > (50 * Math.PI) / 180));
  }
  // The cam and the bolt after `press` on a fresh bench, from each clear angle in turn.
  function fromEveryAngle(press: (b: ReturnType<typeof bothSeated>, angle: number) => void) {
    const angles = clearAngles();
    expect(angles.length).toBeGreaterThanOrEqual(4);
    return angles.map((angle) => {
      const b = bothSeated();
      press(b, angle);
      return {
        deg: Math.round((angle * 180) / Math.PI),
        cam: b.assembly.get(b.camSeat.id)!.fastener.state,
        bolt: b.assembly.get(b.boltSeat!.id)!.fastener,
        toolsOn: !!b.toolOn(b.key) && !!b.toolOn(b.driver),
      };
    });
  }
  const locked = (deg: number) => ({ deg, cam: STATE.LOCKED, bolt: expect.objectContaining({ state: STATE.SCREWED, progress: 1 }), toolsOn: true });

  it('locks the cam from a drag round its ring, pressed anywhere clear of the tools', () => {
    const results = fromEveryAngle((b, start) => {
      const sense = b.dial.clockwise ? 1 : -1;
      const at = (deg: number) => ringAt(b, start + (sense * deg * Math.PI) / 180);
      b.fire('pointerdown', at(0));
      for (let deg = 10; deg <= 150; deg += 10) {
        b.fire('pointermove', at(deg));
        b.frames(1);
      }
      b.fire('pointerup', at(150));
    });
    expect(results).toEqual(results.map(({ deg }) => locked(deg)));
  });

  it('locks the cam from a hold on its ring, anywhere clear of the tools', () => {
    const results = fromEveryAngle((b, angle) => {
      b.fire('pointerdown', ringAt(b, angle));
      b.frames(TAP_FRAMES + DRIVE_FRAMES);
      b.fire('pointerup', ringAt(b, angle));
    });
    expect(results).toEqual(results.map(({ deg }) => locked(deg)));
  });
});

// Review round 4: a bolt backed off partway on its ring reads screwed until it is all the way
// out, so driving it back fires no FASTEN — yet arriving home buzzes as the first time did.
describe('a bolt backed off and driven home again buzzes home again (review round 4)', () => {
  it('engage, ticks, home; then ticks backing off and driving back, and home again', () => {
    const b = bench();
    b.carry(b.on(b.key), HEAD);
    const keyEnd: Vec3 = [-0.025, 0, 0];
    const press = b.on(b.key, keyEnd);
    b.fire('pointerdown', press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    b.fire('pointerup', press);
    b.frames(FLASH_FRAMES);

    // Backed off 120° on the key's ring, pressed on the side away from the key.
    const [dial] = b.shownNow()!;
    const k = b.on(b.key);
    const away = Math.atan2(k.clientY - dial.centre[1], k.clientX - dial.centre[0]) + Math.PI;
    const sense = dial.clockwise ? -1 : 1;
    const at = (deg: number) => {
      const a = away + (sense * deg * Math.PI) / 180;
      return { clientX: dial.centre[0] + TURN_RING.radius * Math.cos(a), clientY: dial.centre[1] + TURN_RING.radius * Math.sin(a) };
    };
    b.fire('pointerdown', at(0));
    for (let deg = 10; deg <= 120; deg += 10) {
      b.fire('pointermove', at(deg));
      b.frames(1);
    }
    b.fire('pointerup', at(120));
    expect(b.assembly.get(b.boltSeat!.id)!.fastener).toMatchObject({ state: STATE.SCREWED });
    expect(b.assembly.get(b.boltSeat!.id)!.fastener.progress).toBeLessThan(1);

    b.fire('pointerdown', press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    b.fire('pointerup', press);
    expect(b.assembly.get(b.boltSeat!.id)!.fastener.progress).toBe(1);
    expect(runs(b.cues)).toEqual([CUE.ENGAGE, CUE.TICK, CUE.HOME, CUE.TICK, CUE.HOME]);
  });
});

// Test plan (1.8.2.2, after review rounds 3–5): the cam's side of re-homing, and a home dial
// still taking a press where no other ring lies under it.
describe('re-homing and home dials, end to end (1.8.2.2 test plan, round 5)', () => {
  // The bolt home under the key, the key off, the screwdriver on the cam and the cam locked by a hold.
  function camLocked() {
    const b = bench();
    b.assembly.drive(b.boltSeat!.id);
    b.carry(b.on(b.driver), SLOT);
    const press = b.on(b.driver, [0, 0.05, 0]);
    b.fire('pointerdown', press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    b.fire('pointerup', press);
    b.frames(FLASH_FRAMES);
    expect(b.assembly.get(b.camSeat.id)!.fastener.state).toBe(STATE.LOCKED);
    const [dial] = b.shownNow()!;
    return { ...b, dial, press };
  }

  // Swept `degrees` round `dial` from `from` (radians), the loosening way when `loosen`.
  function sweep(b: ReturnType<typeof camLocked>, from: number, degrees: number, loosen: boolean) {
    const sense = (b.dial.clockwise ? 1 : -1) * (loosen ? -1 : 1);
    const at = (deg: number) => {
      const a = from + (sense * deg * Math.PI) / 180;
      return { clientX: b.dial.centre[0] + TURN_RING.radius * Math.cos(a), clientY: b.dial.centre[1] + TURN_RING.radius * Math.sin(a) };
    };
    b.fire('pointerdown', at(0));
    for (let deg = 10; deg <= degrees; deg += 10) {
      b.fire('pointermove', at(deg));
      b.frames(1);
    }
    b.fire('pointerup', at(degrees));
  }

  it('buzzes lock again for a cam backed off partway on its ring and locked again', () => {
    const b = camLocked();
    // Below the slot on screen, clear of the screwdriver standing up from it.
    sweep(b, Math.PI / 2, 40, true);
    const cam = b.assembly.get(b.camSeat.id)!.fastener;
    expect(cam.state).toBe(STATE.LOCKED);
    expect(cam.progress).toBeLessThan(1);
    expect(cam.progress).toBeGreaterThan(0);
    b.fire('pointerdown', b.press);
    b.frames(TAP_FRAMES + DRIVE_FRAMES);
    b.fire('pointerup', b.press);
    expect(b.assembly.get(b.camSeat.id)!.fastener.progress).toBe(1);
    expect(runs(b.cues)).toEqual([CUE.ENGAGE, CUE.TICK, CUE.LOCK, CUE.TICK, CUE.LOCK]);
  });

  it("turns a home bolt back from its full ring where no other ring lies, with only the key on", () => {
    const b = bench();
    b.carry(b.on(b.key), HEAD);
    b.assembly.drive(b.boltSeat!.id);
    b.frames(FLASH_FRAMES);
    const shown = b.shownNow()!;
    expect(shown).toMatchObject([{ progress: 1, flashing: false, stalled: false }]);
    const [dial] = shown;
    const k = b.on(b.key);
    const away = Math.atan2(k.clientY - dial.centre[1], k.clientX - dial.centre[0]) + Math.PI;
    sweep({ ...b, dial, press: k }, away, 90, true);
    expect(b.assembly.get(b.boltSeat!.id)!.fastener.progress).toBeLessThan(1);
    expect(b.toolOn(b.key)).not.toBeNull();
  });
});
