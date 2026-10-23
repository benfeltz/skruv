import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA, COLORS, PHYSICS } from '../src/constants.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { createBus } from '../src/game/events.js';
import { parse, serialize } from '../src/game/roomSave.js';
import { STATE } from '../src/game/fasteners.js';
import { FASTENER } from '../src/constants.js';
import { createHaptics } from '../src/game/haptics.js';
import { ASSEMBLED, IDENTITY, ITEM_ID, ITEM_IDS, MANIFEST, PART_TYPES, setItem } from '../src/game/item.js';
import { createItemSlot } from '../src/game/itemSlot.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import { createCameraControls } from '../src/scene/cameraControls.js';
import { createInk } from '../src/scene/ink.js';
import { createFlatpack } from '../src/scene/flatpack.js';
import { baseRest, boxPlacement, lidRest } from '../src/game/boxLayout.js';
import { boxFootprintSize, freeSpot } from '../src/game/roomLayout.js';
import { packedBox } from '../src/game/boxLayout.js';
import { createItemWorld } from '../src/scene/itemWorld.js';
import type { Assembly } from '../src/game/assembly.js';
import type { Body } from '../src/physics/world.js';
import type { BookletPages, ItemWorld, ItemWorldDeps } from '../src/scene/itemWorld.js';

// The swap's honesty gate (1.9.1): an item world built and disposed leaves the room as it
// found it — scene children, physics bodies, colliders and joints, DOM nodes and every
// listener it bound back at the baseline — so a swap is dispose then create, never a leak.
// Real Three scene, real Rapier, the real router, booklet sheet, line and dial on a minimal
// fake DOM. Only the booklet's page drawing is a stand-in: it renders through WebGL, and
// draws nothing the leak could hide in.

