import * as THREE from 'three';
import { COLORS, LIGHTS, STAGE } from '../constants.js';
import { lightLevel, lightTint, sunArc } from '../game/stageLight.js';
import type { SunArc } from '../game/stageLight.js';
import { skyColourAt } from '../game/skyCycle.js';
import type { Rgb } from '../game/skyCycle.js';

/**
 * The stage's light: a hemisphere fill and one shadow-casting sun, built once. `update(phase)` turns the sun along its
 * arc and sets both lights' strength and colour from the sky's phase (src/game/stageLight.ts); it reads the night
 * floor knob live, so a change is felt on the next frame. The group goes in the scene.
 */
export function createStageLight() {
  const group = new THREE.Group();
  group.name = 'stageLight';

  const hemisphere = new THREE.HemisphereLight(COLORS.skyLight, COLORS.groundLight, LIGHTS.hemisphereIntensity);
  const sun = new THREE.DirectionalLight(COLORS.sunLight, LIGHTS.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LIGHTS.shadowMapSize, LIGHTS.shadowMapSize);
  sun.shadow.normalBias = LIGHTS.shadowNormalBias;
  const extent = LIGHTS.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
  // The sun shines at its target; both stand in the group so the direction applies.
  group.add(hemisphere, sun, sun.target);

  // Reused every frame, so the loop allocates nothing.
  const arc: SunArc = { toSun: [0, 0, 0], up: false };
  const sky: Rgb = [0, 0, 0];
  const tint: Rgb = [0, 0, 0];
  let appliedPhase = NaN;
  let appliedFloor = NaN;

  return {
    group,
    sun,
    hemisphere,
    update(phase: number) {
      const floor = STAGE.light.nightFloor;
      if (phase === appliedPhase && floor === appliedFloor) return;
      appliedPhase = phase;
      appliedFloor = floor;
      sunArc(phase, arc);
      sun.position.set(arc.toSun[0], arc.toSun[1], arc.toSun[2]).multiplyScalar(LIGHTS.sunDistance);
      const level = lightLevel(phase, floor);
      lightTint(phase, skyColourAt(phase, sky), tint);
      sun.intensity = LIGHTS.sunIntensity * level;
      hemisphere.intensity = LIGHTS.hemisphereIntensity * level;
      sun.color.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
      hemisphere.color.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
    },
  };
}
