import { describe, expect, it } from 'vitest';
import { normalizeQuaternion, rotateVector } from '../tools/validate/lib/geometry.js';
import { AIM } from '../src/constants.js';
import { aimedRotation, aimStep, aimWeight, nearestTarget } from '../src/game/toolAim.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

const UP: Vec3 = [0, 1, 0];
const TIP: Vec3 = [0, 0, 1]; // the Allen key's tip axis, local
const IDENTITY: Quat = [0, 0, 0, 1];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Angle between the tip's world axis and straight into a target facing `axis` (0 = seated head-on).
const misalignment = (rotation: Quat, axis: Vec3) => Math.acos(Math.min(1, Math.max(-1, -dot(rotateVector(rotation, TIP), axis))));
const aboutX = (angle: number): Quat => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

describe('aimWeight', () => {
  it('is 1 on the target and 0 at and beyond the zone edge', () => {
    expect(aimWeight(0, AIM.zone)).toBe(1);
    expect(aimWeight(AIM.zone, AIM.zone)).toBe(0);
    expect(aimWeight(AIM.zone * 2, AIM.zone)).toBe(0);
  });

  it('falls monotonically in between', () => {
    const samples = Array.from({ length: 21 }, (_, i) => aimWeight((AIM.zone * i) / 20, AIM.zone));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
  });
});

describe('nearestTarget', () => {
  const targets = [{ position: [0.2, 0, 0] as Vec3 }, { position: [0.1, 0, 0] as Vec3 }, { position: [0.5, 0, 0] as Vec3 }];

  it('picks the nearest inside the zone, with its distance', () => {
    const near = nearestTarget([0, 0, 0], targets, AIM.zone);
    expect(near?.target).toBe(targets[1]);
    expect(near?.distance).toBeCloseTo(0.1, 12);
  });

  it('is null when nothing is inside the zone', () => {
    expect(nearestTarget([0, 0, 0], [targets[2]], AIM.zone)).toBeNull();
    expect(nearestTarget([0, 0, 0], [{ position: [AIM.zone, 0, 0] as Vec3 }], AIM.zone)).toBeNull();
  });
});

describe('aimedRotation', () => {
  it.each([
    ['lying flat (tip horizontal)', IDENTITY],
    ['170° off (tip nearly straight up)', aboutX((-80 * Math.PI) / 180)],
    ['already tilted sideways', normalizeQuaternion([0.2, 0.3, 0.1, 0.92])],
  ])('points the tip straight into an upward target from %s', (_, start) => {
    expect(misalignment(aimedRotation(start, TIP, UP), UP)).toBeCloseTo(0, 6);
  });

  it('starts from a genuinely skewed tip', () => {
    expect(misalignment(IDENTITY, UP)).toBeCloseTo(Math.PI / 2, 9);
    expect(misalignment(aboutX((-80 * Math.PI) / 180), UP)).toBeCloseTo((170 * Math.PI) / 180, 9);
  });
});

describe('aimStep', () => {
  it('closes the same share of the gap in half a second at 30, 60 and 120 fps', () => {
    const aimed = aimedRotation(IDENTITY, TIP, UP);
    const after = (fps: number) => {
      let rotation = IDENTITY;
      for (let i = 0; i < fps / 2; i++) rotation = aimStep(rotation, aimed, 0.5, AIM.rate, 1 / fps);
      return misalignment(rotation, UP);
    };
    expect(after(60)).toBeCloseTo(after(30), 6);
    expect(after(120)).toBeCloseTo(after(30), 6);
    expect(after(60)).toBeLessThan(Math.PI / 2);
  });

  it('leaves the rotation where it is at weight 0 or no time', () => {
    const aimed = aimedRotation(IDENTITY, TIP, UP);
    expect(aimStep(IDENTITY, aimed, 0, AIM.rate, 1 / 60)).toEqual(IDENTITY);
    expect(aimStep(IDENTITY, aimed, 1, AIM.rate, 0)).toEqual(IDENTITY);
  });
});
