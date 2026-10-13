// Automated half of the 1.8.3.3 Polish test plan: the tool tips fit the sockets they turn,
// Shift + scroll sets a held part's height through the real seam and router (clamped at
// the floor and the ceiling, kept until Shift lets go) without ever reaching the camera,
// and the booklet's second-to-last page is the controls. Looks, trackpad feel and the page
// on a phone are Test Plan.md's.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssembly } from '../src/game/assembly.js';
import { createBooklet, gamePagesFor } from '../src/game/bookletModel.js';
import { ASSEMBLED, ITEM_ID, itemById, MANIFEST, MANUAL, PART_TYPES, resolveConnector } from '../src/game/item.js';
import { acrossOf, shapeOf } from '../src/game/partShapes.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { createLiftHold, liftRangeOf } from '../src/scene/liftHold.js';
import type { Part } from '../src/game/partMesh.js';
import type { Primitive } from '../src/game/partShapes.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The current item's fastener kinds, as the booklet reads them (itemById).
const KINDS = itemById(ITEM_ID).kinds;

const EPS = 1e-9;
const radiusOf = (p: Primitive) => (p.shape === 'cylinder' ? p.radius : Math.hypot(p.width, p.depth) / 2);

describe('AC: the tools read as tools, their tips where the connectors are', () => {
  it('seats the whole Allen key tip inside a cam bolt head', () => {
    const [short] = shapeOf(PART_TYPES.allenWrench)!;
    const tip = PART_TYPES.allenWrench.connectors[0];
    const [u, v] = acrossOf(short.axis);
    // Off the bolt's axis (the tip connector) by this much, the tip face this wide.
    const off = Math.hypot(tip.position[u] - short.position[u], tip.position[v] - short.position[v]);
    const head = shapeOf(PART_TYPES.camLockBolt)!.at(-1)!;
    expect(off + radiusOf(short)).toBeLessThanOrEqual(radiusOf(head) + EPS);
  });

  it('fits the screwdriver blade into the cam lock slot, centred on the slot connector', () => {
    const [blade] = shapeOf(PART_TYPES.screwdriver)!;
    const tip = PART_TYPES.screwdriver.connectors[0];
    const slot = shapeOf(PART_TYPES.camLock)!.find((p) => p.tone === 'dark')!;
    expect(blade.shape).toBe('box');
    expect(slot.shape).toBe('box');
    if (blade.shape !== 'box' || slot.shape !== 'box') return;
    const [u, v] = acrossOf(blade.axis);
    expect(blade.position[u]).toBe(tip.position[u]);
    expect(blade.position[v]).toBe(tip.position[v]);
    expect(blade.width).toBeLessThanOrEqual(slot.width);
    expect(blade.depth).toBeLessThanOrEqual(slot.depth);
  });

  it('keeps every hardware piece in the finished JOHNNY drawn inside its pack box', () => {
    const types = new Set(ASSEMBLED.parts.map((p) => p.type).filter((type) => shapeOf(PART_TYPES[type])));
    expect(types).toEqual(new Set(['dowel', 'camLockBolt', 'camLock', 'shelfPin', 'backFitting']));
    for (const type of types) {
      const { size } = PART_TYPES[type];
      for (const p of shapeOf(PART_TYPES[type])!) {
        const reach = [0, 1, 2].map((i) => Math.abs(p.position[i]) + (i === p.axis ? p.length / 2 : radiusOf(p)));
        reach.forEach((r, i) => expect(r).toBeLessThanOrEqual(size[i] / 2 + EPS));
      }
    }
  });
});

// The real seam and router over a recording physics stub, as holdModesAcceptance does.
type Listener = (event: object) => void;
const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

