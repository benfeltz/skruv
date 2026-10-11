import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CAMERA } from '../src/constants.js';
import { createCameraControls } from '../src/scene/cameraControls.js';
import type { PickDistance } from '../src/scene/cameraControls.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

// 1.8.3.2: a camera gesture pivots about the first part along the line through the middle
// of the screen (else the floor), picked once as it starts and held through it. The real
// OrbitControls on a minimal fake element, as in cameraShift.test.ts.

type Listener = (event: object) => void;

class FakeTarget {
  listeners: { type: string; fn: Listener; capture: boolean }[] = [];
  addEventListener(type: string, fn: Listener, options?: boolean | { capture?: boolean }) {
    this.listeners.push({ type, fn, capture: typeof options === 'object' ? !!options.capture : !!options });
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn);
  }
  dispatch(type: string, event: object) {
    const matching = this.listeners.filter((l) => l.type === type);
    for (const l of [...matching.filter((l) => l.capture), ...matching.filter((l) => !l.capture)]) l.fn({ type, ...event });
  }
}

class FakeCanvas extends FakeTarget {
  style: Record<string, string> = {};
  clientWidth = 800;
  clientHeight = 800;
  ownerDocument = new FakeTarget();
  getRootNode() {
    return this.ownerDocument;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 800 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };

/** The camera at the start pose, its controls over a fake canvas, and every pick it asks for. */
function setUp(hit: number | null) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(...CAMERA.startPosition);
  const canvas = new FakeCanvas();
  const picks: { origin: Vec3; direction: Vec3 }[] = [];
  const pickDistance: PickDistance = (origin, direction) => {
    picks.push({ origin, direction });
    return hit;
  };
  const controls = createCameraControls(camera, canvas as unknown as HTMLElement, { pickDistance }); // a fake: listeners, style, rect
  // The line through the middle of the screen before any gesture.
  const eye = camera.position.clone();
  const direction = camera.getWorldDirection(new THREE.Vector3());
  return { camera, canvas, controls, picks, eye, direction };
}

/** How far `point` is from the camera, and how squarely the camera looks at it (1: dead on). */
function aim(camera: THREE.Camera, point: THREE.Vector3) {
  const toward = point.clone().sub(camera.position);
  return { distance: toward.length(), facing: camera.getWorldDirection(new THREE.Vector3()).dot(toward.normalize()) };
}

describe('the camera pivots about what is in the middle of the screen (1.8.3.2)', () => {
  const knob = CAMERA.pivotOnParts;
  afterEach(() => {
    CAMERA.pivotOnParts = knob;
  });

  it('picks the pivot on press, along the line already looked down — no view jump', () => {
    const { camera, canvas, controls, picks, eye, direction } = setUp(1.5);
    canvas.dispatch('pointerdown', { ...pointer, clientX: 400, clientY: 400 });
    expect(picks).toHaveLength(1);
    picks[0].origin.forEach((v, i) => expect(v).toBeCloseTo(eye.getComponent(i), 12));
    picks[0].direction.forEach((v, i) => expect(v).toBeCloseTo(direction.getComponent(i), 12));
    controls.update(1 / 60);
    // The view is where it was; the camera now orbits a point 1.5 m along it.
    expect(camera.position.distanceTo(eye)).toBeLessThan(1e-9);
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(direction)).toBeLessThan(1e-9);
  });

  it('holds the pivot through the whole orbit — no sliding to the floor', () => {
    const { camera, canvas, controls, picks, eye, direction } = setUp(1.5);
    const pivot = eye.clone().addScaledVector(direction, 1.5);
    canvas.dispatch('pointerdown', { ...pointer, clientX: 400, clientY: 400 });
    for (let x = 410; x <= 560; x += 10) {
      canvas.ownerDocument.dispatch('pointermove', { ...pointer, clientX: x, clientY: 400 + (x - 400) / 4 });
      controls.update(1 / 60);
      const { distance, facing } = aim(camera, pivot);
      expect(distance).toBeCloseTo(1.5, 9);
      expect(facing).toBeCloseTo(1, 9);
    }
    canvas.ownerDocument.dispatch('pointerup', { ...pointer, clientX: 560, clientY: 440 });
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    expect(aim(camera, pivot).distance).toBeCloseTo(1.5, 9);
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(direction)).toBeGreaterThan(0.05);
    expect(picks).toHaveLength(1);
  });

  it.each([0.05, 7, null])('falls back to the floor with a hit out of range or none (%s)', (hit) => {
    const { camera, canvas, controls, eye, direction } = setUp(hit);
    const floor = eye.clone().addScaledVector(direction, eye.y / -direction.y);
    canvas.dispatch('pointerdown', { ...pointer, clientX: 400, clientY: 400 });
    for (let x = 410; x <= 500; x += 10) canvas.ownerDocument.dispatch('pointermove', { ...pointer, clientX: x, clientY: 400 });
    canvas.ownerDocument.dispatch('pointerup', { ...pointer, clientX: 500, clientY: 400 });
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    const { distance, facing } = aim(camera, floor);
    expect(distance).toBeCloseTo(eye.distanceTo(floor), 9);
    expect(facing).toBeCloseTo(1, 9);
  });

  it('re-picks on a wheel too, before it zooms', () => {
    const { canvas, picks } = setUp(1.5);
    canvas.dispatch('wheel', { ...pointer, clientX: 400, clientY: 400, deltaY: -100, deltaMode: 0 });
    expect(picks).toHaveLength(1);
  });

  it('with pivotOnParts 0, never picks and orbits about the floor spot in view every update, as before', () => {
    CAMERA.pivotOnParts = 0;
    const { camera, canvas, controls, picks } = setUp(1.5);
    const floorInView = () => {
      const look = camera.getWorldDirection(new THREE.Vector3());
      return camera.position.clone().addScaledVector(look, camera.position.y / -look.y);
    };
    canvas.dispatch('pointerdown', { ...pointer, clientX: 400, clientY: 400 });
    for (let x = 410; x <= 500; x += 10) {
      const floor = floorInView();
      const radius = camera.position.distanceTo(floor);
      canvas.ownerDocument.dispatch('pointermove', { ...pointer, clientX: x, clientY: 400 });
      controls.update(1 / 60);
      // Re-seated each update: every step turns about the floor spot looked at before it.
      expect(camera.position.distanceTo(floor)).toBeCloseTo(radius, 9);
      expect(aim(camera, floor).facing).toBeCloseTo(1, 9);
    }
    expect(picks).toHaveLength(0);
  });
});
