import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { LIGHTS, STAGE } from '../src/constants.js';
import { sunArc } from '../src/game/stageLight.js';
import { createStageLight } from '../src/scene/stageLight.js';

const was = STAGE.light.nightFloor;
afterEach(() => {
  STAGE.light.nightFloor = was;
});

describe('the stage light', () => {
  it('stands at the noon sun, at full strength and white', () => {
    const light = createStageLight();
    light.update(0.5);
    const { toSun } = sunArc(0.5);
    light.sun.position.toArray().forEach((v, i) => expect(v).toBeCloseTo(toSun[i]! * LIGHTS.sunDistance));
    expect(light.sun.intensity).toBeCloseTo(LIGHTS.sunIntensity);
    expect(light.hemisphere.intensity).toBeCloseTo(LIGHTS.hemisphereIntensity);
    expect(light.sun.color.r).toBeCloseTo(1);
    expect(light.sun.color.b).toBeCloseTo(1);
  });

  it('dims to the night floor, cool, and the knob is felt on the next update', () => {
    STAGE.light.nightFloor = 0.3;
    const light = createStageLight();
    light.update(0);
    expect(light.sun.intensity).toBeCloseTo(LIGHTS.sunIntensity * 0.3);
    expect(light.hemisphere.intensity).toBeCloseTo(LIGHTS.hemisphereIntensity * 0.3);
    expect(light.sun.color.b).toBeGreaterThan(light.sun.color.r);
    STAGE.light.nightFloor = 1;
    light.update(0);
    expect(light.sun.intensity).toBeCloseTo(LIGHTS.sunIntensity);
    expect(light.hemisphere.intensity).toBeCloseTo(LIGHTS.hemisphereIntensity);
  });

  it('keeps the shadow setup the room had', () => {
    const { sun } = createStageLight();
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(LIGHTS.shadowMapSize);
    expect(sun.shadow.camera.left).toBe(-LIGHTS.shadowExtent);
    expect(sun.shadow.normalBias).toBe(LIGHTS.shadowNormalBias);
  });

  it('puts the sun and its target in the group', () => {
    const { group, sun } = createStageLight();
    expect(sun.parent).toBe(group);
    expect(sun.target.parent).toBe(group);
  });
});

describe('where the lights live', () => {
  it('leaves scene.ts without lights, and main.ts adding the light group', () => {
    const scene = readFileSync(new URL('../src/scene/scene.ts', import.meta.url), 'utf8');
    expect(scene).not.toMatch(/Light\(/);
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/scene\.add\(stageLight\.group\)/);
    expect(main).toMatch(/stageLight\.update\(/);
  });
});
