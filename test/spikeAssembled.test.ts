import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { loadPack } from '../tools/validate/lib/pack.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';
import { MANIFEST } from '../src/game/item.js';
import { isSpikeAssembled, spikeAssembledPlan } from '../src/game/spikeAssembled.js';

// The pack read fresh from disk, as the validator CLI reads it — not through the game's door.
const pack = loadPack(JSON.parse(readFileSync(new URL('../items/johnny/flatpack.json', import.meta.url), 'utf8')) as FlatpackFile);

describe('?spike=assembled boot plan (engine spike 1.2)', () => {
  const plan = spikeAssembledPlan();

  it('seats one pair per validator-derived joint', () => {
    expect(plan.pairs).toHaveLength(deriveJoints(pack).length);
    expect(plan.pairs.length).toBeGreaterThan(0);
  });

  it('spawns every assembled instance, and every other manifest entry loose', () => {
    expect(plan.assembled.map(({ id }) => id).sort()).toEqual(pack.assembled.map(({ id }) => id).sort());
    expect([...plan.assembled, ...plan.loose].map(({ id }) => id).sort()).toEqual(MANIFEST.map(({ id }) => id).sort());
    expect(plan.loose.length).toBeGreaterThan(0);
  });

  it('joins only parts it spawns assembled', () => {
    const placed = new Set(plan.assembled.map(({ id }) => id));
    for (const { partA, partB, mover } of plan.pairs) {
      expect(placed.has(partA) && placed.has(partB) && placed.has(mover)).toBe(true);
    }
  });

  it('turns on only for ?spike=assembled', () => {
    expect(isSpikeAssembled('?spike=assembled')).toBe(true);
    expect(isSpikeAssembled('?tune&spike=assembled')).toBe(true);
    expect(isSpikeAssembled('')).toBe(false);
    expect(isSpikeAssembled('?tune')).toBe(false);
    expect(isSpikeAssembled('?spike=other')).toBe(false);
  });
});
