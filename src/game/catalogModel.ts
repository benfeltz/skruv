// The catalog's contents (1.9.1): which pages it has, in order, and what each says. The
// game's front door is a second booklet — a cover, then a page per item — so this is a
// page list like the manual's (src/game/bookletModel.ts), extendable by adding page kinds.
// Pure: the pages are drawn by src/scene/catalogPages.ts and shown by the booklet sheet.
// Names and part counts come from each item's pack, never from here.

import { extentOf } from './coverLayout.js';
import { ITEM_IDS, itemById } from './item.js';
import type { Variant } from './item.js';
import type { Size } from '../../tools/validate/lib/geometry.js';

/** An item's size in whole centimetres: width × depth × height. */
export type ItemSize = [number, number, number];

/**
 * One item as the catalog lists it: its id (folder under items/), its name, its category,
 * its colourways, its built size, and how many parts are in its box.
 */
export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  variants: Variant[];
  size: ItemSize;
  partCount: number;
}

const CM_PER_M = 100;

/**
 * The built item's size in whole centimetres, worked out from its parts' boxes as posed:
 * `[width, depth, height]` — the extent's x, z and y (the room's up is y, an item's front +z).
 */
export function itemSize(parts: Parameters<typeof extentOf>[0], sizeOf: (type: string) => Size): ItemSize {
  const { min, max } = extentOf(parts, sizeOf);
  const cm = (axis: number) => Math.round((max[axis] - min[axis]) * CM_PER_M);
  return [cm(0), cm(2), cm(1)];
}

/** One catalog page: the cover, or an item — buildable on this build, or sold out. */
export type CatalogPage = { kind: 'cover' } | ({ kind: 'item'; pickable: boolean } & CatalogEntry);

/** Every item the game carries, as the catalog lists it: name, category and variants from the pack's identity, size from the built item, part count from its manifest (spares included — they are in the box). */
export function catalogEntries(): CatalogEntry[] {
  return ITEM_IDS.map((id) => {
    const { identity, manifest, assembled, partTypes } = itemById(id);
    return {
      id,
      name: identity.product,
      category: identity.category,
      variants: identity.variants,
      size: itemSize(assembled.parts, (type) => partTypes[type].size),
      partCount: manifest.length,
    };
  });
}

/**
 * The catalog's pages: the cover first, then one page per entry in the entries' order — the
 * registry's (src/game/item.ts, the one module that names the items) — each marked pickable
 * or not.
 */
export function createCatalog(entries: readonly CatalogEntry[], pickable: ReadonlySet<string>): CatalogPage[] {
  return [{ kind: 'cover' }, ...entries.map((entry) => ({ kind: 'item' as const, ...entry, pickable: pickable.has(entry.id) }))];
}

/** An item page as the catalog shows it. */
export type ItemPage = Extract<CatalogPage, { kind: 'item' }>;

/** What BUILD IT on `page` builds: the item page itself when it is buildable, null anywhere else — the cover has no tag and a sold-out page's stamp is inert. */
export function buildTarget(page: CatalogPage): ItemPage | null {
  return page.kind === 'item' && page.pickable ? page : null;
}
