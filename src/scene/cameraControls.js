import { MOUSE, TOUCH } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, CAMERA_LIMITS } from '../constants.js';

/**
 * Touch camera: one finger orbits, two fingers pan + pinch-zoom; limits keep the camera
 * inside the room and above the floor.
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
  controls.cursor.set(...CAMERA_LIMITS.pivot);
  controls.maxTargetRadius = CAMERA_LIMITS.maxTargetRadius;

  controls.target.set(...CAMERA.startTarget);
  controls.update();

  return {
    /** Call once per frame — applies damping. */
    update(deltaSeconds) {
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
    dispose() {
      controls.dispose();
    },
  };
}
