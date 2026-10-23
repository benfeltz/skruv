import { describe, expect, it } from 'vitest';
import { BuildFailed, createItemSlot } from '../src/game/itemSlot.js';

// The pick as one transaction (1.9.1, kept by 1.9.9.2), specced against its invariant: the door
// names the active world's item, and a world is activated, deactivated and disposed only with
// the door turned to it. Every case checks the invariant after the pick, whichever way it went.

/** A fake door and a world factory that remember what the door named at each call a world gets. */
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
      const id = named;
      if (failBuild.has(id)) throw new Error(`build ${id} broke`);
      log.push(`build ${id}`);
      return {
        id,
        activate: () => void log.push(`activate ${id} (door: ${named})`),
        deactivate: () => void log.push(`deactivate ${id} (door: ${named})`),
        dispose: () => {
          // What the door names while this world is torn down: always its own item.
          log.push(`dispose ${id} (door: ${named})`);
          if (failDispose.has(id)) throw new Error(`dispose ${id} broke`);
        },
      };
    },
  });
  // The invariant: the active world is the door's item's.
  const holds = () => items.current === null || items.current.id === door.selected();
  return { items, door, log, holds, reported };
}

describe('createItemSlot', () => {
  it('holds no world until the first pick', () => {
    const { items, holds } = room();
    expect(items.current).toBeNull();
    expect(items.all()).toEqual([]);
    expect(holds()).toBe(true);
  });

  it('a first pick turns the door and builds through it, the world active', () => {
    const { items, log, holds } = room();
    const world = items.pick('blank');
    expect(items.current).toBe(world);
    expect(items.all()).toEqual([world]);
    expect(log).toEqual(['select blank', 'build blank']);
    expect(holds()).toBe(true);
  });

  it('a pick of another item deactivates the active world while the door names it, turns, builds; nothing is disposed', () => {
    const { items, log, holds } = room();
    const first = items.pick('johnny');
    const second = items.pick('blank');
    expect(log).toEqual(['select johnny', 'build johnny', 'deactivate johnny (door: johnny)', 'select blank', 'build blank']);
    expect(items.all()).toEqual([first, second]);
    expect(items.current).toBe(second);
    expect(holds()).toBe(true);
  });

  it('picking the first again re-activates it at the end of the room: no build, the second kept', () => {
    const { items, log, holds } = room();
    const first = items.pick('johnny');
    const second = items.pick('blank');
    log.length = 0;
    expect(items.pick('johnny')).toBe(first);
    expect(log).toEqual(['deactivate blank (door: blank)', 'select johnny', 'activate johnny (door: johnny)']);
    expect(items.all()).toEqual([second, first]);
    expect(items.current).toBe(first);
    expect(holds()).toBe(true);
  });

  it('picking the active item does nothing at all and returns it', () => {
    const { items, log, holds } = room();
    const world = items.pick('johnny');
    log.length = 0;
    expect(items.pick('johnny')).toBe(world);
    expect(log).toEqual([]);
    expect(items.all()).toEqual([world]);
    expect(holds()).toBe(true);
  });

  it('never holds two worlds of one item', () => {
    const { items } = room();
    items.pick('johnny');
    items.pick('blank');
    items.pick('johnny');
    items.pick('blank');
    expect(items.all().map((world) => world.id).sort()).toEqual(['blank', 'johnny']);
  });

  it('a build that throws turns the door back and activates the previous world again — the room is as it was', () => {
    const { items, door, log, holds } = room({ failBuild: new Set(['blank']) });
    const world = items.pick('johnny');
    expect(() => items.pick('blank')).toThrow(BuildFailed);
    expect(items.current).toBe(world);
    expect(items.all()).toEqual([world]);
    expect(door.selected()).toBe('johnny');
    expect(log).toEqual(['select johnny', 'build johnny', 'deactivate johnny (door: johnny)', 'select blank', 'select johnny', 'activate johnny (door: johnny)']);
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
    expect(items.all()).toEqual([]);
    expect(door.selected()).toBe('johnny');
    expect(holds()).toBe(true);
  });

  it('after a failed build the next pick builds — the failed item included, once it can', () => {
    const fail = new Set(['blank']);
    const { items, holds } = room({ failBuild: fail });
    items.pick('johnny');
    expect(() => items.pick('blank')).toThrow();
    fail.clear();
    items.pick('blank');
    expect(items.current?.id).toBe('blank');
    expect(items.all().map((world) => world.id)).toEqual(['johnny', 'blank']);
    expect(holds()).toBe(true);
  });

  it('an id the door does not know is refused before anything is deactivated: the room stays', () => {
    const { items, door, log, holds } = room();
    const world = items.pick('johnny');
    expect(() => items.pick('nope')).toThrow('no item "nope"');
    expect(items.current).toBe(world);
    expect(door.selected()).toBe('johnny');
    expect(log).toEqual(['select johnny', 'build johnny']);
    expect(holds()).toBe(true);
  });
});

describe('clear()', () => {
  it('disposes every world with the door naming it, and empties the slot', () => {
    const { items, log, door } = room();
    items.pick('johnny');
    items.pick('blank');
    log.length = 0;
    items.clear();
    expect(log.filter((line) => line.startsWith('dispose'))).toEqual(['dispose johnny (door: johnny)', 'dispose blank (door: blank)']);
    expect(items.current).toBeNull();
    expect(items.all()).toEqual([]);
    // The door ends on the last one disposed.
    expect(door.selected()).toBe('blank');
  });

  it('on an empty slot does nothing', () => {
    const { items, log, reported } = room();
    items.clear();
    expect(log).toEqual([]);
    expect(reported).toEqual([]);
  });

  it('reports a dispose that throws and still disposes the rest', () => {
    const { items, log, reported } = room({ failDispose: new Set(['johnny']) });
    items.pick('johnny');
    items.pick('blank');
    log.length = 0;
    expect(() => items.clear()).not.toThrow();
    expect((reported as Error[]).map((error) => error.message)).toEqual(['dispose johnny broke']);
    expect(log).toContain('dispose blank (door: blank)');
    expect(items.all()).toEqual([]);
  });
});