// The assembly each world builds, so a test can seat a joint the way the router does.
const built = vi.hoisted(() => ({ assemblies: [] as unknown[] }));
vi.mock('../src/game/assembly.js', async (original) => {
  const real = await original<typeof import('../src/game/assembly.js')>();
  return {
    ...real,
    createAssembly: (...args: Parameters<typeof real.createAssembly>) => {
      const assembly = real.createAssembly(...args);
      built.assemblies.push(assembly);
      return assembly;
    },
  };
});
const lastAssembly = () => built.assemblies[built.assemblies.length - 1] as Assembly;

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
    // The manual's band sets its root variables here.
    documentElement: { style: { setProperty() {}, removeProperty() {} }, dataset: {} },
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
    addEventListener: documentTarget.addEventListener.bind(documentTarget),
    removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
  });
  vi.stubGlobal('window', {
    // Rapier's step reads its timers off window.performance; without it the WASM panics.
    performance: globalThis.performance,
    innerWidth: 390,
    innerHeight: 844,
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
    at: boxPlacement(),
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

  // BLANK's world (1.9.2): nine parts in a box. Picked after JOHNNY, both stand in the room (1.9.9.2);
  // clear() takes both back out, each with the door naming it, and the room is at baseline.
  it('keeps JOHNNY when BLANK is picked, re-activates it on a second pick, and clear() leaves the room at baseline', async () => {
    const { deps, census } = await engine();
    const baseline = census();
    const items: ReturnType<typeof createItemSlot<ItemWorld>> = createItemSlot({
      door: { knows: (id) => ITEM_IDS.includes(id), selected: () => ITEM_ID, select: setItem },
      report: (error) => { throw error; },
      build: () => createItemWorld({ ...deps, at: freeSpot(items.all().map((w) => w.footprint()), boxFootprintSize(packedBox())) }),
    });
    try {
      const johnny = items.pick('johnny');
      run(johnny, 0.2);
      const johnnyBuilt = census().physics.registered;
      const blank = items.pick('blank');
      expect(ITEM_ID).toBe('blank');
      expect(blank).not.toBe(johnny);
      const both = census();
      // Its own parts in the box are bodies, and JOHNNY's are still there.
      expect(both.physics.registered).toBeGreaterThan(johnnyBuilt);
      run(blank, 0.5);
      expect(items.pick('johnny')).toBe(johnny);
      expect(ITEM_ID).toBe('johnny');
      expect(census().physics.registered).toBe(both.physics.registered);
      expect(items.all()).toEqual([blank, johnny]);
      items.clear();
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
    // The band has no arrows: the arrow keys step it.
    const key = (name: string) => windowTarget.dispatch('keydown', { key: name });
    // On the cover: nothing, and nothing is open.
    expect(world.booklet.expanded).toBe(false);
    expect(lit()).toBe(0);
    key('ArrowRight');
    expect(world.booklet.currentPage).toBe(1);
    expect(world.booklet.expanded).toBe(false);
    expect(lit()).toBeGreaterThan(0);
    key('ArrowRight');
    expect(lit()).toBe(0);
    key('ArrowLeft');
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

  it('puts the inset controls on the page, hidden, and takes them off again with the world', async () => {
    const { deps } = await engine();
    const controls = () => body.children.find((node) => node.attributes.class === 'inset-controls');
    expect(controls()).toBeUndefined();
    const world = createItemWorld(deps);
    expect(controls()?.attributes.hidden).toBe('');
    world.dispose();
    expect(controls()).toBeUndefined();
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

describe('the world reads itself into a save record (1.9.9.5)', () => {
  const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

  /** The deps with every body the world registers remembered, to find a part's body by where it is. */
  async function recordingEngine() {
    const { deps: engineDeps } = await engine();
    const made: Body[] = [];
    const deps: ItemWorldDeps = {
      ...engineDeps,
      physics: {
        ...engineDeps.physics,
        register(...args) {
          const registered = engineDeps.physics.register(...args);
          made.push(registered);
          return registered;
        },
      },
    };
    return { deps, made, physics: engineDeps.physics };
  }

  it('snapshots the item, a seated and fastened joint, and a moved part', async () => {
    const { deps, made, physics } = await recordingEngine();
    const world = createItemWorld(deps);
    const fresh = world.snapshot();
    expect(fresh.kind).toBe('item');
    expect(fresh.id).toBe(ITEM_ID);
    expect(fresh.documentCode).toBe(IDENTITY.documentCode);
    // One pose per manifest id; the box and the lid are their own fields.
    expect(Object.keys(fresh.parts).sort()).toEqual(MANIFEST.map(({ id }) => id).sort());
    expect(fresh.box.position).toHaveLength(3);
    expect(fresh.lid.rotation).toHaveLength(4);
    expect(fresh.joints).toEqual([]);
    expect(fresh.page).toBe(0);

    // Seat a dowel into a side panel and press it home, as the router does.
    const assembly = lastAssembly();
    const joint = assembly.seat({ partA: 'dowel-1', connectorA: 0, partB: 'sidePanel-1', connectorB: 0, mover: 'dowel-1' });
    assembly.apply(joint.id, { type: 'tap' });
    // Move a part, step once.
    const was = fresh.parts['sidePanel-2'];
    const body = made.find((b) => Math.abs(b.translation().x - was.position[0]) < 1e-6 && Math.abs(b.translation().y - was.position[1]) < 1e-6 && Math.abs(b.translation().z - was.position[2]) < 1e-6)!;
    physics.place(body, [0.4, 0.9, 0.2], [0, 0, 0, 1]);
    run(world, PHYSICS.timestep);

    const after = world.snapshot();
    expect(after.joints).toHaveLength(1);
    expect(after.joints[0]).toMatchObject({ hardware: 'dowel-1', host: 'sidePanel-1', kind: 'dowel', fastener: { state: STATE.PRESSED, progress: 1 } });
    expect(after.joints[0].fastener).not.toBe(assembly.get(joint.id)!.fastener);
    const { x, y, z } = body.translation();
    near(after.parts['sidePanel-2'].position, [x, y, z]);
    expect(after.parts['sidePanel-2'].position[0]).toBeCloseTo(0.4, 1);
    world.dispose();
  });

  it('two worlds of two packs make one document that round-trips deeply equal', async () => {
    const { deps } = await recordingEngine();
    const johnny = createItemWorld(deps);
    const first = johnny.snapshot();
    johnny.dispose();
    setItem('blank');
    try {
      const blank = createItemWorld(deps);
      const second = blank.snapshot();
      expect(second.id).toBe('blank');
      const save = {
        format: 1 as const,
        savedAt: '2026-10-21T19:12:00.000Z',
        world: { sky: { phase: 0.25 }, camera: deps.cameraControls.pose() },
        objects: [first, second],
      };
      const { save: back, skipped } = parse(serialize(save));
      expect(back).toEqual(save);
      expect(skipped).toEqual([]);
      blank.dispose();
    } finally {
      setItem('johnny');
    }
  });
});

describe('the world puts itself back from a record (1.9.1 restore, 1.9.9.1)', () => {
  beforeEach(() => void vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px' })));
  afterEach(() => void vi.unstubAllGlobals());

  // Rapier renormalises a rotation it is given, so a pose comes back within float noise of the one placed.
  const closeTo = (a: unknown, b: unknown): void => {
    if (typeof a === 'number' && typeof b === 'number') return void expect(a).toBeCloseTo(b, 6);
    if (Array.isArray(a) && Array.isArray(b)) {
      expect(a).toHaveLength(b.length);
      return a.forEach((v, i) => closeTo(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      return Object.keys(a).forEach((k) => closeTo((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    expect(a).toEqual(b);
  };
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  async function recordingEngine() {
    const { deps: engineDeps } = await engine();
    const made: Body[] = [];
    const deps: ItemWorldDeps = {
      ...engineDeps,
      physics: {
        ...engineDeps.physics,
        register(...args) {
          const registered = engineDeps.physics.register(...args);
          made.push(registered);
          return registered;
        },
      },
    };
    // The newest body sitting at `position`: a fresh world's parts are found by where the snapshot says they are.
    const bodyAt = (position: number[]) => [...made].reverse().find((b) => dist([b.translation().x, b.translation().y, b.translation().z], position) < 1e-6)!;
    return { deps, physics: engineDeps.physics, bodyAt };
  }

  /** The pack's first dowel joint, and the assembled poses of its two parts. */
  const dowelJoint = () => {
    const joint = ASSEMBLED.joints.find((j) => j.kind === 'dowel')!;
    const pose = (id: string) => ASSEMBLED.parts.find((p) => p.id === id)!;
    return { joint, hardware: pose(joint.hardware), host: pose(joint.host) };
  };

  it('restores a built, pressed, turned-to-page-two world to the very snapshot it was taken from', async () => {
    const { deps, physics, bodyAt } = await recordingEngine();
    const first = createItemWorld(deps);
    const fresh = first.snapshot();
    const { joint, hardware, host } = dowelJoint();
    const hardwareBody = bodyAt(fresh.parts[joint.hardware].position);
    const hostBody = bodyAt(fresh.parts[joint.host].position);
    physics.place(hardwareBody, hardware.position, hardware.rotation);
    physics.place(hostBody, host.position, host.rotation);
    const seated = lastAssembly().seat({ partA: joint.hardware, connectorA: joint.hardwareConnector, partB: joint.host, connectorB: joint.hostConnector, mover: joint.mover });
    lastAssembly().apply(seated.id, { type: 'tap' });
    first.booklet.goTo(2);
    run(first, PHYSICS.timestep);
    const saved = first.snapshot();
    expect(saved.page).toBe(2);
    first.dispose();

    const second = createItemWorld(deps);
    second.restore(saved);
    closeTo(second.snapshot(), saved);
    expect(second.booklet.currentPage).toBe(2);
    // The bond holds: the dowel stays where the panel keeps it as the pair settles.
    const hold = bodyAt(saved.parts[joint.hardware].position);
    const panel = bodyAt(saved.parts[joint.host].position);
    const offset = () => dist([hold.translation().x, hold.translation().y, hold.translation().z], [panel.translation().x, panel.translation().y, panel.translation().z]);
    const before = offset();
    for (let i = 0; i < 30; i++) run(second, PHYSICS.timestep);
    expect(Math.abs(offset() - before)).toBeLessThan(0.002);
    second.dispose();
  });

  it('holds a seated, unfastened dowel at its seat instead of letting it fall', async () => {
    const { deps, physics, bodyAt } = await recordingEngine();
    const first = createItemWorld(deps);
    const record = first.snapshot();
    first.dispose();
    const { joint, hardware, host } = dowelJoint();
    record.parts[joint.hardware] = { position: hardware.position, rotation: hardware.rotation };
    record.parts[joint.host] = { position: host.position, rotation: host.rotation };
    record.joints = [
      {
        hardware: joint.hardware,
        hardwareConnector: joint.hardwareConnector,
        host: joint.host,
        hostConnector: joint.hostConnector,
        kind: 'dowel',
        mover: joint.mover,
        fastener: { state: STATE.SEATED, progress: 0 },
        through: null,
        captured: null,
      },
    ];
    const world = createItemWorld(deps);
    world.restore(record);
    void physics;
    const body = bodyAt(record.parts[joint.hardware].position);
    for (let i = 0; i < 5; i++) run(world, PHYSICS.timestep);
    const settled = body.translation();
    for (let i = 0; i < 60; i++) run(world, PHYSICS.timestep);
    expect(dist([body.translation().x, body.translation().y, body.translation().z], [settled.x, settled.y, settled.z])).toBeLessThan(1e-6);
    expect(dist([settled.x, settled.y, settled.z], record.parts[joint.hardware].position)).toBeLessThan(0.03);
    world.dispose();
  });

  it('refuses a joint the machine cannot land, and the half-restored world can be disposed', async () => {
    const { deps } = await recordingEngine();
    const first = createItemWorld(deps);
    const record = first.snapshot();
    first.dispose();
    const { joint } = dowelJoint();
    record.joints = [
      {
        hardware: joint.hardware,
        hardwareConnector: joint.hardwareConnector,
        host: joint.host,
        hostConnector: joint.hostConnector,
        kind: 'dowel',
        mover: joint.mover,
        fastener: { state: STATE.SCREWED, progress: 1 },
        through: null,
        captured: null,
      },
    ];
    const world = createItemWorld(deps);
    expect(() => world.restore(record)).toThrow(/restore: joint/);
    expect(() => world.dispose()).not.toThrow();
  });

  it('reports the item it was built for, not the one the door names now (question 1)', async () => {
    const { deps } = await recordingEngine();
    const world = createItemWorld(deps);
    const johnny = IDENTITY.documentCode;
    setItem('blank');
    try {
      const record = world.snapshot();
      expect(record.id).toBe('johnny');
      expect(record.documentCode).toBe(johnny);
    } finally {
      setItem('johnny');
    }
    world.dispose();
  });
});

describe('the flatpack at a spot (1.9.9.2)', () => {
  it('stands the box and its lid at the pose it is given', async () => {
    const { deps } = await engine();
    const at = { position: [1.6, 0, -0.7] as [number, number, number], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number] };
    const { base, lid } = createFlatpack(deps.physics, deps.ink, at);
    const near = (body: Body, pose: { position: number[] }) => {
      const t = body.translation();
      [t.x, t.y, t.z].forEach((v, i) => expect(v).toBeCloseTo(pose.position[i], 6));
    };
    near(base.body, baseRest(at));
    near(lid.body, lidRest(at));
  });
});

describe('several worlds in one room (1.9.9.2)', () => {
  const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const strips = () => body.children.filter((node) => node.className === 'booklet-strip');
  // A pointer press, drag and release on the room's canvas at the screen point of `point`.
  const dragFrom = (canvas: { dispatch(type: string, event: object): void }, scene: THREE.Scene, camera: THREE.Camera, point: THREE.Vector3, frame: () => void, by = 60) => {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const v = point.clone().project(camera);
    const [x, y] = [((v.x + 1) / 2) * 800, ((1 - v.y) / 2) * 800];
    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, preventDefault() {}, stopImmediatePropagation() {}, timeStamp: 0 };
    canvas.dispatch('pointerdown', { ...pointer, clientX: x, clientY: y });
    for (let i = 1; i <= 5; i++) canvas.dispatch('pointermove', { ...pointer, clientX: x + (i * by) / 5, clientY: y });
      frame();
    canvas.dispatch('pointerup', { ...pointer, clientX: x + by, clientY: y });
  };
  const boxAt = (world: { snapshot(): { box: { position: number[] } } }) => world.snapshot().box.position;
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  async function twoWorlds() {
    const rig = await engine();
    const johnny = createItemWorld(rig.deps);
    johnny.deactivate();
    setItem('blank');
    const at = freeSpot([johnny.footprint()], boxFootprintSize(packedBox()));
    const blank = createItemWorld({ ...rig.deps, at });
    return { ...rig, johnny, blank, at };
  }
  afterEach(() => setItem('johnny'));

  it('stands two worlds in one room, each with its own parts, apart from each other', async () => {
    const { johnny, blank, at, census } = await twoWorlds();
    const baseline = census();
    expect(at.position).not.toEqual(boxPlacement().position);
    expect(overlaps(johnny.footprint(), blank.footprint())).toBe(false);
    expect(johnny.snapshot().id).toBe('johnny');
    expect(blank.snapshot().id).toBe('blank');
    expect(Object.keys(johnny.snapshot().parts)).not.toEqual(Object.keys(blank.snapshot().parts));
    expect(baseline.physics.registered).toBeGreaterThan(MANIFEST.length);
    // Exactly one router's listeners on the canvas (Blank's), one strip on the page.
    expect(strips().filter((node) => !node.hidden)).toHaveLength(1);
    // Back to nothing, each torn down with the door naming it.
    blank.dispose();
    setItem('johnny');
    johnny.dispose();
  });

  it('returns to the room\'s baseline once both are disposed', async () => {
    const rig = await engine();
    const baseline = rig.census();
    const johnny = createItemWorld(rig.deps);
    johnny.deactivate();
    setItem('blank');
    const blank = createItemWorld({ ...rig.deps, at: freeSpot([johnny.footprint()], boxFootprintSize(packedBox())) });
    run(blank, 0.3);
    blank.dispose();
    setItem('johnny');
    johnny.dispose();
    expect(rig.census()).toEqual(baseline);
  });

  it('keeps a kept world inert: its router is off, its strip put away, its overlays down', async () => {
    const rig = await engine();
    const base = rig.census();
    const johnny = createItemWorld(rig.deps);
    const active = rig.census();
    johnny.deactivate();
    // The router's six canvas listeners are off; the world's inset's remain (it is idle).
    expect(rig.census().canvasListeners).toBe(active.canvasListeners - 6);
    expect(strips().every((node) => node.hidden)).toBe(true);
    johnny.dispose();
    expect(rig.census()).toEqual(base);
  });

  it('moves nothing of a kept world on a press over it, and drags again once active', async () => {
    const rig = await engine();
    const camera = rig.deps.camera as THREE.PerspectiveCamera;
    camera.lookAt(0, 0.3, 0.6);
    camera.updateMatrixWorld(true);
    const johnny = createItemWorld(rig.deps);
    const top = new THREE.Vector3(...(johnny.snapshot().lid.position as [number, number, number]));
    johnny.deactivate();
    run(johnny, 0.3);
    const lidAt = () => johnny.snapshot().lid.position;
    const before = [...lidAt()];
    const moved = () => Math.hypot(...lidAt().map((v, i) => v - before[i]));
    dragFrom(rig.canvas, rig.deps.scene, camera, top, () => run(johnny, 0.05));
    run(johnny, 0.3);
    expect(moved()).toBeLessThan(1e-3);
    johnny.activate();
    dragFrom(rig.canvas, rig.deps.scene, camera, top, () => run(johnny, 0.05));
    run(johnny, 0.3);
    expect(moved()).toBeGreaterThan(0.02);
    johnny.dispose();
  });

  it('brings the strip back on the page it was on, with that page\'s parts lit', async () => {
    const rig = await engine();
    const stepPages = {
      count: 3,
      pages: [{ kind: 'cover' }, { kind: 'step', types: Object.keys(PART_TYPES) }, { kind: 'back' }] as unknown as BookletPages['pages'],
      canvas: () => ({}) as HTMLCanvasElement,
      prerender() {},
      dispose() {},
    };
    const world = createItemWorld({ ...rig.deps, pages: () => stepPages });
    const lit = () => {
      let count = 0;
      rig.deps.scene.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (material?.emissive?.getHex() === COLORS.highlight) count++;
      });
      return count;
    };
    windowTarget.dispatch('keydown', { key: 'ArrowRight' });
    expect(lit()).toBeGreaterThan(0);
    world.deactivate();
    expect(lit()).toBe(0);
    expect(strips().every((node) => node.hidden)).toBe(true);
    world.activate();
    expect(world.booklet.currentPage).toBe(1);
    expect(lit()).toBeGreaterThan(0);
    expect(strips().some((node) => !node.hidden)).toBe(true);
    world.dispose();
  });

  it('puts its bodies at the record\'s poses whatever spot it was built at', async () => {
    const rig = await engine();
    const johnny = createItemWorld(rig.deps);
    const record = johnny.snapshot();
    johnny.dispose();
    const shifted = { position: [1.6, 0, -0.7] as [number, number, number], rotation: boxPlacement().rotation };
    const again = createItemWorld({ ...rig.deps, at: shifted });
    expect(boxAt(again)[0]).not.toBeCloseTo(record.box.position[0], 2);
    again.restore(record);
    const close = (a: { position: number[] }, b: { position: number[] }) => a.position.forEach((v, i) => expect(v).toBeCloseTo(b.position[i], 5));
    close(again.snapshot().box, record.box);
    for (const [id, pose] of Object.entries(record.parts)) close(again.snapshot().parts[id], pose);
    again.dispose();
  });

  // Review round 1: what the router draws on a part (a bolt sunk and twisted by its turn) is lost to the next
  // physics step, which syncs a mesh to its bare body; a kept world puts it back, pack-free, in keep().
  it('a kept world keeps a half-turned bolt\'s drawn sink after the active world steps the physics world', async () => {
    const rig = await engine();
    const pairs: { mesh: THREE.Object3D; body: Body }[] = [];
    const deps: ItemWorldDeps = {
      ...rig.deps,
      physics: {
        ...rig.deps.physics,
        register(mesh, spec) {
          const body = rig.deps.physics.register(mesh, spec);
          pairs.push({ mesh: mesh as THREE.Object3D, body });
          return body;
        },
      },
    };
    const johnny = createItemWorld(deps);
    const assembly = lastAssembly();
    const joint = assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: 'sidePanel-1', connectorB: 2, mover: 'camLockBolt-1' });
    assembly.apply(joint.id, { type: 'crank', radians: FASTENER.boltRadians / 2 });
    run(johnny, 0.2);
    const at = johnny.snapshot().parts['camLockBolt-1'].position;
    const bolt = pairs.reduce((best, p) => (dist([p.body.translation().x, p.body.translation().y, p.body.translation().z], at) < dist([best.body.translation().x, best.body.translation().y, best.body.translation().z], at) ? p : best));
    const apart = () => Math.hypot(bolt.mesh.position.x - bolt.body.translation().x, bolt.mesh.position.y - bolt.body.translation().y, bolt.mesh.position.z - bolt.body.translation().z);
    // It really is drawn off its body: sunk into its hole by its progress.
    expect(apart()).toBeGreaterThan(1e-3);
    // Drawn off its body by this much, which stays whatever the woken bolt does.
    const drawnApart = apart();

    johnny.deactivate();
    setItem('blank');
    const blank = createItemWorld({ ...rig.deps, at: freeSpot([johnny.footprint()], boxFootprintSize(packedBox())) });
    bolt.body.wakeUp();
    for (let t = 0; t < 0.3; t += PHYSICS.timestep) {
      blank.update(PHYSICS.timestep);
      johnny.keep();
    }
    expect(apart()).toBeCloseTo(drawnApart, 6);
    blank.dispose();
    setItem('johnny');
    johnny.dispose();
  });

  // Review round 2: a world restored and put away before any frame has never drawn; deactivate draws once before it captures.
  it('a world restored and kept before any frame still shows its half-turned bolt as drawn', async () => {
    const rig = await engine();
    const pairs: { mesh: THREE.Object3D; body: Body }[] = [];
    const recording: ItemWorldDeps = {
      ...rig.deps,
      physics: {
        ...rig.deps.physics,
        register(mesh, spec) {
          const body = rig.deps.physics.register(mesh, spec);
          pairs.push({ mesh: mesh as THREE.Object3D, body });
          return body;
        },
      },
    };
    const apartOf = (id: string, world: { snapshot(): { parts: Record<string, { position: number[] }> } }) => {
      const at = world.snapshot().parts[id].position;
      const near = pairs.reduce((best, p) => (dist([p.body.translation().x, p.body.translation().y, p.body.translation().z], at) < dist([best.body.translation().x, best.body.translation().y, best.body.translation().z], at) ? p : best));
      return Math.hypot(near.mesh.position.x - near.body.translation().x, near.mesh.position.y - near.body.translation().y, near.mesh.position.z - near.body.translation().z);
    };
    // A saved room: JOHNNY with a bolt half turned in its panel.
    const first = createItemWorld(recording);
    const assembly = lastAssembly();
    const joint = assembly.seat({ partA: 'camLockBolt-1', connectorA: 0, partB: 'sidePanel-1', connectorB: 2, mover: 'camLockBolt-1' });
    assembly.apply(joint.id, { type: 'crank', radians: FASTENER.boltRadians / 2 });
    run(first, 0.2);
    const activeApart = apartOf('camLockBolt-1', first);
    expect(activeApart).toBeGreaterThan(1e-3);
    const record = first.snapshot();
    first.dispose();
    pairs.length = 0;

    // The boot: restored, then put away by the next pick, with no frame between.
    const johnny = createItemWorld(recording);
    johnny.restore(record);
    johnny.deactivate();
    setItem('blank');
    const blank = createItemWorld({ ...rig.deps, at: freeSpot([johnny.footprint()], boxFootprintSize(packedBox())) });
    for (let t = 0; t < 0.2; t += PHYSICS.timestep) {
      blank.update(PHYSICS.timestep);
      johnny.keep();
    }
    expect(apartOf('camLockBolt-1', johnny)).toBeCloseTo(activeApart, 6);
    blank.dispose();
    setItem('johnny');
    johnny.dispose();
  });

  // Phone bug (round 5): a world restored and put away before a frame had its meshes still packed, and kept them so.
  it('a restored world kept before any frame has its meshes at their bodies and its parts at the saved poses', async () => {
    const rig = await engine();
    const first = createItemWorld(rig.deps);
    // A saved state away from the packed default: a panel moved out of the box.
    const saved = first.snapshot();
    saved.parts['sidePanel-1'] = { position: [-1.2, 0.5, 1.4], rotation: [0, 0, 0, 1] };
    first.dispose();

    const pairs: { mesh: THREE.Object3D; body: Body }[] = [];
    const recording: ItemWorldDeps = {
      ...rig.deps,
      physics: {
        ...rig.deps.physics,
        register(mesh, spec) {
          const body = rig.deps.physics.register(mesh, spec);
          pairs.push({ mesh: mesh as THREE.Object3D, body });
          return body;
        },
      },
    };
    const johnny = createItemWorld(recording);
    johnny.restore(saved);
    johnny.deactivate();
    setItem('blank');
    const blank = createItemWorld({ ...rig.deps, at: freeSpot([johnny.footprint()], boxFootprintSize(packedBox())) });
    blank.update(PHYSICS.timestep);
    johnny.keep();

    // Every mesh of the kept world sits at its body, not at the packed pose it was built at.
    expect(pairs.length).toBeGreaterThan(MANIFEST.length);
    for (const { mesh, body } of pairs) {
      const { x, y, z } = body.translation();
      expect(mesh.position.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-6);
    }
    // And the parts are still where the save put them.
    const after = johnny.snapshot();
    expect(after.parts['sidePanel-1'].position[0]).toBeCloseTo(-1.2, 3);
    expect(after.parts['sidePanel-1'].position[2]).toBeCloseTo(1.4, 3);
    blank.dispose();
    setItem('johnny');
    johnny.dispose();
  });

  it('deactivating twice, or mid-hold, is harmless', async () => {
    const rig = await engine();
    const world = createItemWorld(rig.deps);
    expect(() => {
      world.deactivate();
      world.deactivate();
      world.activate();
      world.activate();
    }).not.toThrow();
    world.dispose();
  });
});

// 1.9.0.4: SÖMNLÖS, the largest box so far, in real worlds on the real physics. Its packing
// and the room layout are checked headlessly too (somnlosPack, roomLayout); these run them.
describe('SÖMNLÖS in the room', () => {
  afterEach(() => setItem('johnny'));
  const apart = (a: number[], b: number[]) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
  // A box's own outside on the floor, standing where its world's snapshot says, unpadded.
  const boxFloor = (position: number[]) => {
    const [sx, sz] = boxFootprintSize(packedBox());
    return [position[0] - sx / 2, position[2] - sz / 2, position[0] + sx / 2, position[2] + sz / 2];
  };

  it('keeps all 67 pieces in the closed box as it settles', async () => {
    const rig = await engine();
    setItem('somnlos');
    const world = createItemWorld(rig.deps);
    run(world, 1);
    const { box, parts } = world.snapshot();
    const [minX, minZ, maxX, maxZ] = boxFloor(box.position);
    const top = packedBox().floor + packedBox().inner[1];
    expect(Object.keys(parts)).toHaveLength(67);
    for (const [id, { position: [x, y, z] }] of Object.entries(parts)) {
      expect(x > minX && x < maxX && z > minZ && z < maxZ, `${id} at ${x}, ${z}`).toBe(true);
      expect(y > 0 && y < top, `${id} at height ${y}`).toBe(true);
    }
    world.dispose();
  });

  for (const other of ITEM_IDS.filter((id) => id !== 'somnlos')) {
    it(`sets ${other}'s box down clear of SÖMNLÖS's whole box, either picked first`, async () => {
      const rig = await engine();
      for (const [first, second] of [['somnlos', other], [other, 'somnlos']]) {
        setItem(first);
        const kept = createItemWorld(rig.deps);
        const keptBox = boxFloor(kept.snapshot().box.position);
        // The footprint covers the whole box, not just the centres of what is in it.
        const footprint = kept.footprint();
        expect(footprint[0] <= keptBox[0] && footprint[1] <= keptBox[1] && footprint[2] >= keptBox[2] && footprint[3] >= keptBox[3], first).toBe(true);
        kept.deactivate();
        setItem(second);
        const at = freeSpot([footprint], boxFootprintSize(packedBox()));
        const next = createItemWorld({ ...rig.deps, at });
        // Where it was set down, before the physics could shove an overlap apart.
        expect(next.snapshot().box.position[0]).toBeCloseTo(at.position[0], 6);
        expect(apart(keptBox, boxFloor(at.position)), `${first}, then ${second}`).toBe(true);
        // On a free spot, pads and all — not the least crowded of taken ones.
        expect(apart(footprint, next.footprint()), `${first}, then ${second}: padded`).toBe(true);
        next.dispose();
        setItem(first);
        kept.dispose();
      }
    });
  }
});
