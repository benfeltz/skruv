import * as THREE from 'three';
import { afterEach, beforeEach, vi } from 'vitest';
import { createAssembly } from '../../src/game/assembly.js';
import { createBus, EVENT } from '../../src/game/events.js';
import { PART_TYPES } from '../../src/game/item.js';
import { createGestureRouter } from '../../src/scene/gestureRouter.js';
import type { StampedEvent } from '../../src/game/events.js';
import type { Part } from '../../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../../src/physics/world.js';
import type { GestureRouterOptions, InsetHook } from '../../src/scene/gestureRouter.js';
import type { InsetSubject } from '../../src/game/insetModel.js';
import type { ScreenPoint } from '../../src/game/dragMath.js';
import type { Dial } from '../../src/ui/turnRing.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

// The real gesture router over fake parts, a fake canvas and a recording bus — the bench the
// stud specs (1.9.2) drive, built as test/toolDriveRouter.test.ts builds its own. Importing it
// registers the globals the router's listeners need and takes them down after each test.

export const SIZE = 1000;
export const FRAME = 1 / 60;
type FakeListener = (event: object) => void;

export class FakeCanvas {
  listeners = new Map<string, FakeListener>();
  // The bench's clock (ms): every event is stamped with it, and every frame moves it on.
  time = 0;
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
    this.listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: this.time, stopImmediatePropagation() {}, ...init });
  }
}

const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

/** A part whose body keeps its own pose, as the simulation's does (see toolDriveRouter.test.ts). */
export function makePart(id: string, type: string, position: Vec3, rotation: Quat = [0, 0, 0, 1]): Part {
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

export type ClientPoint = { clientX: number; clientY: number };

/**
 * The detail-inset hook as a recorder: what the router reports each frame, the points it tells
 * of a tap outside, the parts it asks `tapOn` of — and `consume`, the scripted answer to that.
 */
export interface InsetRecorder {
  hook: InsetHook;
  frames: { offered: InsetSubject | null; engaged: InsetSubject[] }[];
  outside: ScreenPoint[];
  tapsOn: string[];
  consume: boolean;
  /** The circle, as `covers` answers: a tap inside it is the inset's alone. */
  circle: { centre: ScreenPoint; radius: number } | null;
}

export function insetRecorder(): InsetRecorder {
  const recorder: InsetRecorder = {
    frames: [],
    outside: [],
    tapsOn: [],
    consume: false,
    circle: null,
    hook: {
      covers: ([x, y]) => recorder.circle !== null && Math.hypot(x - recorder.circle.centre[0], y - recorder.circle.centre[1]) <= recorder.circle.radius,
      candidates: (offered, engaged) => recorder.frames.push({ offered, engaged: [...engaged] }),
      tapOutside: (point) => {
        recorder.outside.push(point);
        return false;
      },
      tapOn: (part) => {
        recorder.tapsOn.push(part.id);
        return recorder.consume;
      },
    },
  };
  return recorder;
}

/** The router mounted over `parts`, with the camera looking down at the origin from above; `inset` is the recorder it reports to, if any. */
export function mount(parts: Part[], cameraAt: Vec3 = [0, 1.2, 0.8], inset?: InsetRecorder) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(...cameraAt);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);

  // Every body the router held kinematic, in order — what a part re-held at its seat shows up as.
  const grabbed: Body[] = [];
  // And every body it handed back to the simulation.
  const released: Body[] = [];
  const physics: GestureRouterOptions['physics'] = {
    grab: (body: Body) => {
      grabbed.push(body);
    },
    move: (body: Body, position: Vec3, rotation?: Quat) => {
      const { mesh } = parts.find((part) => part.body === body)!;
      const { pose } = body as unknown as { pose: { position: THREE.Vector3; quaternion: THREE.Quaternion } };
      pose.position.set(...position);
      if (rotation) pose.quaternion.set(...rotation);
      mesh.position.copy(pose.position);
      mesh.quaternion.copy(pose.quaternion);
      mesh.updateMatrixWorld(true);
    },
    release: (body: Body) => {
      released.push(body);
    },
    join: () => ({}) as PhysicsJoint,
    unjoin: () => {},
  };
  const log: StampedEvent[] = [];
  const events = createBus();
  for (const type of [EVENT.SEAT, EVENT.UNSEAT, EVENT.FASTEN, EVENT.UNFASTEN, EVENT.GRAB]) events.on(type, (event) => log.push(event));
  const dials: (Dial[] | null)[] = [];
  const turnRing = { show: (shown: readonly Dial[]) => dials.push([...shown]), hide: () => dials.push(null) };
  const taps: (Part | null)[] = [];
  // The rotate gizmo, as the item world wires it: a tap selects the part, null deselects.
  const rings = {
    selected: null as Part | null,
    hitTest: () => null,
    start() {},
    move() {},
    end() {},
    cancel() {},
  };
  const ratchet: number[] = [];
  const rehomes: string[] = [];

  const canvas = new FakeCanvas();
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement,
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics,
    parts,
    assembly,
    events,
    turnRing,
    inset: inset?.hook,
    rings,
    onTap: (part) => {
      taps.push(part);
      rings.selected = part;
    },
    onRatchet: (count) => ratchet.push(count),
    onRehome: (kind) => rehomes.push(kind),
  });
  const screen = (point: Vec3 | THREE.Vector3): ClientPoint => {
    const v = (Array.isArray(point) ? new THREE.Vector3(...point) : point.clone()).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // One frame: the clock moves on, the router updates.
  const tick = () => {
    canvas.time += FRAME * 1000;
    router.update(FRAME);
  };
  const hold = (frames: number) => {
    for (let i = 0; i < frames; i++) tick();
  };
  const tap = (at: ClientPoint) => {
    canvas.fire('pointerdown', at);
    canvas.fire('pointerup', at);
  };
  const fastens = () => log.filter((e) => e.type === EVENT.FASTEN);
  const clicks = () => ratchet.reduce((sum, n) => sum + n, 0);
  // Pressed at `from`, then swept `degrees` round `centre` on screen (clockwise positive),
  // `radius` px out, a frame per 10°, and let go.
  function circle(from: ClientPoint, centre: Vec3, degrees: number, start = 0, radius = 60) {
    const c = screen(centre);
    const at = (deg: number) => {
      const a = start + (deg * Math.PI) / 180;
      return { clientX: c.clientX + radius * Math.cos(a), clientY: c.clientY + radius * Math.sin(a) };
    };
    canvas.fire('pointerdown', from);
    canvas.fire('pointermove', at(0));
    for (let d = 10; d <= Math.abs(degrees); d += 10) {
      canvas.fire('pointermove', at(Math.sign(degrees) * d));
      tick();
    }
    canvas.fire('pointerup', at(degrees));
  }
  return { router, canvas, assembly, log, dials, taps, ratchet, rehomes, screen, hold, tap, fastens, clicks, circle, camera, grabbed, released, rings };
}
