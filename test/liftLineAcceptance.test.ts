// Automated half of the 1.8.1 test plan: the elevation line's acceptance criteria and
// regression risks, checked headlessly on the real seam, router, control and knobs. How
// it feels — the ease, two-handed use, setting a panel down upright, the second-finger
// lift going straight up under a thumb — is manual on a phone; see Test Plan.md.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIFT_LINE } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/item.js';
import { createTunables } from '../src/game/tunables.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { createLiftHold } from '../src/scene/liftHold.js';
import { createLiftLine } from '../src/ui/liftLine.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

type Call = [string, string, ...(number[] | undefined)[]];
type FakeBody = Body & { id: string };

// A recording physics stub over parts whose meshes follow their moves, as a step would,
// and whose bodies are kinematic between a grab and a release.
function fakePhysics(parts: Part[]) {
  const calls: Call[] = [];
  const kinematic = new Set<Body>();
  const round = (v: number[]) => v.map((n) => +n.toFixed(9));
  const physics = {
    grab: (b: FakeBody) => {
      kinematic.add(b);
      calls.push(['grab', b.id]);
    },
    move: (b: FakeBody, position: Vec3, rotation?: Quat) => {
      calls.push(['move', b.id, round(position), rotation && round(rotation)]);
      const part = parts.find((p) => p.body === b);
      if (!part) return;
      part.mesh.position.set(...position);
      if (rotation) part.mesh.quaternion.set(...rotation);
      part.mesh.updateMatrixWorld(true);
    },
    release: (b: FakeBody) => {
      kinematic.delete(b);
      calls.push(['release', b.id]);
    },
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  };
  return { calls, kinematic, physics: physics as unknown as PhysicsWorld };
}

function makePart(id: string, type: string, position: Vec3, kinematic: () => Set<Body>): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.updateMatrixWorld(true);
  const body = {
    id,
    isKinematic: () => kinematic().has(body as unknown as Body),
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only reports its pose.
  return { id, type, mesh, body } as unknown as Part;
}

function world() {
  const parts: Part[] = [];
  const recorder = fakePhysics(parts);
  const add = (id: string, type: string, position: Vec3) => {
    const part = makePart(id, type, position, () => recorder.kinematic);
    parts.push(part);
    return part;
  };
  return { parts, add, ...recorder };
}

describe('AC: with no finger on the line, drags and turns are exactly as before (regression risk)', () => {
  // Seeded random grab/move/release traffic over several bodies: through the idle seam
  // the physics hears exactly what it would have heard directly.
  it('passes any sequence of manipulation calls through unchanged, release included', () => {
    let seed = 1881;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 200; run++) {
      const direct = world();
      const seamed = world();
      const ids = ['a', 'b', 'c'];
      const bodies = (w: ReturnType<typeof world>) => ids.map((id) => w.add(id, 'fixedShelf', [0, 0.008, 0]).body);
      const [plain, wrapped] = [bodies(direct), bodies(seamed)];
      const hold = createLiftHold(seamed.physics);
      for (let i = 0; i < 30; i++) {
        const k = Math.floor(random() * ids.length);
        const roll = random();
        const position: Vec3 = [random(), random(), random()];
        for (const [physics, list] of [[direct.physics, plain], [hold, wrapped]] as const) {
          if (roll < 0.3) physics.grab(list[k]);
          else if (roll < 0.7) physics.move(list[k], position, roll < 0.5 ? [0, 0, 0, 1] : undefined);
          else physics.release(list[k]);
        }
      }
      expect(seamed.calls).toEqual(direct.calls);
    }
  });
});

