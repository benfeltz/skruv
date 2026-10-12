// The one item in the room (1.9.1): picking an item swaps the room to it, in-scene. Pure:
// what a world is, and the door it is built through, are the caller's (src/main.ts passes
// createItemWorld, and src/game/item.ts's ITEM_ID and setItem). One at a time for now;
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
// nothing. If step 3 throws, the door turns back to the item it named before, and the room stays
// explicitly empty: no world, and the caller sees the error (main keeps the catalog in hand,
// since there is no room to put it down into). createItemWorld takes back its own
// half-built work. If step 1 throws, the room is already empty and the door never turned.

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
export function createItemSlot<World extends { dispose(): void }>({ door, build }: { door: ItemDoor; build: () => World }) {
  let current: World | null = null;
  return {
    get current() {
      return current;
    },
    pick(id: string) {
      if (current && door.selected() === id) return current;
      if (!door.knows(id)) throw new Error(`pick: no item "${id}"`);
      const before = door.selected();
      const old = current;
      current = null;
      old?.dispose();
      door.select(id);
      try {
        current = build();
      } catch (error) {
        door.select(before);
        throw error;
      }
      return current;
    },
  };
}
