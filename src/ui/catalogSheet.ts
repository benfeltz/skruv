import { CATALOG } from '../constants.js';
import { buildTarget } from '../game/catalogModel.js';
import { STACK_SLOT } from '../game/cornerStack.js';
import { BuildFailed } from '../game/itemSlot.js';
import { createBookletSheet } from './booklet.js';
import type { CatalogPage } from '../game/catalogModel.js';

/**
 * The catalog in hand: a second booklet sheet (src/ui/booklet.ts) over `pages`
 * (src/scene/catalogPages.ts), behind the manual in the corner stack, with BUILD IT laid over
 * every buildable item's tag — `onPick(id)` when tapped; a sold-out stamp is inert
 * (src/game/catalogModel.ts `buildTarget`). A pick whose item couldn't be built (a
 * BuildFailed, src/game/itemSlot.ts) leaves the catalog open with CATALOG.words.buildFailed
 * on it — the room behind is empty then, so the catalog is the only place left to try again.
 * Any error from a pick goes to the console; only that one is put to the player as a failed
 * build.
 * `open` and `canClose` are the sheet's own.
 */
export function createCatalogSheet({
  pages,
  onPick,
  open = false,
  canClose,
}: {
  pages: { count: number; pages: readonly CatalogPage[]; canvas(index: number): CanvasImageSource };
  onPick: (id: string) => void;
  open?: boolean;
  canClose?: () => boolean;
}) {
  const sheet = createBookletSheet({
    pages,
    name: 'catalog',
    open,
    slot: STACK_SLOT.catalog,
    // Docked, it shows its cover — SKRUV — whatever page it was put down on (Ben, 1.9.1).
    thumbShows: 'cover',
    canClose,
    action: {
      rect: CATALOG.page.action,
      radius: CATALOG.page.tagRadius,
      at: (index) => {
        const item = buildTarget(pages.pages[index]);
        return item && { label: `Build ${item.name}`, run: () => pick(item.id) };
      },
    },
  });

  function pick(id: string) {
    try {
      onPick(id);
    } catch (error) {
      if (error instanceof BuildFailed) sheet.notify(CATALOG.words.buildFailed);
      console.error(error);
    }
  }

  return sheet;
}
