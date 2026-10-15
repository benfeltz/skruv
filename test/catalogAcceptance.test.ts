import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, CATALOG } from '../src/constants.js';
import { createCatalog } from '../src/game/catalogModel.js';
import { STACK_SLOT } from '../src/game/cornerStack.js';
import { createItemSlot } from '../src/game/itemSlot.js';
import { pickableSet } from '../src/game/pickable.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { createCatalogSheet } from '../src/ui/catalogSheet.js';
import { entry } from './catalogFixtures.js';
import type { CatalogEntry } from '../src/game/catalogModel.js';

// Automated half of the 1.9.1 Catalog test plan (`Test Plan.md` beside the plan in the
// vault): the acceptance edges no single spec wires end to end. The real pickable hook, the
// real catalog sheet, the real item slot and a real manual sheet, on a minimal fake DOM. The
// world itself is a stand-in that mounts its manual as src/scene/itemWorld.ts does: the real
// world's teardown is covered by test/itemWorld.test.ts. Feel, fan look and render cost are
// manual.

type Listener = (event: object) => void;

class FakeElement {
  tag: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  style: Record<string, string> = {};
  hidden = false;
  disabled = false;
  inert = false;
  textContent = '';
  className = '';
  type = '';
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  setPointerCapture() {}
  focus() {}
  getContext() {
    return { drawImage() {} };
  }
  closest(tag: string): FakeElement | null {
    return this.tag === tag ? this : (this.parent?.closest(tag) ?? null);
  }
  // Bubbles from this element up through its parents, as a DOM event does.
  fire(type: string, init: object = {}) {
    this.bubble(type, { type, target: this, pointerId: 1, button: 0, clientX: 0, clientY: 0, timeStamp: 0, ...init });
  }
  bubble(type: string, event: object) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    this.parent?.bubble(type, event);
  }
}

