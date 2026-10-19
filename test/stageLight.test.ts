import { describe, expect, it } from 'vitest';
import { ROOM, STAGE } from '../src/constants.js';
import { celestial, daylightAt } from '../src/game/scenery.js';
import { skyColourAt } from '../src/game/skyCycle.js';
import { clipToRect, lightLevel, lightTint, patchFootprint, sunArc, windowPatch } from '../src/game/stageLight.js';
import type { Rgb } from '../src/game/skyCycle.js';
import { WALL_NAMES, wallBox, windowOpeningBoxes } from '../src/game/stageBoxes.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

const { light } = STAGE;
const ROOM_HALF_DEPTH = ROOM.depth / 2;
const RAD = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const PHASES = Array.from({ length: 1001 }, (_, i) => i / 1001);
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};

describe('the sun arc', () => {
  it('stands over the back-left corner at noon, at the peak', () => {
    const { toSun, up } = sunArc(0.5);
    expect(up).toBe(true);
    expect(Math.hypot(...toSun)).toBeCloseTo(1);
    expect(Math.asin(toSun[1])).toBeCloseTo(light.peak * RAD);
    expect(toSun[0]).toBeCloseTo(toSun[2]);
    expect(toSun[0]).toBeLessThan(0);
  });

  it('rises outside the left wall and sets outside the back wall', () => {
    const dawn = sunArc(0.25).toSun;
    expect(dot(dawn, [-1, 0, 0])).toBeGreaterThan(0);
    expect(dot(dawn, [0, 0, -1])).toBeLessThan(0);
    const dusk = sunArc(0.75).toSun;
    expect(dot(dusk, [0, 0, -1])).toBeGreaterThan(0);
    expect(dot(dusk, [-1, 0, 0])).toBeLessThan(0);
  });

  it('sits at the minimum elevation, down, at midnight', () => {
    const { toSun, up } = sunArc(0);
    expect(up).toBe(false);
    expect(toSun[1]).toBeCloseTo(Math.sin(STAGE.light.peak * RAD));
  });

  it('is never lower than the minimum elevation, never jumps, and is up with the scenery sun', () => {
    const floor = Math.sin(light.minElevation * RAD);
    let previous = sunArc(PHASES[PHASES.length - 1]! - 1).toSun.slice() as Vec3;
    for (const phase of PHASES) {
      const { toSun, up } = sunArc(phase);
      expect(toSun[1]).toBeGreaterThanOrEqual(floor - 1e-9);
      expect(Math.hypot(toSun[0] - previous[0], toSun[1] - previous[1], toSun[2] - previous[2])).toBeLessThan(0.02);
      expect(up).toBe(celestial(phase).sun.visible);
      previous = toSun.slice() as Vec3;
    }
  });
});

