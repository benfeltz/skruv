import { MOUSE, TOUCH } from 'three';
import type { Camera } from 'three';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, CAMERA_LIMITS, ROOM } from '../constants.js';
import { clampCamera, clampTargetAlongView, panSpeedAt, pivotAlongView, seatOnFloor } from './cameraLimits.js';

/** How far along `direction` (unit) from `origin` the first part is, or null for none. */
export type PickDistance = (origin: Vec3, direction: Vec3) => number | null;

/**
 * Touch camera: one finger orbits, two fingers pan + pinch-zoom toward the fingers (so a
 * pinch on a dowel closes in on that dowel). The orbit target roams the whole floor; after
 * every update the target and camera are clamped (cameraLimits.js) — camera inside the
 * walls horizontally, above the floor, free to rise over the wall tops.
 *
 * The pivot: when a gesture starts (OrbitControls' `start` — a press, a wheel, a second
 * finger joining) the target moves along the line of sight to the first part `pickDistance`
 * finds there, else the floor (cameraLimits.js `pivotAlongView`), and holds for the whole
 * gesture — the view never jumps, and the camera turns about what is in the middle of the
 * screen. With `CAMERA.pivotOnParts` 0 (?tune) it is the floor pivot as before 1.8.3.2,
 * re-seated every update instead.
 *
 * `enable()`/`disable()` is the seam the gesture router drives to hand touches to part
 * manipulation — callers never reach into OrbitControls directly.
 */
export function createCameraControls(camera: Camera, domElement: HTMLElement, { pickDistance }: { pickDistance?: PickDistance } = {}) {
  const controls = new OrbitControls(camera, domElement);

  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

  // Shift is the desktop's part hold (src/main.ts), never a camera mode: a left drag orbits
  // and a right drag pans with it down or not. OrbitControls swaps the two once under any
  // of Ctrl, Cmd and Shift, so a press with Shift as the only one gets them pre-swapped —
  // in the capture phase, before OrbitControls' own pointerdown on the same element reads
  // them. Ctrl/Cmd keep their swap, Shift or no Shift.
  function unswapShift(event: PointerEvent) {
    const swap = event.shiftKey && !event.ctrlKey && !event.metaKey;
    controls.mouseButtons.LEFT = swap ? MOUSE.PAN : MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = swap ? MOUSE.ROTATE : MOUSE.PAN;
  }
  domElement.addEventListener('pointerdown', unswapShift, { capture: true });

  controls.enableDamping = true;
  controls.dampingFactor = CAMERA_LIMITS.dampingFactor;

  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.minPolarAngle = CAMERA_LIMITS.minPolarAngle;
  controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle;
  controls.zoomToCursor = true;

  // Where OrbitControls has the camera, unclamped — its orbit and zoom kept whole. The
  // wall clamp only moves the camera as drawn, so orbiting toward a wall slides along it
  // and the chosen distance comes back once the camera swings clear; the clamp never
  // leaks into OrbitControls' own state.
  const free = camera.position.clone();

  function confine() {
    free.copy(camera.position);
    controls.target.set(...clampTargetAlongView(controls.target.toArray(), free.toArray(), ROOM, CAMERA_LIMITS));
    camera.position.set(...clampCamera(free.toArray(), ROOM, CAMERA_LIMITS));
    camera.lookAt(controls.target);
  }

  function unconfine() {
    camera.position.copy(free);
    camera.lookAt(controls.target);
  }

  // A gesture's pivot, picked once as it starts — from the unclamped eye, down the line
  // OrbitControls orbits along. Every press handler has only recorded screen positions by
  // then (and the wheel fires it before zooming), so moving the target here is safe. While
  // the wall clamp has pushed the camera, that line is not the one on screen — moving the
  // target along it would turn the view — so the target stays.
  function pickPivot() {
    if (!CAMERA.pivotOnParts || camera.position.distanceTo(free) > 1e-6) return;
    const eye = free.toArray();
    const target = controls.target.toArray();
    const direction = controls.target.clone().sub(free).normalize().toArray();
    const hit = pickDistance ? pickDistance(eye, direction) : null;
    controls.target.set(...pivotAlongView(eye, target, hit, ROOM, CAMERA_LIMITS));
  }
  controls.addEventListener('start', pickPivot);

  // Every update runs from the unclamped pose and ends clamped — the per-frame one AND the
  // ones OrbitControls fires from inside its own wheel/pointer handlers, which would
  // otherwise read the clamped pose or have their zoom and pan thrown away.
  const orbitUpdate = controls.update.bind(controls);
  controls.update = (deltaSeconds) => {
    unconfine();
    // pivotOnParts 0 (the floor pivot as before): orbit and zoom about the floor spot in
    // view, re-seated every update. Read here, so a live ?tune flip lands at once.
    if (!CAMERA.pivotOnParts) controls.target.set(...seatOnFloor(free.toArray(), controls.target.toArray(), CAMERA_LIMITS));
    const changed = orbitUpdate(deltaSeconds);
    confine();
    return changed;
  };

  controls.target.set(...CAMERA.startTarget);
  controls.update();

  return {
    /** Call once per frame — applies damping. */
    update(deltaSeconds: number) {
      controls.panSpeed = panSpeedAt(free.distanceTo(controls.target), CAMERA_LIMITS);
      controls.update(deltaSeconds);
    },
    enable() {
      controls.enabled = true;
    },
    disable() {
      controls.enabled = false;
    },
    get enabled() {
      return controls.enabled;
    },
    /** Puts the camera at `position` looking at `target` — a re-frame, e.g. a retuned start. */
    frame({ position, target }: { position: Vec3; target: Vec3 }) {
      free.set(...position);
      controls.target.set(...target);
      controls.update();
    },
    dispose() {
      domElement.removeEventListener('pointerdown', unswapShift, { capture: true });
      controls.removeEventListener('start', pickPivot);
      controls.dispose();
    },
  };
}

export type CameraControls = ReturnType<typeof createCameraControls>;
