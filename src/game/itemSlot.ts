// The one item in the room (1.9.1): picking an item swaps the room to it, in-scene — the
// old item's world taken down, the door (src/game/item.ts) pointed at the new pack, the new
// world built from it, in that order. Pure: what a world is, and how the door turns, are
// the caller's (src/main.ts passes createItemWorld and setItem). One at a time for now;
// keeping an assembled item in the room later skips the dispose, nothing more.

/** `{ current, pick(id) }`: `current` is the world in the room, null until the first pick; `pick` swaps it. */
export function createItemSlot<World extends { dispose(): void }>({ select, build }: { select: (id: string) => void; build: () => World }) {
  let current: World | null = null;
  return {
    get current() {
      return current;
    },
    /** The room becomes item `id`: dispose the world in it, select `id`, build its world. */
    pick(id: string) {
      current?.dispose();
      current = null;
      select(id);
      current = build();
      return current;
    },
  };
}
