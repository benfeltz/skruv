// The one item in the room (1.9.1): picking an item swaps the room to it, in-scene — the
// old item's world taken down, the door (src/game/item.ts) pointed at the new pack, the new
// world built from it, in that order. Pure: what a world is, and how the door turns, are
// the caller's (src/main.ts passes createItemWorld and setItem). One at a time for now;
// keeping an assembled item in the room later skips the dispose, nothing more.

/**
 * `{ current, pick(id) }`: `current` is the world in the room, null until the first pick;
 * `pick` swaps it. Picking the item already in the room keeps that world as it is — a look
 * through the catalog never costs a half-built item its progress.
 */
export function createItemSlot<World extends { dispose(): void }>({ select, build }: { select: (id: string) => void; build: () => World }) {
  let current: { id: string; world: World } | null = null;
  return {
    get current() {
      return current?.world ?? null;
    },
    /** The room becomes item `id`: unless it already is, dispose the world in it, select `id`, build its world. */
    pick(id: string) {
      if (current?.id === id) return current.world;
      current?.world.dispose();
      current = null;
      select(id);
      current = { id, world: build() };
      return current.world;
    },
  };
}
