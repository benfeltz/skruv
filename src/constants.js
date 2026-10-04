// Every tunable lives here — modules import names, never literals.
// Units: metres, seconds, radians.

export const ROOM = {
  width: 10,
  depth: 10,
  // No ceiling — walls are tall enough that the orbit limits keep the camera below them.
  height: 5,
};

export const COLORS = {
  background: 0x1b1d22,
  floor: 0xc9b79c,
  wall: 0xe8e4dc,
  testBox: 0x3b6ea8,
  skyLight: 0xffffff,
  groundLight: 0x8a7a66,
  sunLight: 0xffffff,
};

export const LIGHTS = {
  hemisphereIntensity: 1.2,
  sunIntensity: 1.6,
  sunPosition: [-4, 7, 2],
  shadowMapSize: 1024,
  shadowExtent: 6,
};

export const CAMERA = {
  fov: 50,
  near: 0.1,
  far: 100,
  startPosition: [2, 1.8, 2.4],
  startTarget: [0, 0.6, 0],
};

// Orbit limits. maxDistance is derived from these and ROOM by
// src/scene/cameraLimits.js so the camera stays wallMargin inside the walls and below
// their tops; the pivot and maxPolarAngle keep it above the floor.
export const CAMERA_LIMITS = {
  // Centre of the sphere the orbit target may be panned within.
  pivot: [0, 1, 0],
  maxTargetRadius: 0.8,
  wallMargin: 0.4,
  minDistance: 1,
  // Stops short of straight down so the wall tops bound height without crushing zoom-out.
  minPolarAngle: (40 * Math.PI) / 180,
  maxPolarAngle: (80 * Math.PI) / 180,
  dampingFactor: 0.1,
};

export const TEST_BOX = {
  size: 0.6,
};

export const RENDER = {
  // Above 2 the fill-rate cost on phones outweighs the visible sharpness gain.
  maxPixelRatio: 2,
  // A backgrounded tab resumes with a huge rAF gap; cap it so nothing jumps.
  maxFrameDelta: 1 / 15,
};
