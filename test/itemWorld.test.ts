import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA, COLORS, PHYSICS } from '../src/constants.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { createBus } from '../src/game/events.js';
import { createHaptics } from '../src/game/haptics.js';
import { ITEM_ID, ITEM_IDS, MANIFEST, PART_TYPES, setItem } from '../src/game/item.js';
import { createItemSlot } from '../src/game/itemSlot.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import { createCameraControls } from '../src/scene/cameraControls.js';
import { createInk } from '../src/scene/ink.js';
import { createItemWorld } from '../src/scene/itemWorld.js';
import type { Body } from '../src/physics/world.js';
import type { BookletPages, ItemWorldDeps } from '../src/scene/itemWorld.js';

// The swap's honesty gate (1.9.1): an item world built and disposed leaves the room as it
// found it — scene children, physics bodies, colliders and joints, DOM nodes and every
// listener it bound back at the baseline — so a swap is dispose then create, never a leak.
// Real Three scene, real Rapier, the real router, booklet sheet, line and dial on a minimal
// fake DOM. Only the booklet's page drawing is a stand-in: it renders through WebGL, and
// draws nothing the leak could hide in.

type Listener = (event: object) => void;

// Counts what is bound on it, by type.
class FakeTarget {
  listeners: { type: string; fn: Listener }[] = [];
  addEventListener(type: string, fn: Listener) {
    this.listeners.push({ type, fn });
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn);
  }
  dispatch(type: string, event: object) {
    for (const l of this.listeners.filter((l) => l.type === type)) l.fn({ type, ...event });
  }
}

class FakeElement extends FakeTarget {
  tag: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  hidden = false;
  disabled = false;
  textContent = '';
  className = '';
  id?: string;
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
  getContext() {
    return { drawImage() {} };
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 800 };
  }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
}

// The room's canvas, as OrbitControls and the router use it.
class FakeCanvas extends FakeElement {
  clientWidth = 800;
  clientHeight = 800;
  ownerDocument = new FakeTarget();
  constructor() {
    super('canvas');
  }
  getRootNode() {
    return this.ownerDocument;
  }
}

let body: FakeElement;
let head: FakeElement;
let documentTarget: FakeTarget;
let windowTarget: FakeTarget;

beforeEach(() => {
  body = new FakeElement('body');
  head = new FakeElement('head');
  documentTarget = new FakeTarget();
  windowTarget = new FakeTarget();
  vi.stubGlobal('document', {
    body,
    head,
    visibilityState: 'visible',
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
    addEventListener: documentTarget.addEventListener.bind(documentTarget),
    removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
  });
  vi.stubGlobal('window', {
    // Rapier's step reads its timers off window.performance; without it the WASM panics.
    performance: globalThis.performance,
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
  });
});
afterEach(() => vi.unstubAllGlobals());

// A booklet of three blank pages that draws nothing.
const pages = (): BookletPages => ({
  count: 3,
  pages: [{ kind: 'cover' }, { kind: 'inventory' }, { kind: 'back' }] as BookletPages['pages'],
  canvas: () => ({}) as HTMLCanvasElement,
  prerender() {},
  dispose() {},
});

/** The persistent engine an item world is built into, as src/main.ts makes it. */
async function engine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(...CAMERA.startPosition);
  const canvas = new FakeCanvas();
  const physics = await createPhysicsWorld();
  const cameraControls = createCameraControls(camera, canvas as unknown as HTMLElement); // a fake: listeners, style, rect
  const deps: ItemWorldDeps = {
    scene,
    camera,
    domElement: canvas as unknown as HTMLElement,
    physics,
    cameraControls,
    events: createBus(),
    haptics: createHaptics({ buzzer: () => {} }),
    isFree: () => true,
    ink: createInk(),
    pages,
  };
  // Everything a world could leave behind, counted.
  const census = () => ({
    scene: scene.children.length,
    physics: physics.census(),
    body: body.children.length,
    canvasListeners: canvas.listeners.length,
    documentListeners: documentTarget.listeners.length,
    windowListeners: windowTarget.listeners.length,
  });
  return { deps, physics, canvas, census };
}

