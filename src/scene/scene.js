import * as THREE from 'three';
import { CAMERA, COLORS, LIGHTS, RENDER } from '../constants.js';
import { startPosition } from './cameraLimits.js';
import { clampPixelRatio } from './clamp.js';

/**
 * Renderer, camera and lights mounted in `container`; keeps size and DPR in sync.
 * `startPose()` is where the camera starts on this device — `{ position, target }`, a
 * phone's pulled back by CAMERA.mobileStartScale — read again when that knob turns.
 */
export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  // A coarse pointer is a phone or tablet: a small screen held close, framed further out.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const startPose = () => ({
    position: coarse ? startPosition(CAMERA.startPosition, CAMERA.startTarget, CAMERA.mobileStartScale) : CAMERA.startPosition,
    target: CAMERA.startTarget,
  });

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(...startPose().position);
  camera.lookAt(...CAMERA.startTarget);

  scene.add(
    new THREE.HemisphereLight(COLORS.skyLight, COLORS.groundLight, LIGHTS.hemisphereIntensity),
  );

  const sun = new THREE.DirectionalLight(COLORS.sunLight, LIGHTS.sunIntensity);
  sun.position.set(...LIGHTS.sunPosition);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LIGHTS.shadowMapSize, LIGHTS.shadowMapSize);
  sun.shadow.normalBias = LIGHTS.shadowNormalBias;
  const extent = LIGHTS.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
  scene.add(sun);

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio, RENDER.maxPixelRatio));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // A DPR change (window dragged to another monitor, browser zoom) need not change the
  // container's CSS size, so watch it separately; the query matches one DPR, so re-arm.
  function watchPixelRatio() {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        resize();
        watchPixelRatio();
      },
      { once: true },
    );
  }

  new ResizeObserver(resize).observe(container);
  watchPixelRatio();
  resize();

  return { renderer, scene, camera, startPose };
}
