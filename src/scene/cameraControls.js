import { MOUSE, TOUCH, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, CAMERA_LIMITS, ROOM } from '../constants.js';
import { clampCamera, clampTargetAlongView, panSpeedAt, seatOnFloor } from './cameraLimits.js';

/**
 * Touch camera: one finger orbits, two fingers pan + pinch-zoom toward the fingers (so a
 * pinch on a dowel closes in on that dowel). The orbit target roams the whole floor; after
 * every update the target and camera are clamped (cameraLimits.js) — camera inside the
 * walls horizontally, above the floor, free to rise over the wall tops.
 *
 * `enable()`/`disable()` is the seam the gesture router drives to hand touches to part
 * manipulation — callers never reach into OrbitControls directly.
 */
export function createCameraControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);

  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

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

  // Every update runs from the unclamped pose and ends clamped — the per-frame one AND the
  // ones OrbitControls fires from inside its own wheel/pointer handlers, which would
  // otherwise read the clamped pose or have their zoom and pan thrown away.
  const orbitUpdate = controls.update.bind(controls);
  controls.update = (deltaSeconds) => {
    unconfine();
    // Orbit and zoom about the floor spot in view, not a point hanging in the air.
    controls.target.set(...seatOnFloor(free.toArray(), controls.target.toArray(), CAMERA_LIMITS));
    const changed = orbitUpdate(deltaSeconds);
    confine();
    return changed;
  };

  controls.target.set(...CAMERA.startTarget);
  controls.update();

  return {
    /** Call once per frame — applies damping. */
    update(deltaSeconds) {
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
    frame({ position, target }) {
      free.set(...position);
      controls.target.set(...target);
      controls.update();
    },
    dispose() {
      controls.dispose();
    },
  };
}