const run = (world: { update(delta: number): void }, seconds: number) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) world.update(PHYSICS.timestep);
};

describe('the item world comes and goes without a trace', () => {
  it('create → dispose → create → dispose leaves the room at its baseline both times', async () => {
    const { deps: engineDeps, census } = await engine();
    const baseline = census();
    // The world's own bodies, so a joint can be put between two of them: a fresh world has no
    // joints, and dispose must still take back the ones a build leaves in it.
    const made: Body[] = [];
    const deps: ItemWorldDeps = {
      ...engineDeps,
      physics: {
        ...engineDeps.physics,
        register(...args) {
          const body = engineDeps.physics.register(...args);
          made.push(body);
          return body;
        },
      },
    };

    for (let round = 0; round < 2; round++) {
      made.length = 0;
      const world = createItemWorld(deps);
      const built = census();
      // It really built something: every packed part, the box and the lid as
      // bodies, its meshes and overlays, its page furniture and listeners.
      expect(built.physics.registered, `round ${round}`).toBeGreaterThan(MANIFEST.length);
      expect(built.scene, `round ${round}`).toBeGreaterThan(baseline.scene);
      expect(built.body, `round ${round}`).toBeGreaterThan(baseline.body);
      expect(built.canvasListeners, `round ${round}`).toBeGreaterThan(baseline.canvasListeners);
      expect(built.windowListeners, `round ${round}`).toBeGreaterThan(baseline.windowListeners);
      expect(built.documentListeners, `round ${round}`).toBeGreaterThan(baseline.documentListeners);
      // A moment of play first, so teardown meets a settled, stepping world.
      run(world, 0.5);
      engineDeps.physics.join(made[0], made[1], { anchorA: [0, 0, 0], anchorB: [0, 0, 0], rotation: [0, 0, 0, 1] }, 'rigid');
      expect(census().physics.joints, `round ${round}`).toBeGreaterThan(baseline.physics.joints);
      world.dispose();
      expect(census(), `round ${round}`).toEqual(baseline);
    }
  });

  it("frees every geometry and material it put in the scene — meshes, lines and the drop guide's plain Line alike", async () => {
    const { deps } = await engine();
    const before = new Set(deps.scene.children);
    const world = createItemWorld(deps);
    const held = new Set<{ dispose(): void }>();
    for (const root of deps.scene.children.filter((child) => !before.has(child)))
      root.traverse((object) => {
        if (!('geometry' in object) || !(object.geometry instanceof THREE.BufferGeometry)) return;
        held.add(object.geometry);
        if ('material' in object) for (const material of [object.material].flat() as THREE.Material[]) held.add(material);
      });
    // The room's ink is borrowed, not the world's to free.
    const borrowed = [deps.ink.lines, deps.ink.hull];
    for (const material of borrowed) held.delete(material);
    expect(held.size).toBeGreaterThan(0);
    const freed = new Set<unknown>();
    for (const resource of held) vi.spyOn(resource, 'dispose').mockImplementation(() => freed.add(resource));
    world.dispose();
    expect([...held].filter((resource) => !freed.has(resource))).toEqual([]);
    vi.restoreAllMocks();
  });

  it('leaves the room\'s ink materials alone on teardown', async () => {
    const { deps } = await engine();
    const world = createItemWorld(deps);
    const disposed = [deps.ink.lines, deps.ink.hull].map((material) => vi.spyOn(material, 'dispose'));
    world.dispose();
    for (const spy of disposed) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('steps the physics world cleanly once a world is gone', async () => {
    const { deps, physics } = await engine();
    const world = createItemWorld(deps);
    run(world, 0.2);
    world.dispose();
    expect(() => {
      for (let t = 0; t < 0.5; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
    }).not.toThrow();
    expect(() => physics.retune()).not.toThrow();
  });

  it('leaves no router behind: a pointer on the room after dispose reaches nothing', async () => {
    const { deps, canvas, census } = await engine();
    const baseline = census();
    const world = createItemWorld(deps);
    world.dispose();
    // Only the camera's own capture listener and OrbitControls' remain — exactly the baseline set.
    expect(canvas.listeners.length).toBe(baseline.canvasListeners);
    expect(() => canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400, clientY: 400, preventDefault() {} })).not.toThrow();
  });
});

describe('the ink on parts and the box', () => {
  const named = (mesh: THREE.Object3D, name: string) => mesh.children.filter((child) => child.name === name);
  // A panel is drawn as its plain box (no vertex colours); the shaped hardware merges its tones into vertex colours.
  const isPanel = (mesh: THREE.Mesh) => !(mesh.material as THREE.MeshStandardMaterial).vertexColors;

  async function built() {
    const { deps } = await engine();
    createItemWorld(deps);
    const meshes = deps.scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    return { deps, meshes, box: meshes.filter((mesh) => mesh.name === 'flatpack') };
  }

  it('gives every packed part one hull in the shared hull material, with no vertex colours', async () => {
    const { deps, meshes } = await built();
    const packed = meshes.filter((mesh) => named(mesh, 'inkHull').length);
    expect(packed.length).toBeGreaterThan(10);
    for (const mesh of packed) {
      const [hull] = named(mesh, 'inkHull') as THREE.Mesh[];
      expect(named(mesh, 'inkHull')).toHaveLength(1);
      expect(hull!.material).toBe(deps.ink.hull);
      expect(hull!.geometry.getAttribute('color')).toBeUndefined();
    }
  });

  it('builds one hull per part type and shares it across the instances', async () => {
    const { meshes } = await built();
    const hulls = meshes.flatMap((mesh) => named(mesh, 'inkHull') as THREE.Mesh[]).map((hull) => hull.geometry);
    expect(new Set(hulls).size).toBeLessThan(hulls.length);
  });

  it('gives every panel the crease pass as well, and no shaped part', async () => {
    const { deps, meshes } = await built();
    const packed = meshes.filter((mesh) => named(mesh, 'inkHull').length);
    const panels = packed.filter(isPanel);
    expect(panels.length).toBeGreaterThan(0);
    expect(packed.length).toBeGreaterThan(panels.length);
    for (const mesh of packed) {
      const edges = named(mesh, 'inkEdges') as LineSegments2[];
      if (!isPanel(mesh)) {
        expect(edges).toHaveLength(0);
        continue;
      }
      expect(edges).toHaveLength(1);
      expect(edges[0]!.material).toBe(deps.ink.lines);
      expect(edges[0]!.geometry.instanceCount).toBe(12);
    }
  });

  it('gives the flatpack base and lid the crease pass and no hull', async () => {
    const { deps, meshes, box } = await built();
    const lid = meshes.filter((mesh) => named(mesh, 'inkEdges').length && !named(mesh, 'inkHull').length && mesh.name !== 'flatpack');
    expect(box).toHaveLength(1);
    expect(lid).toHaveLength(1);
    // The box's solid: its outer block's twelve edges and its cavity's twelve, no seams where the slabs butt.
    expect((named(box[0]!, 'inkEdges')[0] as LineSegments2).geometry.instanceCount).toBe(24);
    for (const mesh of [...box, ...lid]) {
      expect(named(mesh, 'inkHull')).toHaveLength(0);
      expect(named(mesh, 'inkEdges')).toHaveLength(1);
      expect((named(mesh, 'inkEdges')[0] as LineSegments2).material).toBe(deps.ink.lines);
    }
  });
});

describe('a release that throws (1.9.1 review)', () => {
  // A physics world whose remove throws once — for the first body asked — then works.
  function flakyRemove(deps: ItemWorldDeps) {
    let thrown = false;
    const physics = {
      ...deps.physics,
      remove: (body: Parameters<ItemWorldDeps['physics']['remove']>[0]) => {
        if (!thrown) {
          thrown = true;
          throw new Error('remove broke');
        }
        deps.physics.remove(body);
      },
    };
    return { ...deps, physics };
  }

  it('dispose still runs every other release, then throws what failed', async () => {
    const { deps, census } = await engine();
    const baseline = census();
    const world = createItemWorld(flakyRemove(deps));
    expect(() => world.dispose()).toThrow(AggregateError);
    const after = census();
    // Exactly the one body whose release threw is left; everything else came back out.
    expect(after.physics.registered).toBe(baseline.physics.registered + 1);
    expect({ ...after, physics: baseline.physics }).toEqual(baseline);
  });

  it("a build that fails keeps its own error first, even when a release throws too", async () => {
    const { deps, census } = await engine();
    const baseline = census();
    const failing = { ...flakyRemove(deps), pages: () => { throw new Error('pages broke'); } };
    let caught: unknown;
    try {
      createItemWorld(failing);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const { errors } = caught as AggregateError;
    expect((errors[0] as Error).message).toBe('pages broke');
    expect((errors[1] as Error).message).toBe('remove broke');
    expect(census().canvasListeners).toBe(baseline.canvasListeners);
    expect(census().scene).toBe(baseline.scene);
  });
});

describe('a factory that throws part-way (1.9.1 review)', () => {
  // A physics world whose register throws on call `n`, after n - 1 bodies are in.
  function failingRegister(deps: ItemWorldDeps, n: number) {
    let calls = 0;
    const physics = {
      ...deps.physics,
      register: (...args: Parameters<ItemWorldDeps['physics']['register']>) => {
        if (++calls === n) throw new Error(`register ${n} broke`);
        return deps.physics.register(...args);
      },
    };
    return { ...deps, physics };
  }

  it('releases every body registered before the throw — inside the box, and after it', async () => {
    const { deps, census } = await engine();
    const baseline = census();
    const whole = createItemWorld(deps);
    const total = census().physics.registered - baseline.physics.registered;
    whole.dispose();
    // 2: the lid, after the box's base, inside createFlatpack. total: the last part registered.
    for (const n of [2, total]) {
      expect(() => createItemWorld(failingRegister(deps, n)), `register ${n}`).toThrow(`register ${n} broke`);
      expect(census(), `register ${n}`).toEqual(baseline);
    }
  });
});

describe('a build that fails part-way (1.9.1 review)', () => {
  it('takes back what it had built before rethrowing — bodies, meshes, nodes, listeners', async () => {
    const { deps, census } = await engine();
    const baseline = census();
    // pages() runs after the box, the packed parts and the gizmo are in.
    const failing = { ...deps, pages: () => { throw new Error('pages broke'); } };
    expect(() => createItemWorld(failing)).toThrow('pages broke');
    expect(census()).toEqual(baseline);
    // And the room still takes a world afterwards.
    createItemWorld(deps).dispose();
    expect(census()).toEqual(baseline);
  });
});

describe('the swap: picking from the catalog (1.9.1)', () => {
  it('a pick builds one world with its manual docked; picking it again keeps that world', async () => {
    const { deps, census } = await engine();
    const baseline = census();
    const items = createItemSlot({ door: { knows: (id) => ITEM_IDS.includes(id), selected: () => ITEM_ID, select: setItem }, report: (error) => { throw error; }, build: () => createItemWorld(deps) });

    const world = items.pick('johnny');
    expect(ITEM_ID).toBe('johnny');
    const one = census();
    expect(one.physics.registered).toBeGreaterThan(MANIFEST.length);
    expect(world.booklet.expanded).toBe(false);
    run(world, 0.3);
    // BUILD IT on the item already in the room: the same world, nothing torn down or added.
    expect(items.pick('johnny')).toBe(world);
    expect(census()).toEqual(one);
    world.dispose();
    expect(census()).toEqual(baseline);
  });

  // BLANK's world (1.9.2): nine parts in a box, and the swap both ways leaving the room as JOHNNY alone left it.
  it('swaps JOHNNY → BLANK → JOHNNY, each world built and the room back at baseline at the end', async () => {
    const { deps, census } = await engine();
    const baseline = census();
    const items = createItemSlot({ door: { knows: (id) => ITEM_IDS.includes(id), selected: () => ITEM_ID, select: setItem }, report: (error) => { throw error; }, build: () => createItemWorld(deps) });
    try {
      const johnny = items.pick('johnny');
      run(johnny, 0.2);
      const johnnyBuilt = census().physics.registered;
      const blank = items.pick('blank');
      expect(ITEM_ID).toBe('blank');
      expect(blank).not.toBe(johnny);
      const blankBuilt = census();
      // Its own parts in the box are bodies.
      expect(blankBuilt.physics.registered).toBeGreaterThan(MANIFEST.length);
      expect(blankBuilt.physics.registered).toBeLessThan(johnnyBuilt);
      run(blank, 0.5);
      const again = items.pick('johnny');
      expect(ITEM_ID).toBe('johnny');
      expect(census().physics.registered).toBe(johnnyBuilt);
      again.dispose();
      expect(census()).toEqual(baseline);
    } finally {
      setItem('johnny');
    }
  });
});

describe('the manual in the room (1.9.1.2)', () => {
  // The centre page's parts glow whether or not it is open, and a page with no parts lights none.
  it('lights the centre step page\'s parts with the manual docked, and none on a page without parts', async () => {
    const { deps } = await engine();
    const stepPages = {
      count: 3,
      pages: [{ kind: 'cover' }, { kind: 'step', types: Object.keys(PART_TYPES) }, { kind: 'back' }] as unknown as BookletPages['pages'],
      canvas: () => ({}) as HTMLCanvasElement,
      prerender() {},
      dispose() {},
    };
    const world = createItemWorld({ ...deps, pages: () => stepPages });
    const lit = () => {
      let count = 0;
      deps.scene.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (material?.emissive?.getHex() === COLORS.highlight) count++;
      });
      return count;
    };
    const [prev, , next] = [world.booklet.thumb.children[0], world.booklet.thumb.children[1], world.booklet.thumb.children[2]] as unknown as FakeElement[];
    // On the cover: nothing, and nothing is open.
    expect(world.booklet.expanded).toBe(false);
    expect(lit()).toBe(0);
    next.dispatch('click', {});
    expect(world.booklet.currentPage).toBe(1);
    expect(world.booklet.expanded).toBe(false);
    expect(lit()).toBeGreaterThan(0);
    next.dispatch('click', {});
    expect(lit()).toBe(0);
    prev.dispatch('click', {});
    expect(lit()).toBeGreaterThan(0);
    world.dispose();
  });

  it('mounts the strip and the page only — no scrim over the room', async () => {
    const { deps } = await engine();
    const world = createItemWorld(deps);
    const mounted = body.children as unknown[];
    expect(mounted).toContain(world.booklet.thumb);
    expect(mounted).toContain(world.booklet.element);
    expect(body.children.map((node) => node.className)).not.toContain('booklet-scrim');
    expect(world.booklet.scrim).toBeNull();
    world.dispose();
  });
});

describe('the detail inset rides the item world (1.10.0.1)', () => {
  // A renderer that only counts what it is asked to draw.
  const spyRenderer = () => {
    const renders: unknown[] = [];
    return { renders, renderer: { render: (scene: unknown) => renders.push(scene) } as unknown as THREE.WebGLRenderer };
  };
  const insetNode = () => body.children.find((node) => node.attributes.class === 'inset');

  it('puts its ink overlay on the page and takes it off again with the world', async () => {
    const { deps } = await engine();
    expect(insetNode()).toBeUndefined();
    const world = createItemWorld(deps);
    expect(insetNode()).toBeDefined();
    world.dispose();
    expect(insetNode()).toBeUndefined();
  });

  it('renders nothing extra while the inset is not showing', async () => {
    const { deps } = await engine();
    const world = createItemWorld(deps);
    const { renderer, renders } = spyRenderer();
    world.update(PHYSICS.timestep);
    world.render(renderer, deps.scene);
    expect(renders).toEqual([]);
    world.dispose();
  });

  it('frees its render target when the world goes', async () => {
    const { deps } = await engine();
    const disposed = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose');
    const world = createItemWorld(deps);
    world.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
