// The one item in the room (1.9.1): picking an item swaps the room to it, in-scene — the
// door (src/game/item.ts) pointed at the new pack, the new world built from it, and only
// then the old world taken down. A build that throws leaves the room exactly as it was: the
// door turned back, the old world untouched (createItemWorld takes back its own half-built
// work). Pure: what a world is, and how the door turns, are the caller's (src/main.ts passes
// createItemWorld and setItem). One at a time for now; keeping an assembled item in the
// room later skips the dispose, nothing more.

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
    /**
     * The room becomes item `id`, unless it already is: select `id`, build its world, then
     * dispose the old one. If the build throws, the previous item is selected again, its
     * world stays, and the error goes on to the caller.
     */
    pick(id: string) {
      if (current?.id === id) return current.world;
      const previous = current;
      select(id);
      let world: World;
      try {
        world = build();
      } catch (error) {
        if (previous) select(previous.id);
        throw error;
      }
      previous?.world.dispose();
      current = { id, world };
      return world;
    },
  };
}
