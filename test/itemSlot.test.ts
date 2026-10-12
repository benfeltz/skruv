import { describe, expect, it } from 'vitest';
import { createItemSlot } from '../src/game/itemSlot.js';

// The swap's order (1.9.1): dispose the old world, turn the door, build the new one — so no
// world is ever built against the previous item's pack, and never two at once.

function slot() {
  const log: string[] = [];
  let built = 0;
  const items = createItemSlot({
    select: (id) => log.push(`select ${id}`),
    build: () => {
      const n = ++built;
      log.push(`build ${n}`);
      return { n, dispose: () => log.push(`dispose ${n}`) };
    },
  });
  return { items, log };
}

describe('createItemSlot', () => {
  it('holds no world until the first pick', () => {
    expect(slot().items.current).toBeNull();
  });

  it('builds the first pick with nothing to take down', () => {
    const { items, log } = slot();
    const world = items.pick('johnny');
    expect(items.current).toBe(world);
    expect(log).toEqual(['select johnny', 'build 1']);
  });

  it('swaps: dispose, then select, then build — a repick of the same item too', () => {
    const { items, log } = slot();
    items.pick('johnny');
    items.pick('blank');
    items.pick('blank');
    expect(log).toEqual(['select johnny', 'build 1', 'dispose 1', 'select blank', 'build 2', 'dispose 2', 'select blank', 'build 3']);
    expect(items.current?.n).toBe(3);
  });

  it('a pick the door refuses leaves the room empty, never half-built', () => {
    const items = createItemSlot({
      select: (id) => {
        if (id === 'nope') throw new Error('unknown item');
      },
      build: () => ({ dispose() {} }),
    });
    items.pick('johnny');
    expect(() => items.pick('nope')).toThrow('unknown item');
    expect(items.current).toBeNull();
  });
});
