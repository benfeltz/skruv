// The catalog's contents (1.9.1): which pages it has, in order, and what each says. The
// game's front door is a second booklet — a cover, then a page per item — so this is a
// page list like the manual's (src/game/bookletModel.ts), extendable by adding page kinds.
// Pure: the pages are drawn by src/scene/catalogPages.ts and shown by the booklet sheet.
// Names and part counts come from each item's pack, never from here.

import { ITEM_IDS, itemById } from './item.js';

/** One item as the catalog lists it: its id (folder under items/), its name, and how many parts are in its box. */
export interface CatalogEntry {
  id: string;
  name: string;
  partCount: number;
}

/** One catalog page: the cover, or an item — buildable on this build, or sold out. */
export type CatalogPage = { kind: 'cover' } | ({ kind: 'item'; pickable: boolean } & CatalogEntry);

/** Every item the game carries, as the catalog lists it: name from the pack's identity, part count from its manifest (spares included — they are in the box). */
export function catalogEntries(): CatalogEntry[] {
  return ITEM_IDS.map((id) => {
    const { identity, manifest } = itemById(id);
    return { id, name: identity.product, partCount: manifest.length };
  });
}

/**
 * The pickable set from the build flag (CATALOG.pickable): a comma list of ids, or every one
 * of `ids` when it is empty. An id the game doesn't carry is a broken build flag and throws.
 */
export function pickableSet(flag: string, ids: readonly string[]): ReadonlySet<string> {
  const named = flag.split(',').map((id) => id.trim()).filter(Boolean);
  if (named.length === 0) return new Set(ids);
  const unknown = named.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`pickable names no item: ${unknown.join(', ')} (have: ${ids.join(', ')})`);
  return new Set(named);
}

/**
 * The catalog's pages: the cover first, then one page per entry — those `order` names in
 * its order, then any it leaves out in registry order — each marked pickable or not. An id
 * in `order` with no entry throws.
 */
export function createCatalog(entries: readonly CatalogEntry[], order: readonly string[], pickable: ReadonlySet<string>): CatalogPage[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const missing = order.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`catalog order names no item: ${missing.join(', ')}`);
  const ordered = [...order, ...entries.map(({ id }) => id).filter((id) => !order.includes(id))];
  return [{ kind: 'cover' }, ...ordered.map((id) => ({ kind: 'item' as const, ...byId.get(id)!, pickable: pickable.has(id) }))];
}
