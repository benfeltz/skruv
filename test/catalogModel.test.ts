import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/constants.js';
import { catalogEntries, createCatalog } from '../src/game/catalogModel.js';
import { pickableSet } from '../src/game/pickable.js';
import { ITEM_IDS, itemById } from '../src/game/item.js';

// The catalog as data (1.9.1): a cover, then a page per item, each buildable or sold out by
// the build's pickable flag. Pure — drawn by src/scene/catalogPages.ts.

// Three items, as the epic will carry them; the registry carries JOHNNY and BLANK so far.
const three = [
  { id: 'johnny', name: 'JOHNNY', partCount: 60 },
  { id: 'blank', name: 'BLANK', partCount: 9 },
  { id: 'overkall', name: 'ÖVERKÄLL', partCount: 40 },
];
const ids = three.map(({ id }) => id);

describe('catalogEntries', () => {
  it("lists every registry item by its pack's name and box contents", () => {
    expect(catalogEntries()).toEqual(
      ITEM_IDS.map((id) => ({ id, name: itemById(id).identity.product, partCount: itemById(id).manifest.length })),
    );
    expect(catalogEntries()[0]).toMatchObject({ id: 'johnny', name: 'JOHNNY' });
  });

  it('carries BLANK second, JOHNNY staying first — the order the catalog pages and the pre-splash count follow', () => {
    expect([...ITEM_IDS]).toEqual(['johnny', 'blank']);
    expect(catalogEntries()[1]).toMatchObject({ id: 'blank', name: 'BLANK', partCount: 10 });
  });
});

describe('createCatalog', () => {
  it('opens on the cover, then one page per item in the entries\' (registry) order', () => {
    const pages = createCatalog(three, new Set(ids));
    expect(pages[0]).toEqual({ kind: 'cover' });
    expect(pages.slice(1).map((page) => page.kind === 'item' && page.id)).toEqual(['johnny', 'blank', 'overkall']);
    expect(pages[1]).toEqual({ kind: 'item', id: 'johnny', name: 'JOHNNY', partCount: 60, pickable: true });
  });

  it('marks each page pickable by the set, the rest sold out', () => {
    const pages = createCatalog(three, new Set(['blank']));
    expect(pages.flatMap((page) => (page.kind === 'item' ? [[page.id, page.pickable]] : []))).toEqual([
      ['johnny', false],
      ['blank', true],
      ['overkall', false],
    ]);
  });

  it("is the game's own catalog with CATALOG's order and flag: every carried item, all buildable by default", () => {
    const pages = createCatalog(catalogEntries(), pickableSet(CATALOG.pickable, ITEM_IDS));
    expect(pages.length).toBe(1 + ITEM_IDS.length);
    expect(pages.every((page) => page.kind === 'cover' || page.pickable)).toBe(true);
  });
});

describe('the registry and the items/ folders', () => {
  // vite.config.ts checks VITE_PICKABLE against the folders that hold a pack, not the
  // registry: the two must name the same items.
  it('carries exactly the items that have a pack folder', () => {
    const root = new URL('../items/', import.meta.url);
    const folders = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/flatpack.json`, root)))
      .map((entry) => entry.name);
    expect([...ITEM_IDS].sort()).toEqual(folders.sort());
  });
});

describe('pickableSet (the VITE_PICKABLE build flag)', () => {
  it('is every item when the flag is empty', () => {
    expect(pickableSet('', ids)).toEqual(new Set(ids));
    expect(pickableSet(' , ', ids)).toEqual(new Set(ids));
  });

  it('narrows to the ids it names, spaces forgiven — the web build names BLANK alone', () => {
    expect(pickableSet('blank', ids)).toEqual(new Set(['blank']));
    expect(pickableSet(' johnny , overkall ', ids)).toEqual(new Set(['johnny', 'overkall']));
  });

  it('throws on an id the game does not carry — a typo in the flag is a broken build', () => {
    expect(() => pickableSet('blnak', ids)).toThrow(/pickable names no item: blnak/);
  });
});
