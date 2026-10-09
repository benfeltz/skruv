import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCameraControls } from '../src/scene/cameraControls.js';

// Ben's manual pass (2026-10-09): Shift is the desktop's part hold, so with it down a left
// drag on empty space still orbits — OrbitControls alone would pan — and a right drag pans.
// The real OrbitControls on a minimal fake element: capture listeners run first, as on a
// real target.

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

function dragOnEmptySpace(button: number, shiftKey: boolean) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  const canvas = new FakeCanvas();
  const controls = createCameraControls(camera, canvas as unknown as HTMLElement); // a fake: listeners, style, rect
  const before = camera.getWorldDirection(new THREE.Vector3());
  const from = camera.position.clone();
  const pointer = { pointerId: 1, pointerType: 'mouse', button, shiftKey, ctrlKey: false, metaKey: false, preventDefault() {} };
  canvas.dispatch('pointerdown', { ...pointer, clientX: 400, clientY: 400 });
  for (let x = 410; x <= 500; x += 10) canvas.ownerDocument.dispatch('pointermove', { ...pointer, clientX: x, clientY: 400 });
  canvas.ownerDocument.dispatch('pointerup', { ...pointer, clientX: 500, clientY: 400 });
  for (let i = 0; i < 60; i++) controls.update(1 / 60);
  const turned = camera.getWorldDirection(new THREE.Vector3()).angleTo(before);
  return { turned, moved: camera.position.distanceTo(from) };
}

describe('Shift never changes what a mouse drag on empty space does to the camera', () => {
  it.each([false, true])('a left drag orbits (Shift %s)', (shift) => {
    expect(dragOnEmptySpace(0, shift).turned).toBeGreaterThan(0.05);
  });

  it.each([false, true])('a right drag pans (Shift %s)', (shift) => {
    const { turned, moved } = dragOnEmptySpace(2, shift);
    expect(turned).toBeLessThan(1e-6);
    expect(moved).toBeGreaterThan(0.01);
  });
});