describe('the light level', () => {
  it('is 1 at noon and exactly the floor in the dark', () => {
    for (const floor of [0.1, 0.3, 1]) {
      expect(lightLevel(0.5, floor)).toBeCloseTo(1);
      expect(lightLevel(0, floor)).toBeCloseTo(floor);
      expect(lightLevel(0.97, floor)).toBeCloseTo(floor);
    }
  });

  it('follows the daylight and stays within the floor and 1', () => {
    const sorted = [...PHASES].sort((a, b) => daylightAt(a) - daylightAt(b));
    for (let i = 1; i < sorted.length; i++) {
      expect(lightLevel(sorted[i]!, 0.3)).toBeGreaterThanOrEqual(lightLevel(sorted[i - 1]!, 0.3) - 1e-9);
    }
    for (const phase of PHASES) {
      const level = lightLevel(phase, 0.3);
      expect(level).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(level).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('reads the live knob by default', () => {
    const was = light.nightFloor;
    light.nightFloor = 0.5;
    try {
      expect(lightLevel(0)).toBeCloseTo(0.5);
    } finally {
      light.nightFloor = was;
    }
  });
});

describe('the light tint', () => {
  const tint = (phase: number): Rgb => lightTint(phase, skyColourAt(phase), [0, 0, 0]);

  it('is white at noon', () => {
    tint(0.5).forEach((c) => expect(c).toBeCloseTo(1));
  });

  it('takes the sky hue the tint depth of the way in the dark, cool', () => {
    const sky = skyColourAt(0);
    const brightest = Math.max(...sky);
    const out = tint(0);
    out.forEach((c, i) => expect(c).toBeCloseTo(1 - light.tintDepth * (1 - sky[i]! / brightest)));
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[1]);
  });

  it('is warm at dawn', () => {
    const out = tint(0.25);
    expect(out[0]).toBeGreaterThanOrEqual(out[2]);
  });
});

describe('the window patch', () => {
  const footprint = patchFootprint();
  const back = windowOpeningBoxes('back')[0]!;
  const left = windowOpeningBoxes('left')[0]!;
  const backOut = wallBox('back').outward;
  const leftOut = wallBox('left').outward;
  const inside = (p: [number, number]) =>
    p[0] >= footprint.min[0] - 1e-9 && p[0] <= footprint.max[0] + 1e-9 && p[1] >= footprint.min[1] - 1e-9 && p[1] <= footprint.max[1] + 1e-9;
  const sill = STAGE.window.sill;
  const top = STAGE.window.sill + STAGE.window.height;

  it('is a parallelogram sill..sill+height into the room for a sun straight out at 45 degrees', () => {
    const patch = windowPatch(back, backOut, unit([0, 1, -1]), footprint);
    expect(patch).toHaveLength(4);
    const zs = patch.map((p) => p[1]);
    expect(Math.min(...zs)).toBeCloseTo(-ROOM_HALF_DEPTH + sill);
    expect(Math.max(...zs)).toBeCloseTo(-ROOM_HALF_DEPTH + top);
    expect(Math.min(...patch.map((p) => p[0]))).toBeCloseTo(back.min[0]);
    expect(Math.max(...patch.map((p) => p[0]))).toBeCloseTo(back.max[0]);
    patch.forEach((p) => expect(inside(p)).toBe(true));
  });

  it('shifts away from a sun on the left', () => {
    const straight = windowPatch(back, backOut, unit([0, 1, -1]), footprint);
    const slanted = windowPatch(back, backOut, unit([-0.5, 1, -1]), footprint);
    expect(Math.min(...slanted.map((p) => p[0]))).toBeGreaterThan(Math.min(...straight.map((p) => p[0])));
  });

  it('is clipped to the slab for a low sun', () => {
    const low = unit([0, Math.sin(10 * RAD), -Math.cos(10 * RAD)]);
    const patch = windowPatch(back, backOut, low, footprint);
    expect(patch.length).toBeGreaterThanOrEqual(3);
    patch.forEach((p) => expect(inside(p)).toBe(true));
    expect(Math.max(...patch.map((p) => p[1]))).toBeCloseTo(footprint.max[1]);
  });

  it('is empty with the sun down or on the room side of the wall', () => {
    expect(windowPatch(back, backOut, unit([0, 1, 1]), footprint)).toEqual([]);
    expect(windowPatch(back, backOut, [0, -0.5, -0.5], footprint)).toEqual([]);
  });

  it('starts at the sill from the left wall', () => {
    const patch = windowPatch(left, leftOut, unit([-1, 1, 0]), footprint);
    expect(Math.min(...patch.map((p) => p[0]))).toBeCloseTo(-3 + sill);
  });

  it('has a patch for every opening at noon', () => {
    const { toSun } = sunArc(0.5);
    for (const name of WALL_NAMES) {
      for (const box of windowOpeningBoxes(name)) {
        expect(windowPatch(box, wallBox(name).outward, toSun, footprint).length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('clipToRect', () => {
  const square = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

  it('leaves a square inside unchanged', () => {
    expect(clipToRect(square(-1, -1, 1, 1), [-2, -2], [2, 2])).toEqual(square(-1, -1, 1, 1));
  });

  it('cuts a half outside', () => {
    const clipped = clipToRect(square(-1, -1, 3, 1), [-2, -2], [2, 2]);
    expect(Math.max(...clipped.map((p) => p[0]))).toBeCloseTo(2);
    expect(Math.min(...clipped.map((p) => p[0]))).toBeCloseTo(-1);
  });

  it('is empty when wholly outside', () => {
    expect(clipToRect(square(5, 5, 6, 6), [-2, -2], [2, 2])).toEqual([]);
  });
});
