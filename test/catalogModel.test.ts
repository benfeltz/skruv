import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/constants.js';
import { catalogEntries, createCatalog, itemSize } from '../src/game/catalogModel.js';
import { extentOf } from '../src/game/coverLayout.js';
import { entry } from './catalogFixtures.js';
import { pickableSet } from '../src/game/pickable.js';
import { ITEM_IDS, itemById } from '../src/game/item.js';

// The catalog as data (1.9.1): a cover, then a page per item, each buildable or sold out by
// the build's pickable flag. Pure — drawn by src/scene/catalogPages.ts.

// A fixture of three items: the counts are the fixture's own, not the registry's (those are pinned below).
const three = [entry('johnny', 'JOHNNY', 60), entry('blank', 'BLANK', 9), entry('overkall', 'ÖVERKÄLL', 40)];
const ids = three.map(({ id }) => id);

describe('catalogEntries', () => {
  it("lists every registry item by its pack's name and box contents", () => {
    expect(catalogEntries().map(({ id, name, partCount }) => ({ id, name, partCount }))).toEqual(
      ITEM_IDS.map((id) => ({ id, name: itemById(id).identity.product, partCount: itemById(id).manifest.length })),
    );
    expect(catalogEntries()[0]).toMatchObject({ id: 'johnny', name: 'JOHNNY' });
  });

  it('carries BLANK second, ÖVERKÄLL third and SÖMNLÖS fourth, JOHNNY staying first — the order the catalog pages and the pre-splash count follow', () => {
    expect([...ITEM_IDS]).toEqual(['johnny', 'blank', 'overkall', 'somnlos']);
    expect(catalogEntries()[1]).toMatchObject({ id: 'blank', name: 'BLANK', partCount: 10 });
    expect(catalogEntries()[2]).toMatchObject({ id: 'overkall', name: 'ÖVERKÄLL', partCount: 75 });
    expect(catalogEntries()[3]).toMatchObject({ id: 'somnlos', name: 'SÖMNLÖS', partCount: 67 });
  });
});

describe('the entries carry category, variants and the built size', () => {
  it("takes category and variants from the pack's identity", () => {
    for (const { id, category, variants } of catalogEntries()) {
      const { identity } = itemById(id);
      expect([category, variants]).toEqual([identity.category, identity.variants]);
      expect(variants).toHaveLength(2);
    }
  });

  it("sizes each item as its built extent, width × depth × height in whole cm — from the pack's boxes, never a pack field", () => {
    for (const { id, size } of catalogEntries()) {
      const { assembled, partTypes } = itemById(id);
      const { min, max } = extentOf(assembled.parts, (type) => partTypes[type].size);
      expect(size).toEqual([0, 2, 1].map((axis) => Math.round((max[axis] - min[axis]) * 100)));
      expect(size.every(Number.isInteger)).toBe(true);
    }
  });

  // The retired description said "about 80 × 28 × 202"; the built extent's depth rounds to 29.
  it('measures JOHNNY at 80 × 29 × 202 cm', () => {
    expect(catalogEntries()[0].size).toEqual([80, 29, 202]);
  });
});

describe('itemSize', () => {
  it('reads x, z, y of the posed boxes as width, depth, height in rounded cm', () => {
    const sizes: Record<string, [number, number, number]> = { slab: [0.4, 0.1, 0.2], post: [0.1, 0.5, 0.1] };
    const at = (type: string, position: [number, number, number]) => ({ type, position, rotation: [0, 0, 0, 1] });
    // The slab spans x −0.2…0.2, y 0…0.1, z −0.1…0.1; the post stands on it at x 0.25, rising to 0.6.
    expect(itemSize([at('slab', [0, 0.05, 0]), at('post', [0.25, 0.35, 0.025])], (type) => sizes[type])).toEqual([50, 20, 60]);
  });
});

describe('createCatalog', () => {
  it('opens on the cover, then one page per item in the entries\' (registry) order', () => {
    const pages = createCatalog(three, new Set(ids));
    expect(pages[0]).toEqual({ kind: 'cover' });
    expect(pages.slice(1).map((page) => page.kind === 'item' && page.id)).toEqual(['johnny', 'blank', 'overkall']);
    expect(pages[1]).toEqual({ kind: 'item', ...three[0], pickable: true });
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
