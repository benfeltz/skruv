import { describe, expect, it } from 'vitest';
import { STAGE } from '../src/constants.js';
import { floorBase, floorPlanks, slabBox } from '../src/game/floorPlanks.js';
import type { Plank } from '../src/game/floorPlanks.js';

const slab = slabBox();
const { plankWidth, plankThickness, plankLength, minEnd, jointGap } = STAGE.floor;
const EPS = 1e-6;

/** The planks grouped into rows by their near z, each row in x order. */
const rows = (planks: Plank[]): Plank[][] => {
  const byZ = new Map<number, Plank[]>();
  for (const p of planks) byZ.set(p.min[2], [...(byZ.get(p.min[2]) ?? []), p]);
  return [...byZ.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((a, b) => a.min[0] - b.min[0]));
};

describe('floorPlanks', () => {
  const planks = floorPlanks();

  it('lies inside the slab\'s footprint and spans y from -thickness to 0', () => {
    for (const p of planks) {
      expect(p.min[0]).toBeGreaterThanOrEqual(slab.min[0] - EPS);
      expect(p.max[0]).toBeLessThanOrEqual(slab.max[0] + EPS);
      expect(p.min[2]).toBeGreaterThanOrEqual(slab.min[2] - EPS);
      expect(p.max[2]).toBeLessThanOrEqual(slab.max[2] + EPS);
      expect(p.min[1]).toBeCloseTo(-plankThickness, 9);
      expect(p.max[1]).toBe(0);
    }
  });

  it('tiles z exactly in rows of plankWidth, the last trimmed to the slab\'s edge', () => {
    const all = rows(planks);
    all.forEach((row, i) => {
      const z0 = row[0]!.min[2];
      expect(z0).toBeCloseTo(slab.min[2] + i * plankWidth, 6);
      for (const p of row) expect(p.max[2]).toBeCloseTo(Math.min(z0 + plankWidth, slab.max[2]), 6);
    });
    expect(all.at(-1)![0]!.max[2]).toBeCloseTo(slab.max[2], 6);
  });

  it('tiles x exactly within each row, edge to edge', () => {
    for (const row of rows(planks)) {
      expect(row[0]!.min[0]).toBe(slab.min[0]);
      row.slice(1).forEach((p, i) => expect(p.min[0]).toBe(row[i]!.max[0]));
      expect(row.at(-1)!.max[0]).toBe(slab.max[0]);
    }
  });

  it('draws every length but a row\'s first and last within plankLength', () => {
    for (const row of rows(planks)) {
      for (const p of row.slice(1, -1)) {
        const length = p.max[0] - p.min[0];
        expect(length).toBeGreaterThanOrEqual(plankLength[0] - EPS);
        expect(length).toBeLessThanOrEqual(plankLength[1] + EPS);
      }
    }
  });

  it('leaves no sliver: every board is at least minEnd long', () => {
    for (const p of planks) expect(p.max[0] - p.min[0]).toBeGreaterThanOrEqual(minEnd - EPS);
  });

  it('keeps every butt joint jointGap from every joint of the row before', () => {
    const all = rows(planks);
    const joints = (row: Plank[]) => row.slice(0, -1).map((p) => p.max[0]);
    all.slice(1).forEach((row, i) => {
      for (const a of joints(row)) for (const b of joints(all[i]!)) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(jointGap - 1e-6);
    });
  });

  it('gives neighbours in a row different tones, all below the count', () => {
    for (const row of rows(planks)) row.forEach((p, i) => {
      expect(p.tone).toBeLessThan(STAGE.floor.tones.length);
      if (i > 0) expect(p.tone).not.toBe(row[i - 1]!.tone);
    });
  });

  it('is deterministic per seed', () => {
    expect(floorPlanks()).toEqual(planks);
    expect(floorPlanks(slab, { ...STAGE.floor, seed: STAGE.floor.seed + 1 })).not.toEqual(planks);
  });
});

describe('floorBase', () => {
  it('keeps the slab\'s footprint and lowers only its top', () => {
    const base = floorBase(slab);
    expect(base.min).toEqual(slab.min);
    expect(base.max[0]).toBe(slab.max[0]);
    expect(base.max[2]).toBe(slab.max[2]);
    expect(base.max[1]).toBeCloseTo(-plankThickness, 9);
  });
});
