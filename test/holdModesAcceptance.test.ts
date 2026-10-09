// Automated half of the 1.8.1 manual-pass round (Ben, 2026-10-09): Shift as the desktop's
// hold beside the line, a lift of the held part carrying the line, and a hold started with
// a seat already on offer gliding into it. The real seam, router and control over a
// recording physics stub. How it feels on a trackpad and a phone is Test Plan.md.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssembly } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/item.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { createLiftHold } from '../src/scene/liftHold.js';
import { createLiftLine } from '../src/ui/liftLine.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

type Listener = (event: object) => void;
type Move = [string, Vec3];

// Parts whose meshes follow their moves, as a step would; bodies kinematic between a grab
// and a release.
function world() {
  const parts: Part[] = [];
  const kinematic = new Set<Body>();
  const moves: Move[] = [];
  const releases: string[] = [];
  const idOf = (body: Body) => parts.find((p) => p.body === body)!.id;
  const physics = {
    grab: (b: Body) => kinematic.add(b),
    move: (b: Body, position: Vec3, rotation?: Quat) => {
      moves.push([idOf(b), position]);
      const { mesh } = parts.find((p) => p.body === b)!;
      mesh.position.set(...position);
      if (rotation) mesh.quaternion.set(...rotation);
      mesh.updateMatrixWorld(true);
    },
    release: (b: Body) => {
      kinematic.delete(b);
      releases.push(idOf(b));
    },
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  } as unknown as PhysicsWorld; // a fake: only the calls the seam and router make
  function add(id: string, type: string, position: Vec3, rotation: Quat = [0, 0, 0, 1]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
    mesh.position.set(...position);
    mesh.quaternion.set(...rotation);
    mesh.updateMatrixWorld(true);
    const body = {
      isKinematic: () => kinematic.has(body as unknown as Body),
      translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
      rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
    };
    // A fake: a plain-material mesh and a body that only reports its pose.
    const part = { id, type, mesh, body } as unknown as Part;
    parts.push(part);
    return part;
  }
  return { parts, physics, moves, releases, add, lastY: (id: string) => moves.filter(([m]) => m === id).at(-1)![1][1] };
}

// The window's key listeners, so a spec can hold Shift down.
const keys = new Map<string, Listener>();
const shift = (down: boolean) => keys.get(down ? 'keydown' : 'keyup')?.({ type: down ? 'keydown' : 'keyup', key: 'Shift' });
const quiet = { addEventListener() {}, removeEventListener() {} };

function rig(w: ReturnType<typeof world>) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const typeById = new Map(w.parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  const hold = createLiftHold(w.physics);
  const listeners = new Map<string, Listener>();
  const canvas = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    setPointerCapture() {},
  };
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics: hold,
    parts: w.parts,
    assembly,
    hold,
  });
  const fire = (type: string, at: { clientX: number; clientY: number }) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...at });
  const screen = (point: Vec3) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * 1000, clientY: ((1 - v.y) / 2) * 1000 };
  };
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      hold.update(1 / 60);
      router.update(1 / 60);
    }
  };
  return { hold, router, fire, screen, frames };
}