function rig() {
  const moves: Vec3[] = [];
  const releases: string[] = [];
  const kinematic = new Set<Body>();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES.fixedShelf.size));
  mesh.position.set(0, 0.008, 0);
  mesh.updateMatrixWorld(true);
  const body = {
    isKinematic: () => kinematic.has(body as unknown as Body),
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only reports its pose.
  const panel = { id: 'panel', type: 'fixedShelf', mesh, body } as unknown as Part;
  const physics = {
    grab: (b: Body) => kinematic.add(b),
    move: (_: Body, position: Vec3, rotation?: Quat) => {
      moves.push(position);
      mesh.position.set(...position);
      if (rotation) mesh.quaternion.set(...rotation);
      mesh.updateMatrixWorld(true);
    },
    release: (b: Body) => {
      kinematic.delete(b);
      releases.push('panel');
    },
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  } as unknown as PhysicsWorld; // a fake: only the calls the seam and router make
  const hold = createLiftHold(physics);
  const listeners = new Map<string, Listener>();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.2, 0.8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const cameraControls = { enable: vi.fn(), disable: vi.fn() };
  createGestureRouter({
    domElement: {
      addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      setPointerCapture() {},
    } as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls,
    physics: hold,
    parts: [panel],
    assembly: createAssembly(() => 'fixedShelf'),
    hold,
  });
  const scroll = (deltaY: number, shiftKey = true) => {
    const event = { type: 'wheel', deltaX: 0, deltaY, shiftKey, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners.get('wheel')!(event);
    hold.update(1 / 60);
    return event;
  };
  return { hold, panel, moves, releases, scroll, cameraControls };
}

describe('AC: Shift + scroll sets the height, with or without a drag, without zooming', () => {
  it('raises the part Shift holds to the ceiling and down to the floor, never past either', () => {
    const { hold, panel, moves, scroll } = rig();
    hold.begin(panel, 'key'); // Shift down: main.ts's keepShiftHold
    const [min, max] = liftRangeOf(panel, [0, 0, 0, 1]);
    for (let i = 0; i < 200; i++) scroll(-200);
    expect(hold.height).toBeCloseTo(max, 9);
    expect(moves.at(-1)![1]).toBeCloseTo(max, 9);
    for (let i = 0; i < 200; i++) scroll(200);
    expect(hold.height).toBeCloseTo(min, 9);
  });

  it('stops every Shift-scroll it uses and never touches the camera seam', () => {
    const { hold, panel, scroll, cameraControls } = rig();
    hold.begin(panel, 'key');
    const event = scroll(-100);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(cameraControls.enable).not.toHaveBeenCalled();
    expect(cameraControls.disable).not.toHaveBeenCalled();
  });

  it('keeps the height Shift + scroll set until Shift lets go, then drops it', () => {
    const { hold, panel, releases, scroll } = rig();
    hold.begin(panel, 'key');
    for (let i = 0; i < 10; i++) scroll(-100);
    const set = hold.height;
    for (let i = 0; i < 30; i++) hold.update(1 / 60);
    expect(hold.height).toBeCloseTo(set, 9);
    expect(releases).toEqual([]);
    hold.end('key'); // Shift up
    expect(releases).toEqual(['panel']);
  });

  it('leaves a plain scroll, and a Shift-scroll with nothing held, to the camera', () => {
    const { hold, panel, scroll } = rig();
    const free = scroll(-100);
    expect(free.stopImmediatePropagation).not.toHaveBeenCalled();
    hold.begin(panel, 'key');
    const before = hold.height;
    const plain = scroll(-100, false);
    expect(plain.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(hold.height).toBe(before);
  });
});

describe('AC: the booklet\'s second-to-last page shows the controls for the device in use', () => {
  it.each(['touch', 'desktop'] as const)('%s', (scheme) => {
    const pages = createBooklet(MANUAL.pages, { layout: ASSEMBLED, manifest: MANIFEST, partTypes: PART_TYPES, resolve: resolveConnector, gamePages: gamePagesFor(scheme, KINDS) });
    expect(pages.at(-2)).toEqual({ kind: 'controls', scheme, kinds: [...KINDS] });
    expect(pages.at(-1)!.kind).toBe('backCover');
  });
});
