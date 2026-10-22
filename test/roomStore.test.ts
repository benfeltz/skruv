import { describe, expect, it } from 'vitest';
import { SAVE } from '../src/constants.js';
import { parse } from '../src/game/roomSave.js';
import type { RoomSave } from '../src/game/roomSave.js';
import { createMemoryStore, createRoomSaver, createWebStore } from '../src/game/roomStore.js';

// The store seam and the saver (1.9.9.5): what is written, and when, with the storage, the
// clock and the timer all fakes.

/** A `Storage`-shaped Map; `failWrites` makes setItem throw as a full quota does. */
function fakeStorage(failWrites = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
  };
}

const room: RoomSave = {
  format: 1,
  savedAt: '',
  world: { sky: { phase: 0.5 }, camera: { position: [1, 2, 3], target: [0, 0, 0] } },
  objects: [],
};

/** A scheduler that holds its timers until `run()`; `live` counts the ones not cancelled or run. */
function fakeScheduler() {
  const timers = new Set<() => void>();
  return {
    schedule: (fn: () => void) => {
      timers.add(fn);
      return () => void timers.delete(fn);
    },
    get live() {
      return timers.size;
    },
    run() {
      for (const fn of [...timers]) {
        timers.delete(fn);
        fn();
      }
    },
  };
}

describe('the web store', () => {
  it('reads null, writes, reads back, clears', () => {
    const storage = fakeStorage();
    const store = createWebStore(storage, 'k');
    expect(store.read()).toBeNull();
    store.write('hello');
    expect(store.read()).toBe('hello');
    expect(storage.map.get('k')).toBe('hello');
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('reports a setItem that throws, and does not throw', () => {
    const errors: unknown[] = [];
    const store = createWebStore(fakeStorage(true), 'k', (e) => errors.push(e));
    expect(() => store.write('x')).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe('the memory store', () => {
  it('holds a text until cleared', () => {
    const store = createMemoryStore();
    expect(store.read()).toBeNull();
    store.write('a');
    expect(store.read()).toBe('a');
    store.clear();
    expect(store.read()).toBeNull();
  });
});

describe('the saver', () => {
  function saver(snapshot: () => RoomSave | null = () => room) {
    const store = createMemoryStore();
    const writes: string[] = [];
    const counted = { ...store, write: (text: string) => (writes.push(text), store.write(text)) };
    const timers = fakeScheduler();
    const errors: unknown[] = [];
    const s = createRoomSaver({ store: counted, snapshot, now: () => '2026-10-21T19:12:00.000Z', schedule: timers.schedule, onError: (e) => errors.push(e) });
    return { s, store, writes, timers, errors };
  }

  it('makes one write of three changes inside the debounce window, stamped by now()', () => {
    const { s, store, writes, timers } = saver();
    s.changed();
    s.changed();
    s.changed();
    expect(timers.live).toBe(1);
    expect(writes).toHaveLength(0);
    timers.run();
    expect(writes).toHaveLength(1);
    expect(parse(store.read()!).save.savedAt).toBe('2026-10-21T19:12:00.000Z');
  });

  it('waits SAVE.debounceMs', () => {
    const delays: number[] = [];
    const s = createRoomSaver({ store: createMemoryStore(), snapshot: () => room, now: () => '', schedule: (_fn, ms) => (delays.push(ms), () => undefined) });
    s.changed();
    expect(delays).toEqual([SAVE.debounceMs]);
  });

  it('flush writes at once and cancels the pending write', () => {
    const { s, writes, timers } = saver();
    s.changed();
    s.flush();
    expect(writes).toHaveLength(1);
    expect(timers.live).toBe(0);
    timers.run();
    expect(writes).toHaveLength(1);
  });

  it('clears the store on a null snapshot', () => {
    let current: RoomSave | null = room;
    const { s, store } = saver(() => current);
    s.flush();
    expect(store.read()).not.toBeNull();
    current = null;
    s.flush();
    expect(store.read()).toBeNull();
  });

  it('reports a snapshot that throws, and does not throw', () => {
    const { s, errors } = saver(() => {
      throw new Error('boom');
    });
    expect(() => s.flush()).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('dispose leaves nothing pending', () => {
    const { s, writes, timers } = saver();
    s.changed();
    s.dispose();
    expect(timers.live).toBe(0);
    timers.run();
    expect(writes).toHaveLength(0);
  });
});
