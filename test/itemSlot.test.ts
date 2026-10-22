import { describe, expect, it } from 'vitest';
import { BuildFailed, createItemSlot } from '../src/game/itemSlot.js';

// The swap as one transaction (1.9.1), specced against its invariant: the door names the
// current item, and the world in the room — if any — was built through the door for that
// item. Every case checks the invariant after the pick, whichever way the pick went.

/** A fake door and a world factory that remember what the door named at build and dispose. */
function room({ failBuild = new Set<string>(), failDispose = new Set<string>(), boot = 'johnny' } = {}) {
  let named = boot;
  const log: string[] = [];
  const reported: unknown[] = [];
  const door = {
    knows: (id: string) => id !== 'nope',
    selected: () => named,
    select: (id: string) => {
      if (id === 'nope') throw new Error(`no item "${id}"`);
      named = id;
      log.push(`select ${id}`);
    },
  };
  const items = createItemSlot({
    door,
    report: (error) => reported.push(error),
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
  return { items, door, log, holds, reported };
}

describe('createItemSlot', () => {
  it('lists the worlds in the room: none, then the one, then none after a failed pick (1.9.9.5)', () => {
    const fail = new Set<string>();
    const { items } = room({ failBuild: fail });
    expect(items.all()).toEqual([]);
    const world = items.pick('johnny');
    expect(items.all()).toEqual([world]);
    expect(items.pick('johnny')).toBe(world);
    expect(items.all()).toEqual([world]);
    fail.add('blank');
    expect(() => items.pick('blank')).toThrow(BuildFailed);
    expect(items.all()).toEqual([]);
  });

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
    expect(() => items.pick('blank')).toThrow(BuildFailed);
    expect(items.current).toBeNull();
    expect(door.selected()).toBe('johnny');
    expect(log).toEqual(['select johnny', 'build johnny', 'dispose johnny (door: johnny)', 'select blank', 'select johnny']);
    expect(holds()).toBe(true);
  });

  it('a first pick whose build throws turns the door back to the boot item, as a BuildFailed carrying the cause', () => {
    const { items, door, holds } = room({ failBuild: new Set(['blank']) });
    let caught: unknown;
    try {
      items.pick('blank');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BuildFailed);
    expect((caught as BuildFailed).id).toBe('blank');
    expect(((caught as BuildFailed).cause as Error).message).toBe('build blank broke');
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

  it("a dispose that throws is reported, not fatal: the swap goes on and the new item is built", () => {
    const { items, door, log, holds, reported } = room({ failDispose: new Set(['johnny']) });
    items.pick('johnny');
    const world = items.pick('blank');
    expect(items.current).toBe(world);
    expect(door.selected()).toBe('blank');
    expect(log).toEqual(['select johnny', 'build johnny', 'dispose johnny (door: johnny)', 'select blank', 'build blank']);
    expect((reported as Error[]).map((error) => error.message)).toEqual(['dispose johnny broke']);
    expect(holds()).toBe(true);
  });

  it('an id the door does not know is refused before anything is torn down: the room and its progress stay', () => {
    const { items, door, log, holds } = room();
    const world = items.pick('johnny');
    expect(() => items.pick('nope')).toThrow('no item "nope"');
    expect(items.current).toBe(world);
    expect(door.selected()).toBe('johnny');
    expect(log).toEqual(['select johnny', 'build johnny']);
    expect(holds()).toBe(true);
  });
});
