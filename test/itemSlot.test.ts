import { describe, expect, it } from 'vitest';
import { createItemSlot } from '../src/game/itemSlot.js';

// The swap as one transaction (1.9.1), specced against its invariant: the door names the
// current item, and the world in the room — if any — was built through the door for that
// item. Every case checks the invariant after the pick, whichever way the pick went.

/** A fake door and a world factory that remember what the door named at build and dispose. */
function room({ failBuild = new Set<string>(), failDispose = new Set<string>(), boot = 'johnny' } = {}) {
  let named = boot;
  const log: string[] = [];
  const door = {
    selected: () => named,
    select: (id: string) => {
      if (id === 'nope') throw new Error(`no item "${id}"`);
      named = id;
      log.push(`select ${id}`);
    },
  };
  const items = createItemSlot({
    door,
    build: () => {
      const item = named;
      if (failBuild.has(item)) throw new Error(`build ${item} broke`);
      log.push(`build ${item}`);
      return {
        item,
        dispose: () => {
          // What the door names while this world is torn down: always its own item.
          log.push(`dispose ${item} (door: ${named})`);
          if (failDispose.has(item)) throw new Error(`dispose ${item} broke`);
        },
      };
    },
  });
  // The invariant: a world in the room is the door's item's.
  const holds = () => items.current === null || items.current.item === door.selected();
  return { items, door, log, holds };
}

describe('createItemSlot', () => {
  it('holds no world until the first pick', () => {
    const { items, holds } = room();
    expect(items.current).toBeNull();
    expect(holds()).toBe(true);
  });

  it('a first pick turns the door and builds through it', () => {
    const { items, log, holds } = room();
    const world = items.pick('blank');
    expect(items.current).toBe(world);
    expect(log).toEqual(['select blank', 'build blank']);
    expect(holds()).toBe(true);
  });

  it('a swap disposes the old world while the door still names it, then turns, then builds', () => {
    const { items, log, holds } = room();
    items.pick('johnny');
    items.pick('blank');
    expect(log).toEqual(['select johnny', 'build johnny', 'dispose johnny (door: johnny)', 'select blank', 'build blank']);
    expect(holds()).toBe(true);
  });

  it('keeps the world in the room when its own item is picked again — no teardown, no progress lost', () => {
    const { items, log, holds } = room();
    const world = items.pick('johnny');
    expect(items.pick('johnny')).toBe(world);
    expect(log).toEqual(['select johnny', 'build johnny']);
    expect(holds()).toBe(true);
  });

  it('a swap whose build throws turns the door back and leaves the room explicitly empty', () => {
    const { items, door, log, holds } = room({ failBuild: new Set(['blank']) });
    items.pick('johnny');
    expect(() => items.pick('blank')).toThrow('build blank broke');
    expect(items.current).toBeNull();
    expect(door.selected()).toBe('johnny');
    expect(log).toEqual(['select johnny', 'build johnny', 'dispose johnny (door: johnny)', 'select blank', 'select johnny']);
    expect(holds()).toBe(true);
  });

  it('a first pick whose build throws turns the door back to the boot item', () => {
    const { items, door, holds } = room({ failBuild: new Set(['blank']) });
    expect(() => items.pick('blank')).toThrow('build blank broke');
    expect(items.current).toBeNull();
    expect(door.selected()).toBe('johnny');
    expect(holds()).toBe(true);
  });

  it('from an empty room after a failure, the next pick builds — the failed item included, once it can', () => {
    const fail = new Set(['blank']);
    const { items, holds } = room({ failBuild: fail });
    items.pick('johnny');
    expect(() => items.pick('blank')).toThrow();
    // The door names johnny but nothing is in the room: picking johnny builds it afresh.
    expect(items.pick('johnny')).toBe(items.current);
    expect(items.current?.item).toBe('johnny');
    fail.clear();
    items.pick('blank');
    expect(items.current?.item).toBe('blank');
    expect(holds()).toBe(true);
  });

  it('a dispose that throws leaves an empty room with the door unturned, and builds nothing', () => {
    const { items, door, log, holds } = room({ failDispose: new Set(['johnny']) });
    items.pick('johnny');
    expect(() => items.pick('blank')).toThrow('dispose johnny broke');
    expect(items.current).toBeNull();
    expect(door.selected()).toBe('johnny');
    expect(log.at(-1)).toBe('dispose johnny (door: johnny)');
    expect(holds()).toBe(true);
  });

  it('an id the door refuses leaves an empty room with the door unturned', () => {
    const { items, door, holds } = room();
    items.pick('johnny');
    expect(() => items.pick('nope')).toThrow('no item');
    expect(items.current).toBeNull();
    expect(door.selected()).toBe('johnny');
    expect(holds()).toBe(true);
  });
});