let body: FakeElement;
beforeEach(() => {
  vi.useFakeTimers();
  const head = new FakeElement('head');
  body = new FakeElement('body');
  vi.stubGlobal('document', { head, body, createElement: (tag: string) => new FakeElement(tag), getElementById: () => null });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
});
const live: { dispose(): void }[] = [];
afterEach(() => {
  for (const sheet of live.splice(0)) sheet.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The epic's three items, as entries; the registry carries only JOHNNY so far.
const entries: CatalogEntry[] = [
  entry('johnny', 'JOHNNY', 61),
  entry('blank', 'BLANK', 9),
  entry('overkall', 'ÖVERKÄLL', 40),
];
const ids = entries.map(({ id }) => id);

type Sheet = { scrim: FakeElement; thumb: FakeElement; element: FakeElement; expanded: boolean; currentPage: number; dispose(): void; setOpen(v: boolean): void };

/** The boot as src/main.ts wires it: a slot, a catalog open on its cover that can't close until a pick. */
function boot({ flag, failBuild = new Set<string>() }: { flag: string; failBuild?: Set<string> }) {
  const pages = createCatalog(entries, pickableSet(flag, ids));
  let named = 'johnny';
  const manuals: Sheet[] = [];
  const items = createItemSlot({
    door: { knows: (id) => ids.includes(id), selected: () => named, select: (id) => (named = id) },
    report: (error) => {
      throw error;
    },
    build: () => {
      if (failBuild.has(named)) throw new Error(`build ${named} broke`);
      // The item world's manual, mounted docked as itemWorld.ts mounts it.
      const manual = createBookletSheet({ pages: { count: 3, canvas: () => ({}) as CanvasImageSource }, open: false }) as unknown as Sheet;
      body.append(manual.scrim, manual.thumb, manual.element);
      manuals.push(manual);
      live.push(manual);
      return { item: named, manual, dispose: () => manual.dispose() };
    },
  });
  const catalog = createCatalogSheet({
    pages: { count: pages.length, pages, canvas: () => ({}) as CanvasImageSource },
    open: true,
    canClose: () => items.current !== null,
    onPick: (id) => {
      items.pick(id);
      catalog.setOpen(false);
    },
  });
  const sheet = catalog as unknown as Sheet;
  body.append(sheet.scrim, sheet.thumb, sheet.element);
  live.push(sheet);
  const [, view, controls] = sheet.element.children;
  const buildIt = view.children[0].children[1];
  const notice = view.children[1];
  const turnTo = (page: number) => {
    while (sheet.currentPage < page) controls.children[2].fire('click');
    while (sheet.currentPage > page) controls.children[0].fire('click');
  };
  return { pages, items, catalog: sheet, buildIt, notice, turnTo, manuals, door: () => named };
}

describe('AC1: cold boot opens the catalog on its cover, the room empty (1.9.1)', () => {
  it('boot is the catalog, open on page 1, with no item world until a pick', () => {
    const { catalog, items } = boot({ flag: '' });
    expect(catalog.expanded).toBe(true);
    expect(catalog.currentPage).toBe(0);
    expect(items.current).toBeNull();
  });

  it('main builds no item world at boot: the only build is inside the slot, run by a pick', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main.match(/createItemWorld\(/g)).toHaveLength(1);
    expect(main).toMatch(/build: \(\) =>\s*createItemWorld\(/);
    expect(main).not.toMatch(/items\.pick\((?!id\))/);
  });
});

describe('AC2: BUILD IT goes straight into the room, both booklets docked (Ben, 1:50 PM)', () => {
  it('the catalog docks behind, the new manual docks in front, nothing opens', () => {
    const { catalog, buildIt, turnTo, items, manuals } = boot({ flag: '' });
    turnTo(1);
    buildIt.fire('click');
    expect(items.current).not.toBeNull();
    expect(catalog.expanded).toBe(false);
    expect(manuals).toHaveLength(1);
    expect(manuals[0].expanded).toBe(false);
    // Catalog behind, in the corner (turned); manual in front, fanned up and right toward the
    // room so the path to it never crosses the catalog (Ben's 1.9.1 test).
    expect(STACK_SLOT.catalog).toBeGreaterThan(STACK_SLOT.manual);
    expect(catalog.thumb.style.transform).toMatch(/^translate\(-?0px, -?0px\) rotate\(/);
    expect(manuals[0].thumb.style.transform).toMatch(/^translate\([1-9]\d*px, -[1-9]\d*px\)/);
  });
});

describe('AC3: selecting the catalog returns to picking; tap-outside before any pick is inert', () => {
  it('before a pick a room tap does nothing; after one, the catalog thumb reopens it and a room tap docks it', () => {
    const { catalog, buildIt, turnTo } = boot({ flag: '' });
    catalog.scrim.fire('pointerdown');
    catalog.scrim.fire('pointerup');
    expect(catalog.expanded).toBe(true);
    turnTo(1);
    buildIt.fire('click');
    catalog.thumb.fire('click');
    expect(catalog.expanded).toBe(true);
    catalog.scrim.fire('pointerdown', { pointerId: 2 });
    catalog.scrim.fire('pointerup', { pointerId: 2 });
    expect(catalog.expanded).toBe(false);
  });

  it('re-picking the item in the room keeps its world (and the player progress in it)', () => {
    const { catalog, buildIt, turnTo, items, manuals } = boot({ flag: '' });
    turnTo(1);
    buildIt.fire('click');
    const world = items.current;
    catalog.thumb.fire('click');
    buildIt.fire('click');
    expect(items.current).toBe(world);
    expect(manuals).toHaveLength(1);
  });

  it('picking another item swaps: the old manual goes, a new one docks in front', () => {
    const { catalog, buildIt, turnTo, items, manuals, door } = boot({ flag: '' });
    turnTo(1);
    buildIt.fire('click');
    catalog.thumb.fire('click');
    turnTo(2);
    buildIt.fire('click');
    expect(door()).toBe('blank');
    expect(manuals).toHaveLength(2);
    expect(body.children).not.toContain(manuals[0].thumb);
    expect(body.children).toContain(manuals[1].thumb);
    expect(items.current).not.toBeNull();
  });
});

describe('AC5: the pickable hook makes the rest SOLD OUT, inert (VITE_PICKABLE)', () => {
  it('VITE_PICKABLE=blank: only BLANK has BUILD IT; JOHNNY and ÖVERKÄLL are sold out and pick nothing', () => {
    const { pages, catalog, buildIt, turnTo, items } = boot({ flag: 'blank' });
    expect(pages.map((page) => page.kind === 'item' && page.pickable)).toEqual([false, false, true, false]);
    for (const page of [1, 3]) {
      turnTo(page);
      expect(buildIt.hidden, `page ${page}`).toBe(true);
      // A tap where the tag would be lands on the page: no pick, and still nothing to put it down into.
      catalog.element.children[1].fire('pointerdown');
      catalog.element.children[1].fire('pointerup');
      expect(items.current, `page ${page}`).toBeNull();
      expect(catalog.expanded, `page ${page}`).toBe(true);
    }
    turnTo(2);
    expect(buildIt.hidden).toBe(false);
    expect(buildIt.attributes['aria-label']).toBe('Build BLANK');
  });

  it('the tag and the stamp stand on the page margin, inside the page', () => {
    const [x, y, w, h] = CATALOG.page.action;
    const [pageW, pageH] = BOOKLET.pageSize;
    expect(y + h).toBe(pageH - BOOKLET.margin);
    expect(x).toBeGreaterThanOrEqual(BOOKLET.margin);
    expect(x + w).toBeLessThanOrEqual(pageW - BOOKLET.margin);
  });

  it('a flag naming no item is refused, never quietly empty', () => {
    expect(() => pickableSet('jonny', ids)).toThrow(/pickable names no item: jonny/);
  });
});

describe('a pick whose build fails (review rounds 3–6)', () => {
  it('the catalog stays open with the notice, the door names the item before, and nothing can put the catalog down', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { catalog, buildIt, notice, turnTo, items, door } = boot({ flag: '', failBuild: new Set(['blank']) });
    turnTo(2);
    buildIt.fire('click');
    expect(items.current).toBeNull();
    expect(door()).toBe('johnny');
    expect(catalog.expanded).toBe(true);
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(CATALOG.words.buildFailed);
    catalog.scrim.fire('pointerdown');
    catalog.scrim.fire('pointerup');
    expect(catalog.expanded).toBe(true);
    // Another pick still builds.
    turnTo(1);
    buildIt.fire('click');
    expect(items.current).not.toBeNull();
    expect(catalog.expanded).toBe(false);
  });
});
