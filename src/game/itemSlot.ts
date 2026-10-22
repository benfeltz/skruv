// The worlds in the room (1.9.1, kept by 1.9.9.2): picking an item adds its world beside the
// ones already there, or makes the one already there active again. Pure: what a world is, and
// the door it is built through, are the caller's (src/main.ts passes createItemWorld, and
// src/game/item.ts's ITEM_ID and setItem). A world is one item's build in the room; the room
// holds at most one per item, so there is never a second copy of a manual.
//
// The invariant, which every step below keeps:
//   The door names the active world's item. A kept world runs nothing that reads the pack.
//   The door is turned to a world before that world is activated, restored or disposed, and a
//   kept world has no listeners, no per-frame update and no visible UI until then. There is no
//   second record of "the active item" here — the slot reads the door.
//
// The active world is the last in `all()`; the others are kept, in the order they were left.
// A pick is one transaction, by which path it takes:
//   same:   the item is the active world's: nothing happens, the world is returned.
//   kept:   the item's world is in the room: the active world is deactivated while the door
//           still names it, the door turns, the kept world is activated and moves to the end.
//           Nothing is built, nothing disposed.
//   new:    the active world is deactivated while the door still names it, the door turns, the
//           new world is built through it and pushed.
// An id the door doesn't know is refused before anything is deactivated, so an impossible pick
// costs the room nothing. If the build throws, the door turns back to the item it named before,
// the previous world is activated again — the room is as it was, not empty — and the caller
// gets a BuildFailed (main keeps the catalog in hand and says the item couldn't be built).
// createItemWorld takes back its own half-built work.
//
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

/** What the slot needs of a world: its item, and the three things it does to it. */
export interface SlotWorld {
  id: string;
  /** Makes it the world with input, a strip and overlays. */
  activate(): void;
  /** Makes it kept: inert until activated again. */
  deactivate(): void;
  dispose(): void;
}

/**
 * `{ current, all(), pick(id), clear() }`: `current` is the active world, null until the first
 * pick; `all()` every world, kept first and the active one last (the order the room's save
 * writes and the restore reads); `pick` adds or re-activates as above; `clear()` disposes them all.
 */
export function createItemSlot<World extends SlotWorld>({
  door,
  build,
  report,
}: {
  door: ItemDoor;
  build: () => World;
  /** Where a failed teardown goes (main: the console); the rest are still disposed. */
  report: (error: unknown) => void;
}) {
  // In room order; the active world is last.
  const worlds: World[] = [];
  const active = () => worlds.at(-1) ?? null;

  // The kept world of `id` becomes the active one: the active world goes kept while the door
  // still names it, the door turns, the kept one is woken at the end of the room.
  function reactivate(kept: World) {
    active()?.deactivate();
    worlds.splice(worlds.indexOf(kept), 1);
    worlds.push(kept);
    door.select(kept.id);
    kept.activate();
    return kept;
  }

  // A new world joins the room; if its build throws the room is as it was.
  function add(id: string) {
    const before = door.selected();
    const previous = active();
    previous?.deactivate();
    door.select(id);
    try {
      const made = build();
      worlds.push(made);
      return made;
    } catch (error) {
      door.select(before);
      previous?.activate();
      throw new BuildFailed(id, error);
    }
  }

  return {
    get current() {
      return active();
    },
    /** Every world in the room, in order: the kept ones, then the active one. The room's saver reads this. */
    all(): World[] {
      return [...worlds];
    },
    /** Empties the room: each world is disposed with the door naming it (a teardown reads the pack it was built from); one that throws goes to `report`. The door ends on the last, which holds the invariant with no world. */
    clear() {
      for (const world of worlds.splice(0)) {
        door.select(world.id);
        try {
          world.dispose();
        } catch (error) {
          report(error);
        }
      }
    },
    pick(id: string) {
      const now = active();
      if (now && now.id === id) return now;
      if (!door.knows(id)) throw new Error(`pick: no item "${id}"`);
      const kept = worlds.find((world) => world.id === id);
      return kept ? reactivate(kept) : add(id);
    },
  };
}
