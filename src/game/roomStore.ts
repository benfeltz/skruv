// Where the room's save goes and when it is written (1.9.9.5). Pure: the storage, the clock
// and the timer are the caller's (src/main.ts passes localStorage, Date and setTimeout), so
// both halves test headlessly.
//
//   Store      — `read / write / clear` of one text: the seam. The web fills it with
//                localStorage (`createWebStore`); the native shell can fill it with
//                Preferences or the Filesystem later, as haptics' setBuzzer lets it plug a
//                buzzer. The format never changes for that.
//   RoomSaver  — `changed()` arms a debounce, `flush()` writes now. The saver knows nothing
//                of the bus: main decides which events are rest points.
//
// A save that cannot be written (quota, private mode) goes to `onError`; the game never dies
// for it. A null snapshot (an empty room) writes nothing: the store keeps whatever it had, so a
// save the restore refused survives until the next pick writes over it.

import { SAVE } from '../constants.js';
import { serialize } from './roomSave.js';
import type { RoomSave } from './roomSave.js';

export interface Store {
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `onError` default: the console. */
const toConsole = (error: unknown) => console.error('room save failed', error);

/** A Store over a `Storage`-shaped object under `key`; a write or clear that throws goes to `onError`. */
export function createWebStore(storage: StorageLike, key: string, onError: (error: unknown) => void = toConsole): Store {
  return {
    read: () => storage.getItem(key),
    write(text) {
      try {
        storage.setItem(key, text);
      } catch (error) {
        onError(error);
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch (error) {
        onError(error);
      }
    },
  };
}

/** A Store that lives and dies with the page: where localStorage is not to be had. */
export function createMemoryStore(): Store {
  let text: string | null = null;
  return {
    read: () => text,
    write: (next) => {
      text = next;
    },
    clear: () => {
      text = null;
    },
  };
}

export interface RoomSaverDeps {
  store: Store;
  /** The room as it stands, or null when there is nothing to save (no item in it); `savedAt` is the saver's to fill. */
  snapshot: () => RoomSave | null;
  /** The time as an ISO string. */
  now: () => string;
  /** `setTimeout`-shaped: runs `fn` after `ms`, returns the cancel. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** Where a failed snapshot goes. */
  onError?: (error: unknown) => void;
}

/** `{ changed, flush, dispose }`: `changed` (re)arms the debounce, `flush` writes now and cancels it, `dispose` cancels it. */
export function createRoomSaver({ store, snapshot, now, schedule, onError = toConsole }: RoomSaverDeps) {
  let cancel: (() => void) | null = null;

  const disarm = () => {
    cancel?.();
    cancel = null;
  };

  function write() {
    try {
      const save = snapshot();
      if (save) store.write(serialize({ ...save, savedAt: now() }));
    } catch (error) {
      onError(error);
    }
  }

  return {
    changed() {
      disarm();
      cancel = schedule(() => {
        cancel = null;
        write();
      }, SAVE.debounceMs);
    },
    flush() {
      disarm();
      write();
    },
    dispose: disarm,
  };
}
