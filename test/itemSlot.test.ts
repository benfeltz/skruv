import { describe, expect, it } from 'vitest';
import { createItemSlot } from '../src/game/itemSlot.js';

// The swap's order (1.9.1): turn the door, build the new world, then dispose the old one —
// so no world is built against the previous item's pack, and a build that fails costs the
// room nothing.

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

  it('swaps: select, then build, then dispose the old world', () => {
    const { items, log } = slot();
    items.pick('johnny');
    items.pick('blank');
    items.pick('johnny');
    expect(log).toEqual(['select johnny', 'build 1', 'select blank', 'build 2', 'dispose 1', 'select johnny', 'build 3', 'dispose 2']);
    expect(items.current?.n).toBe(3);
  });

  it('keeps the world in the room when its own item is picked again — no teardown, no progress lost', () => {
    const { items, log } = slot();
    const world = items.pick('johnny');
    expect(items.pick('johnny')).toBe(world);
    expect(items.current).toBe(world);
    expect(log).toEqual(['select johnny', 'build 1']);
  });

  it('a pick whose build throws leaves the room as it was: the old world, the door turned back', () => {
    const selected: string[] = [];
    let fail = false;
    const disposed: string[] = [];
    const items = createItemSlot({
      select: (id) => selected.push(id),
      build: () => {
        if (fail) throw new Error('build broke');
        const name = selected.at(-1)!;
        return { name, dispose: () => disposed.push(name) };
      },
    });
    const world = items.pick('johnny');
    fail = true;
    expect(() => items.pick('blank')).toThrow('build broke');
    expect(items.current).toBe(world);
    expect(selected).toEqual(['johnny', 'blank', 'johnny']);
    expect(disposed).toEqual([]);
    // And the next pick swaps from it as usual.
    fail = false;
    items.pick('blank');
    expect(disposed).toEqual(['johnny']);
  });

  it('a first pick whose build throws leaves no world, and a later pick still builds', () => {
    let fail = true;
    const items = createItemSlot({
      select: () => {},
      build: () => {
        if (fail) throw new Error('build broke');
        return { dispose() {} };
      },
    });
    expect(() => items.pick('johnny')).toThrow('build broke');
    expect(items.current).toBeNull();
    fail = false;
    expect(items.pick('johnny')).toBe(items.current);
  });
});
