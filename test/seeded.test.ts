import { describe, expect, it } from 'vitest';
import { seeded } from '../src/game/seeded.js';

const take = (seed: number, n = 10) => {
  const next = seeded(seed);
  return Array.from({ length: n }, next);
};

describe('seeded', () => {
  it('gives the same first ten values for the same seed', () => {
    expect(take(4127)).toEqual(take(4127));
  });

  it('draws values in [0, 1)', () => {
    for (const v of take(7, 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(take(1)).not.toEqual(take(2));
  });
});