beforeEach(() => {
  keys.clear();
  vi.stubGlobal('window', { addEventListener: (type: string, fn: Listener) => keys.set(type, fn), removeEventListener() {} });
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

describe('AC: Shift and the line keep one part up together; it drops when the last lets go', () => {
  class FakeElement {
    children: FakeElement[] = [];
    className = '';
    hidden = false;
    textContent = '';
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    listeners = new Map<string, Listener[]>();
    declare id?: string; // set on the style element
    setAttribute() {}
    append(...nodes: FakeElement[]) {
      this.children.push(...nodes);
    }
    addEventListener(type: string, fn: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    setPointerCapture() {}
    getBoundingClientRect() {
      return { top: 100, height: 400, left: 0, width: 48 };
    }
    fire(type: string, clientY = 0) {
      for (const fn of this.listeners.get(type) ?? []) fn({ type, pointerId: 1, clientY });
    }
  }

  it('sets a height with the knob, keeps it on Shift after the pointer lets go, drops on Shift up', () => {
    const head = new FakeElement();
    vi.stubGlobal('document', { head, createElement: () => new FakeElement(), getElementById: () => null });
    const w = world();
    const panel = w.add('panel', 'fixedShelf', [0, 0.008, 0]);
    const hold = createLiftHold(w.physics);
    // As main.ts wires them: the line and Shift are both keepers of the same hold.
    const line = createLiftLine({ onPress: () => hold.begin(panel, 'line'), onMove: () => hold.jump(0.9), onRelease: () => hold.end('line') });
    const element = line.element as unknown as FakeElement;
    line.show(0);
    element.fire('pointerdown', 480);
    element.fire('pointermove', 200);
    hold.begin(panel, 'key'); // Shift goes down
    element.fire('pointerup');
    for (let i = 0; i < 30; i++) hold.update(1 / 60);
    expect(hold.held).toBe(panel);
    expect(w.lastY('panel')).toBeCloseTo(0.9, 9);
    expect(w.releases).toEqual([]);
    hold.end('key'); // Shift comes up
    expect(hold.held).toBeNull();
    expect(w.releases).toEqual(['panel']);
  });
});

describe('AC: a Shift-drag lift of the part Shift holds raises it, and it stays up after the drag', () => {
  it('lifts through the real seam and router, straight up, and keeps the height once the pointer lets go', () => {
    const w = world();
    const panel = w.add('panel', 'fixedShelf', [0, 0.008, 0]);
    const { hold, fire, screen, frames } = rig(w);
    const at = screen([0.1, 0.016, 0.05]);
    fire('pointerdown', at);
    fire('pointermove', { clientX: at.clientX + 30, clientY: at.clientY });
    shift(true);
    hold.begin(panel, 'key'); // main.ts's keepShiftHold, the next frame
    frames(1);
    const [x, , z] = w.moves.at(-1)![1];
    for (let dy = 20; dy <= 200; dy += 20) fire('pointermove', { clientX: at.clientX + 30, clientY: at.clientY - dy });
    frames(10);
    const raised = w.lastY('panel');
    expect(raised).toBeGreaterThan(0.2);
    expect(hold.height).toBeCloseTo(raised, 9);
    const [lx, , lz] = w.moves.at(-1)![1];
    expect(lx).toBeCloseTo(x, 9);
    expect(lz).toBeCloseTo(z, 9);
    fire('pointerup', { clientX: at.clientX + 30, clientY: at.clientY - 200 });
    frames(30);
    expect(w.releases).toEqual([]);
    expect(w.lastY('panel')).toBeCloseTo(raised, 9);
    hold.end('key');
    expect(w.releases).toEqual(['panel']);
  });
});

describe('AC: a hold started with a seat already on offer glides into it — no jump on release', () => {
  it('eases the held dowel to the seat height before it is let go', () => {
    const w = world();
    // A side panel lying flat, its holes facing up; a loose dowel standing beside hole 3.
    w.add('panel', 'sidePanel', [0, 0.008, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    const dowel = w.add('dowel', 'dowel', [0.05, 0.031, -0.11]);
    const { hold, fire, screen, frames } = rig(w);
    const at = screen([0.05, 0.031, -0.11]);
    fire('pointerdown', at);
    for (let i = 1; i <= 4; i++) fire('pointermove', { clientX: at.clientX - i * 8, clientY: at.clientY });
    frames(3); // seat assist pulls it partway
    hold.begin(dowel, 'key');
    frames(120);
    const seatY = 0.016 + PART_TYPES.dowel.size[1] / 2;
    expect(w.lastY('dowel')).toBeCloseTo(seatY, 3);
  });
});
