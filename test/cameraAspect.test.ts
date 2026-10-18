import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA, CAMERA_LIMITS } from '../src/constants.js';
import { createCameraControls } from '../src/scene/cameraControls.js';
import { zoomOutLimit } from '../src/scene/cameraLimits.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

// 1.9.7.1.3: the zoom-out limit follows the camera's aspect through the controls. The real
// OrbitControls on a minimal fake element, as in cameraPivot.test.ts.

class FakeCanvas {
  style: Record<string, string> = {};
  clientWidth = 800;
  clientHeight = 800;
  ownerDocument = { addEventListener() {}, removeEventListener() {} };
  addEventListener() {}
  removeEventListener() {}
  getRootNode() {
    return this.ownerDocument;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 800 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

// The camera `distance` metres from the start target along the start view.
const farOut = (distance: number): { position: Vec3; target: Vec3 } => {
  const target = CAMERA.startTarget;
  const away = new THREE.Vector3(...CAMERA.startPosition).sub(new THREE.Vector3(...target)).normalize().multiplyScalar(distance);
  return { position: [target[0] + away.x, target[1] + away.y, target[2] + away.z], target };
};

describe('the zoom-out limit follows the camera’s aspect (1.9.7.1.3)', () => {
  it('lets a portrait view out to its limit, and brings a turned phone back to landscape’s', () => {
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 390 / 844, 0.01, 100);
    camera.position.set(...CAMERA.startPosition);
    const controls = createCameraControls(camera, new FakeCanvas() as unknown as HTMLElement);
    const distance = () => camera.position.distanceTo(new THREE.Vector3(...CAMERA.startTarget));

    controls.frame(farOut(20));
    controls.update(0);
    expect(distance()).toBeCloseTo(zoomOutLimit(390 / 844, CAMERA_LIMITS), 3);

    camera.aspect = 844 / 390;
    camera.updateProjectionMatrix();
    controls.update(0);
    expect(distance()).toBeCloseTo(CAMERA_LIMITS.maxDistance, 3);
  });
});
