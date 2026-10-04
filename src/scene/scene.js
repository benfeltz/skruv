import * as THREE from 'three';
import { CAMERA, COLORS, LIGHTS, RENDER } from '../constants.js';
import { clampPixelRatio } from './clamp.js';

/** Renderer, camera and lights mounted in `container`; keeps size and DPR in sync. */
export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.startPosition);
  camera.lookAt(...CAMERA.startTarget);

  scene.add(
    new THREE.HemisphereLight(COLORS.skyLight, COLORS.groundLight, LIGHTS.hemisphereIntensity),
  );

  const sun = new THREE.DirectionalLight(COLORS.sunLight, LIGHTS.sunIntensity);
  sun.position.set(...LIGHTS.sunPosition);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LIGHTS.shadowMapSize, LIGHTS.shadowMapSize);
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

  return { renderer, scene, camera };
}
