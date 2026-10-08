import { describe, expect, it } from 'vitest';
import {
  connectorInWorld,
  contains,
  multiplyQuaternions,
  placeLayout,
  rotateVector,
  rotationBetween,
} from '../tools/validate/lib/geometry.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

const expectVec = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
const QUARTER_Y: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

describe('rotationBetween', () => {
  it('handles exactly opposite vectors', () => {
    expectVec(rotateVector(rotationBetween([0, 1, 0], [0, -1, 0]), [0, 1, 0]), [0, -1, 0]);
  });

  it('takes one unit vector onto another', () => {
    expectVec(rotateVector(rotationBetween([1, 0, 0], [0, 0, 1]), [1, 0, 0]), [0, 0, 1]);
  });
});

describe('multiplyQuaternions', () => {
  it('applies the right-hand rotation first', () => {
    const twice = multiplyQuaternions(QUARTER_Y, QUARTER_Y);
    expectVec(rotateVector(twice, [1, 0, 0]), [-1, 0, 0]);
  });
});

describe('connectorInWorld', () => {
  it('turns and moves a part-local connector by the pose', () => {
    const at = connectorInWorld({ position: [1, 0, 0], axis: [1, 0, 0] }, { position: [0, 2, 0], rotation: QUARTER_Y });
    expectVec(at.position, [0, 2, -1]);
    expectVec(at.axis, [0, 0, -1]);
  });
});

describe('contains', () => {
  const size: Vec3 = [2, 0.2, 1];

  it('holds points inside the posed box, faces included', () => {
    expect(contains(size, { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, [1, 0.1, -0.5])).toBe(true);
  });

  it('rejects points outside it, in the box frame', () => {
    const turned: Pose = { position: [5, 0, 0], rotation: QUARTER_Y };
    expect(contains(size, turned, [5, 0, 0.9])).toBe(true);
    expect(contains(size, turned, [5.9, 0, 0])).toBe(false);
  });
});

describe('placeLayout', () => {
  it('carries every pose by one rigid placement', () => {
    const [placed] = placeLayout([{ id: 'a', position: [1, 0, 0], rotation: [0, 0, 0, 1] }], { position: [0, 0, 3], rotation: QUARTER_Y });
    expect(placed.id).toBe('a');
    expectVec(placed.position, [0, 0, 2]);
    expectVec(placed.rotation, QUARTER_Y);
  });
});
