import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA } from '../src/constants.js';
import { createCameraControls } from '../src/scene/cameraControls.js';
import type { PickDistance } from '../src/scene/cameraControls.js';

// 1.8.3.2 test plan: the phone's gestures — a one-finger orbit, a second finger joining to
// pinch — each re-pick the pivot as they start, and a pinch holds the pivot it picked. The
// real OrbitControls on a minimal fake element, as in cameraPivot.test.ts.

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

const finger = (pointerId: number, x: number, y: number) => ({
  pointerId, pointerType: 'touch', button: 0, shiftKey: false, ctrlKey: false, metaKey: false,
  clientX: x, clientY: y, pageX: x, pageY: y, preventDefault() {},
});

describe('touch gestures pick their pivot as they start (1.8.3.2 test plan)', () => {
  it('a one-finger orbit picks once; a second finger joining picks again', () => {
    expect(CAMERA.pivotOnParts).toBe(1);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(...CAMERA.startPosition);
    const canvas = new FakeCanvas();
    let picks = 0;
    const pickDistance: PickDistance = () => {
      picks += 1;
      return 1.5;
    };
    const controls = createCameraControls(camera, canvas as unknown as HTMLElement, { pickDistance }); // a fake: listeners, style, rect
    canvas.dispatch('pointerdown', finger(1, 400, 400));
    for (let x = 410; x <= 450; x += 10) {
      canvas.ownerDocument.dispatch('pointermove', finger(1, x, 400));
      controls.update(1 / 60);
    }
    expect(picks).toBe(1);
    canvas.dispatch('pointerdown', finger(2, 500, 400));
    expect(picks).toBe(2);
  });

  it('a pinch holds the pivot it picked: the camera closes in along the line to it', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(...CAMERA.startPosition);
    const canvas = new FakeCanvas();
    const controls = createCameraControls(camera, canvas as unknown as HTMLElement, { pickDistance: () => 1.5 }); // a fake: listeners, style, rect
    const eye = camera.position.clone();
    const look = camera.getWorldDirection(new THREE.Vector3());
    const pivot = eye.clone().addScaledVector(look, 1.5);
    // Both fingers down symmetrically about the screen centre, then spread apart: the
    // pinch's midpoint stays at the centre, so zoom-to-cursor dollies straight at the pivot.
    canvas.dispatch('pointerdown', finger(1, 350, 400));
    canvas.dispatch('pointerdown', finger(2, 450, 400));
    for (let spread = 60; spread <= 150; spread += 10) {
      canvas.ownerDocument.dispatch('pointermove', finger(1, 400 - spread, 400));
      canvas.ownerDocument.dispatch('pointermove', finger(2, 400 + spread, 400));
      controls.update(1 / 60);
    }
    canvas.ownerDocument.dispatch('pointerup', finger(1, 250, 400));
    canvas.ownerDocument.dispatch('pointerup', finger(2, 550, 400));
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    // Closer than the pivot was, still looking at it. Not exactly: the fake moves one
    // finger at a time, so every other event the pinch midpoint sits 5 px off centre and
    // zoom-to-cursor dollies that little way toward it (≈0.1°, as on main).
    const toward = pivot.clone().sub(camera.position);
    expect(toward.length()).toBeLessThan(1.5 - 0.1);
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(toward)).toBeLessThan(0.005);
  });

  it('a wheel at the screen centre closes in exactly along the line to the pivot it picked', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(...CAMERA.startPosition);
    const canvas = new FakeCanvas();
    // Every wheel tick is a gesture of its own and re-picks: the stub answers as a raycast
    // would, with how far the part at `pivot` is along the ray.
    const pivot = new THREE.Vector3();
    const pickDistance: PickDistance = (origin) => pivot.distanceTo(new THREE.Vector3(...origin));
    const controls = createCameraControls(camera, canvas as unknown as HTMLElement, { pickDistance }); // a fake: listeners, style, rect
    // The part sits 1.5 m along the start view.
    pivot.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 1.5);
    for (let i = 0; i < 5; i++) canvas.dispatch('wheel', { ...finger(1, 400, 400), pointerType: 'mouse', deltaY: -100, deltaMode: 0 });
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    // Each tick scales the radius about the held pivot by 0.95 (OrbitControls' wheel step);
    // about the floor 5 m off, as before 1.8.3.2, the camera would end ≈0.37 m from it.
    const toward = pivot.clone().sub(camera.position);
    expect(toward.length()).toBeCloseTo(1.5 * 0.95 ** 5, 6);
    expect(camera.getWorldDirection(new THREE.Vector3()).angleTo(toward)).toBeLessThan(1e-9);
  });
});
