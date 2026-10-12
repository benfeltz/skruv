import { CATALOG } from '../constants.js';
import { buildTarget } from '../game/catalogModel.js';
import { STACK_SLOT } from '../game/cornerStack.js';
import { createBookletSheet } from './booklet.js';
import type { CatalogPage } from '../game/catalogModel.js';

/**
 * The catalog in hand: a second booklet sheet (src/ui/booklet.ts) over `pages`
 * (src/scene/catalogPages.ts), behind the manual in the corner stack, with BUILD IT laid over
 * every buildable item's tag — `onPick(id)` when tapped; a sold-out stamp is inert
 * (src/game/catalogModel.ts `buildTarget`). A pick that throws leaves the catalog open with
 * CATALOG.words.buildFailed on it — the room behind is empty then (src/game/itemSlot.ts), so
 * the catalog is the only place left to try again — and the error goes to the console.
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
      sheet.notify(CATALOG.words.buildFailed);
      console.error(error);
    }
  }

  return sheet;
}
