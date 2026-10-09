import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssembly } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint } from '../src/physics/world.js';
import type { GestureRouterOptions } from '../src/scene/gestureRouter.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The real gesture router dragging the part the elevation line holds (1.8.1 review round 1):
// the drag rides at the line's height, so a seat is offered only where the part really is,
// and letting go of the line mid-drag leaves the part where the line had it. The router
// reads the hold only through its `{ held, height }` view; this stands one in.

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
// The window's key listeners, so a spec can hold Shift down.
const keys = new Map<string, FakeListener>();
const shift = (down: boolean) => keys.get(down ? 'keydown' : 'keyup')?.({ type: down ? 'keydown' : 'keyup', key: 'Shift' });
beforeEach(() => {
  keys.clear();
  vi.stubGlobal('window', { addEventListener: (type: string, fn: FakeListener) => keys.set(type, fn), removeEventListener() {} });
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

function harness() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  // A side panel lying flat, its holes facing up; a loose dowel standing beside hole 3.
  const panel = makePart('panel', 'sidePanel', [0, 0.008, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  const dowel = makePart('dowel', 'dowel', [0.05, 0.031, -0.11]);
  const parts = [panel, dowel];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);

  const moves: Vec3[] = [];
  const physics: GestureRouterOptions['physics'] = {
    grab: () => {},
    move: (body: Body, position: Vec3) => {
      moves.push(position);
      const { mesh } = parts.find((part) => part.body === body)!;
      mesh.position.set(...position);
      mesh.updateMatrixWorld(true);
    },
    release: () => {},
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  };
  const offers: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));

  const targets: number[] = [];
  const jumps: number[] = [];
  const hold = {
    held: null as Part | null,
    height: 0,
    target: (height: number) => targets.push(height),
    jump: (height: number) => jumps.push((hold.height = height)),
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
    hold,
  });
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  // Pressed on the dowel and dragged toward the hole, still held.
  function dragDowel() {
    const at = screen([0.05, 0.031, -0.11]);
    canvas.fire('pointerdown', at);
    for (let i = 1; i <= 4; i++) canvas.fire('pointermove', { clientX: at.clientX - i * 8, clientY: at.clientY });
    return { clientX: at.clientX - 32, clientY: at.clientY };
  }
  const offered = () => offers.at(-1)?.target ?? null;
  return { router, canvas, hold, panel, dowel, moves, targets, jumps, dragDowel, offered };
}

describe('a drag of the held part rides at the line height (review round 1)', () => {
  it('offers the hole at the drag height without a hold — the fixture works', () => {
    const { dragDowel, offered } = harness();
    dragDowel();
    expect(offered()).toBe('panel');
  });

  it('withdraws the offer once the line lifts the part well clear of the hole', () => {
    const { router, hold, dowel, dragDowel, offered } = harness();
    dragDowel();
    hold.held = dowel;
    hold.height = 0.6;
    router.update(0);
    expect(offered()).toBeNull();
  });

  it('rides at the line height and keeps it, straight up, after the line lets go', () => {
    const { router, canvas, hold, dowel, moves, dragDowel, offered } = harness();
    const start = dragDowel();
    // Off the seat first, so the part is exactly where the finger puts it.
    const at = { clientX: start.clientX + 200, clientY: start.clientY };
    canvas.fire('pointermove', at);
    expect(offered()).toBeNull();
    const [x, , z] = moves.at(-1)!;
    hold.held = dowel;
    hold.height = 0.6;
    router.update(0);
    expect(moves.at(-1)![1]).toBeCloseTo(0.6, 9);
    expect(moves.at(-1)![0]).toBeCloseTo(x, 9);
    expect(moves.at(-1)![2]).toBeCloseTo(z, 9);
    // The line finger lifts; the drag finger moves on.
    hold.held = null;
    canvas.fire('pointermove', { clientX: at.clientX + 10, clientY: at.clientY });
    router.update(0);
    expect(moves.at(-1)![1]).toBeCloseTo(0.6, 9);
  });

  // Review round 2: seat assist moves y through the line, once per offer.
  it('eases the line to the seat height when a seat comes on offer for the held part', () => {
    const { router, hold, dowel, targets, dragDowel, offered } = harness();
    hold.held = dowel;
    hold.height = 0.061;
    dragDowel();
    expect(offered()).toBe('panel');
    // The dowel's end in the hole: its centre stands half its length above the hole.
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBeCloseTo(0.016 + PART_TYPES.dowel.size[1] / 2, 3);
    router.update(0);
    expect(targets).toHaveLength(1);
  });

  it('never retargets the line for a part it does not hold', () => {
    const { targets, dragDowel, offered } = harness();
    dragDowel();
    expect(offered()).toBe('panel');
    expect(targets).toEqual([]);
  });

  // Review round 3: the grab is re-anchored on where the finger puts the part, so seat
  // assist's pull is never baked into it.
  it('keeps the grab where the finger had it after assist and a hold change, once the finger moves off', () => {
    const run = (assistFor: number) => {
      const { router, canvas, hold, dowel, moves, dragDowel } = harness();
      const at = dragDowel();
      for (let i = 0; i < 10; i++) router.update(assistFor);
      hold.held = dowel;
      hold.height = 0.3;
      router.update(assistFor);
      canvas.fire('pointermove', { clientX: at.clientX + 200, clientY: at.clientY + 100 });
      return moves.at(-1)!;
    };
    const unassisted = run(0);
    const assisted = run(0.05);
    expect(assisted[0]).toBeCloseTo(unassisted[0], 9);
    expect(assisted[2]).toBeCloseTo(unassisted[2], 9);
    expect(assisted[1]).toBeCloseTo(0.3, 9);
  });

  // Review round 4: a seat on a part the line holds would be left floating when it drops.
  it('offers no seat on a part the line holds up', () => {
    const { hold, panel, dragDowel, offered } = harness();
    hold.held = panel;
    hold.height = 0.008;
    dragDowel();
    expect(offered()).toBeNull();
  });

  it('leaves a drag of any other part alone', () => {
    const { router, hold, moves, dragDowel } = harness();
    dragDowel();
    hold.held = makePart('other', 'dowel', [1, 0.015, 1]);
    hold.height = 0.6;
    router.update(0);
    expect(moves.every(([, y]) => y < 0.1)).toBe(true);
  });

  // Ben's manual pass (2026-10-09): Shift-drag (and a second finger) lifting the held part
  // moves the line with it — else the line's height pulls it straight back down.
  it.each([
    ['Shift-drag', 'shift'],
    ['a second finger', 'finger'],
  ])('a lift of the held part by %s carries the line up with it', (_, by) => {
    const { router, canvas, hold, dowel, moves, jumps, dragDowel } = harness();
    const at = dragDowel();
    hold.held = dowel;
    hold.height = 0.3;
    router.update(0);
    if (by === 'shift') {
      shift(true);
      canvas.fire('pointermove', { clientX: at.clientX, clientY: at.clientY - 120 });
    } else {
      canvas.fire('pointerdown', { pointerId: 2, clientX: 900, clientY: 800 });
      canvas.fire('pointermove', { pointerId: 2, clientX: 900, clientY: 680 });
    }
    router.update(0);
    expect(jumps.length).toBeGreaterThan(0);
    expect(hold.height).toBeGreaterThan(0.35);
    expect(moves.at(-1)![1]).toBeCloseTo(hold.height, 9);
  });
});
