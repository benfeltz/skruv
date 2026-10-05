import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssembly } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/catalog.js';
import { ANY, createBus, EVENT_FIELDS } from '../src/game/events.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';

// The real gesture router, driven headlessly: real assembly graph, real Three raycasting,
// a fake canvas and a recording physics stub. Pins what the bus hears for a gesture —
// and that hearing it changes nothing the gesture does.

const SIZE = 1000;

class FakeCanvas {
  listeners = new Map();
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: SIZE, height: SIZE };
  }
  setPointerCapture() {}
  fire(type, init) {
    this.listeners.get(type)?.({ type, pointerId: 1, button: 0, ...init });
  }
}

const quiet = { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

// A part whose body reports its mesh's pose, as the simulation would at rest.
function makePart(id, type, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.updateMatrixWorld(true);
  const body = {
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  return { id, type, mesh, body };
}

function harness() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 1.4, 0.9);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const panel = makePart('panel', 'topBottomPanel', [0, 0, 0]);
  // Dowel end 0 ([0, -0.015, 0]) sits on the panel's first hole ([-0.384, 0, -0.09]).
  const dowel = makePart('dowel', 'dowel', [-0.384, 0.015, -0.09]);
  const parts = [panel, dowel];
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id));
  assembly.seat({ partA: 'dowel', connectorA: 0, partB: 'panel', connectorB: 0, mover: 'dowel' });

  const physicsCalls = [];
  const physics = {
    grab: (body) => physicsCalls.push(['grab', body]),
    move: (body) => physicsCalls.push(['move', body]),
    release: (body) => physicsCalls.push(['release', body]),
    join: () => {
      physicsCalls.push(['join']);
      return {};
    },
    unjoin: () => physicsCalls.push(['unjoin']),
  };

  const heard = [];
  const events = createBus({ now: () => 0 });
  events.on(ANY, (event) => heard.push(event));

  const canvas = new FakeCanvas();
  const build = (withEvents) =>
    createGestureRouter({
      domElement: canvas,
      camera,
      cameraControls: { enable() {}, disable() {} },
      physics,
      parts,
      assembly,
      onTap: () => {},
      events: withEvents ? events : undefined,
    });

  // A world point on screen, in the fake canvas's CSS px.
  const screen = (point) => {
    const v = new THREE.Vector3(...point).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };

  return { build, canvas, screen, heard, assembly, physicsCalls, panel };
}

let clock = 0;
function tap(canvas, at) {
  canvas.fire('pointerdown', { ...at, timeStamp: (clock += 1000) });
  canvas.fire('pointerup', { ...at, timeStamp: (clock += 50) });
}

function drag(canvas, from, end = 'pointerup') {
  canvas.fire('pointerdown', { ...from, timeStamp: (clock += 1000) });
  for (let i = 1; i <= 5; i++) {
    canvas.fire('pointermove', { clientX: from.clientX + i * 20, clientY: from.clientY, timeStamp: (clock += 16) });
  }
  canvas.fire(end, { clientX: from.clientX + 100, clientY: from.clientY, timeStamp: (clock += 16) });
}

// The panel's far end from the hole — a press there is the panel's, not the dowel's.
const PANEL_END = [0.3, 0.008, 0.05];

describe('gesture router telemetry', () => {
  it('reports a panel tapped down onto its dowel as one fasten, shaped by the schema', () => {
    const { build, canvas, screen, heard } = harness();
    build(true);
    tap(canvas, screen(PANEL_END));
    expect(heard).toHaveLength(1);
    const [event] = heard;
    expect(Object.keys(event)).toEqual(['type', ...EVENT_FIELDS.fasten, 't', 'seq']);
    expect(event).toMatchObject({ type: 'fasten', kind: 'dowel', hardware: 'dowel', host: 'panel', state: 'pressed' });
  });

  it('reports a repack teardown as one unseat per joint it takes apart', () => {
    const { build, canvas, screen, heard } = harness();
    const router = build(true);
    tap(canvas, screen(PANEL_END));
    heard.length = 0;
    router.unseatAll(['panel', 'dowel']);
    expect(heard.map((e) => [e.type, e.kind, e.hardware, e.host])).toEqual([['unseat', 'dowel', 'dowel', 'panel']]);
  });

  it('pairs a free drag: grab(move), then release — seated false, or cancelled when interrupted', () => {
    const { build, canvas, screen, heard, assembly } = harness();
    const router = build(true);
    router.unseatAll(['panel', 'dowel']);
    expect(assembly.all()).toHaveLength(0);
    heard.length = 0;

    drag(canvas, screen(PANEL_END));
    expect(heard.map(({ type, part, mode, seated, cancelled }) => ({ type, part, mode, seated, cancelled }))).toEqual([
      { type: 'grab', part: 'panel', mode: 'move', seated: undefined, cancelled: undefined },
      { type: 'release', part: 'panel', mode: 'move', seated: false, cancelled: false },
    ]);

    heard.length = 0;
    drag(canvas, screen(PANEL_END), 'pointercancel');
    expect(heard.map((e) => [e.type, e.cancelled ?? null])).toEqual([
      ['grab', null],
      ['release', true],
    ]);
  });

  it('emission changes nothing the gesture does: the same taps and drags with and without a bus', () => {
    const outcome = (withEvents) => {
      const { build, canvas, screen, assembly, physicsCalls, panel } = harness();
      const router = build(withEvents);
      tap(canvas, screen(PANEL_END));
      const fastened = assembly.all().map((j) => j.fastener.state);
      router.unseatAll(['panel', 'dowel']);
      drag(canvas, screen(PANEL_END));
      drag(canvas, screen(PANEL_END), 'pointercancel');
      return { fastened, joints: assembly.all().length, calls: physicsCalls.map(([name, body]) => [name, body === panel.body]) };
    };
    const quietRun = outcome(false);
    expect(quietRun.fastened).toEqual(['pressed']);
    expect(outcome(true)).toEqual(quietRun);
  });
});
