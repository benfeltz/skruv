// The one item in the room (1.9.1): picking an item swaps the room to it, in-scene. Pure:
// what a world is, and the door it is built through, are the caller's (src/main.ts passes
// createItemWorld, and src/game/item.ts's ITEM_ID and setItem). One at a time for now (`all()` is the list that grows);
// keeping an assembled item in the room later skips the dispose, nothing more.
//
// The invariant, which every step below keeps:
//   The door names the current item; the world in the room, if there is one, was built
//   through the door for that item. There is no second record of "the current item" here —
//   the slot reads the door.
//
// So a swap is one transaction, in this order:
//   1. The old world is disposed while the door still names its item, so its teardown reads
//      the pack it was built from. From here on the room is empty.
//   2. The door turns to the new item.
//   3. The new world is built through it.
// An id the door doesn't know is refused before step 1, so an impossible pick costs the room
// nothing. A release that throws in step 1 is the old world's bug, not the pick's: it goes to
// `report` and the swap goes on — the world is gone either way, and the player gets the item
// they asked for. If step 3 throws, the door turns back to the item it named before, the room
// stays explicitly empty, and the caller gets a BuildFailed (main keeps the catalog in hand,
// since there is no room to put it down into; the catalog says the item couldn't be built).
// createItemWorld takes back its own half-built work.

/** A pick whose new world could not be built: the room is empty, the door named as before. `cause` is the build's error. */
export class BuildFailed extends Error {
  constructor(
    readonly id: string,
    cause: unknown,
  ) {
    super(`pick: building "${id}" failed`, { cause });
    this.name = 'BuildFailed';
  }
}

/** The item door the slot builds through: whether it knows an item, which it names now, and how to turn it. */
export interface ItemDoor {
  knows(id: string): boolean;
  selected(): string;
  select(id: string): void;
}

/**
 * `{ current, pick(id) }`: `current` is the world in the room, null until the first pick and
 * after a failed one; `pick` swaps it as above. Picking the item already in the room keeps
 * that world as it is — a look through the catalog never costs a half-built item its progress.
 */
export function createItemSlot<World extends { dispose(): void }>({
  door,
  build,
  report,
}: {
  door: ItemDoor;
  build: () => World;
  /** Where an old world's failed teardown goes (main: the console); the swap goes on. */
  report: (error: unknown) => void;
}) {
  let current: World | null = null;
  return {
    get current() {
      return current;
    },
    /** Every world in the room, in order: the one `current` holds, or none. The room's saver reads this; it is the list that grows when worlds are kept. */
    all(): World[] {
      return current ? [current] : [];
    },
    /** Empties the room: the world is disposed (a teardown that throws goes to `report`). The door stays as it is, which holds the invariant with no world. */
    clear() {
      const old = current;
      current = null;
      try {
        old?.dispose();
      } catch (error) {
        report(error);
      }
    },
    pick(id: string) {
      if (current && door.selected() === id) return current;
      if (!door.knows(id)) throw new Error(`pick: no item "${id}"`);
      const before = door.selected();
      const old = current;
      current = null;
      try {
        old?.dispose();
      } catch (error) {
        report(error);
      }
      door.select(id);
      try {
        current = build();
      } catch (error) {
        door.select(before);
        throw new BuildFailed(id, error);
      }
      return current;
    },
  };
}