describe('AC: lifting only lifts — the line never moves a part toward the camera', () => {
  // The real router dragging through the real hold seam: the line raises the dragged
  // part over many frames, and every pose the physics hears keeps the finger's x, z.
  const quiet = { addEventListener() {}, removeEventListener() {} };
  beforeEach(() => {
    vi.stubGlobal('window', quiet);
    vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('raises a dragged part straight up as the line eases it, frame after frame', () => {
    const w = world();
    const panel = w.add('panel', 'fixedShelf', [0, 0.008, 0]);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0, 1.4, 0.9);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const assembly = createAssembly((id) => w.parts.find((p) => p.id === id)!.type);
    const hold = createLiftHold(w.physics);
    const listeners = new Map<string, (event: object) => void>();
    const canvas = {
      addEventListener: (type: string, fn: (event: object) => void) => listeners.set(type, fn),
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      setPointerCapture() {},
    };
    const fire = (type: string, at: { clientX: number; clientY: number }) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...at });
    const router = createGestureRouter({
      domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
      camera,
      cameraControls: { enable() {}, disable() {} },
      physics: hold,
      parts: w.parts,
      assembly,
      hold,
    });
    const v = new THREE.Vector3(0.2, 0.016, 0.05).project(camera);
    const at = { clientX: ((v.x + 1) / 2) * 1000, clientY: ((1 - v.y) / 2) * 1000 };
    fire('pointerdown', at);
    fire('pointermove', { clientX: at.clientX + 30, clientY: at.clientY });
    const [, , [x, , z]] = w.calls.filter(([op]) => op === 'move').at(-1)! as [string, string, number[]];
    hold.begin(panel, 'line');
    hold.target(1.2);
    w.calls.length = 0;
    for (let frame = 0; frame < 120; frame++) {
      hold.update(1 / 60);
      router.update(1 / 60);
    }
    const moves = w.calls.filter(([op]) => op === 'move') as [string, string, number[]][];
    expect(moves.length).toBeGreaterThan(100);
    for (const [, , [mx, , mz]] of moves) {
      expect(mx).toBeCloseTo(x, 9);
      expect(mz).toBeCloseTo(z, 9);
    }
    expect(moves.at(-1)![2][1]).toBeGreaterThan(1.1);
    router.dispose();
  });
});

describe('AC: a panel stood up in mid-air drops upright when the line lets go', () => {
  it('turns at the line height, clears the floor for its new height, then hands back once', () => {
    const w = world();
    const panel = w.add('panel', 'fixedShelf', [0, 0.008, 0]);
    const hold = createLiftHold(w.physics);
    hold.begin(panel, 'line');
    hold.jump(0.5);
    // A gizmo turn stands it on end (a quarter turn about x), then lets go.
    const upended: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    hold.grab(panel.body);
    hold.move(panel.body, [0, 0.05, 0], upended);
    hold.release(panel.body);
    hold.target(0);
    for (let frame = 0; frame < 300; frame++) hold.update(1 / 60);
    const last = w.calls.filter(([op]) => op === 'move').at(-1)!;
    expect(last[3]).toEqual(upended.map((n) => +n.toFixed(9)));
    // Resting on its long edge: the line's floor is now half its depth.
    expect(last[2]![1]).toBeCloseTo(PART_TYPES.fixedShelf.size[2] / 2, 6);
    expect(w.calls.filter(([op]) => op === 'release')).toEqual([]);
    hold.end();
    expect(w.calls.filter(([op]) => op === 'release')).toEqual([['release', 'panel']]);
    expect(w.kinematic.has(panel.body)).toBe(false);
  });
});

// The control and the seam together, as main.ts wires them, on a minimal fake DOM.
describe('AC: the finger leaving the line always ends the hold', () => {
  type Listener = (event: object) => void;
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

  beforeEach(() => {
    const head = new FakeElement();
    vi.stubGlobal('document', {
      head,
      createElement: () => new FakeElement(),
      getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('%s drops the part, exactly once', (type) => {
    const w = world();
    const panel = w.add('panel', 'fixedShelf', [0, 0.008, 0]);
    const hold = createLiftHold(w.physics);
    const line = createLiftLine({
      onPress: () => hold.begin(panel, 'line'),
      onMove: () => {},
      onRelease: () => hold.end('line'),
    });
    const element = line.element as unknown as FakeElement;
    line.show(0);
    element.fire('pointerdown', 200);
    expect(hold.held).toBe(panel);
    element.fire(type);
    element.fire('lostpointercapture');
    expect(hold.held).toBeNull();
    expect(w.calls.filter(([op]) => op === 'release')).toEqual([['release', 'panel']]);
  });
});

describe('AC: gesture.liftLineX and gesture.liftLineEase are live', () => {
  const tunables = createTunables();
  afterEach(() => tunables.reset());

  it('moves the line across the screen and changes the ease on the next read', () => {
    tunables.set('gesture.liftLineX', 0.9);
    expect(LIFT_LINE.x).toBe(0.9);
    tunables.set('gesture.liftLineEase', 20);
    expect(LIFT_LINE.easeRate).toBe(20);
    const w = world();
    const panel = w.add('panel', 'fixedShelf', [0, 0.008, 0]);
    const hold = createLiftHold(w.physics);
    hold.begin(panel, 'line');
    hold.target(1);
    hold.update(0.05);
    const share = 1 - Math.exp(-20 * 0.05);
    expect(hold.height).toBeCloseTo(0.008 + (1 - 0.008) * share, 9);
  });
});
