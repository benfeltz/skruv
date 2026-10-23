import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, CATALOG } from '../src/constants.js';
import { createCatalog } from '../src/game/catalogModel.js';
import { createItemSlot } from '../src/game/itemSlot.js';
import { pickableSet } from '../src/game/pickable.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { createCatalogSheet } from '../src/ui/catalogSheet.js';
import { createManualFan } from '../src/ui/manualFan.js';
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
  tabIndex = 0;
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
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  setPointerCapture() {}
  // The page look measures its thumb; a fake has no layout.
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
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
  vi.stubGlobal('document', { head, body, addEventListener() {}, removeEventListener() {}, documentElement: { style: { setProperty() {}, removeProperty() {} }, dataset: {} }, createElement: (tag: string) => new FakeElement(tag), getElementById: () => null });
  vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844, addEventListener() {}, removeEventListener() {} });
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

type Sheet = { scrim: FakeElement; thumb: FakeElement; element: FakeElement; expanded: boolean; currentPage: number; dispose(): void; setOpen(v: boolean): void; setShown(v: boolean): void };

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
      const manual = createBookletSheet({ pages: { count: 3, canvas: () => ({}) as CanvasImageSource }, open: false, docked: 'strip', blocking: false }) as unknown as Sheet;
      body.append(manual.thumb, manual.element);
      manuals.push(manual);
      live.push(manual);
      const id = named;
      return { id, manual, cover: () => ({ cover: id }) as unknown as CanvasImageSource, activate: () => manual.setShown(true), deactivate: () => manual.setShown(false), dispose: () => manual.dispose() };
    },
  });
  const catalog: ReturnType<typeof createCatalogSheet> = createCatalogSheet({
    pages: { count: pages.length, pages, canvas: () => ({}) as CanvasImageSource },
    open: true,
    canClose: () => items.current !== null,
    onPick: (id) => pickItem(id),
  });
  const sheet = catalog as unknown as Sheet;
  body.append(sheet.scrim, sheet.thumb, sheet.element);
  live.push(sheet);
  // The manual fan as main wires it: one pick for the catalog and the fan, the fan refreshed after it.
  const fan = createManualFan({ worlds: () => items.all(), nameOf: (id) => id.toUpperCase(), onPick: (id) => pickItem(id) });
  body.append(fan.element as unknown as FakeElement);
  live.push(fan);
  function pickItem(id: string) {
    items.pick(id);
    catalog.setOpen(false);
    fan.refresh();
  }
  catalog.onChange(({ expanded }) => {
    if (expanded) fan.fold();
  });
  const [, view] = sheet.element.children;
  // The page's frame: the canvas, BUILD IT, then the ‹ and › laid over the printed corners.
  const [, buildIt, prev, next] = view.children[0].children;
  const notice = view.children[1];
  const turnTo = (page: number) => {
    while (sheet.currentPage < page) next.fire('click');
    while (sheet.currentPage > page) prev.fire('click');
  };
  return { pages, items, catalog: sheet, buildIt, notice, turnTo, manuals, fan, door: () => named };
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
    expect(main).toMatch(/build: \(\) => \{[^}]*const world = createItemWorld\(/);
    expect(main).not.toMatch(/items\.pick\((?!id\)|record\.id\))/);
  });
});

describe('AC2: BUILD IT goes straight into the room, both booklets docked (Ben, 1:50 PM)', () => {
  it('the catalog docks upper left, the new manual docks as the strip along the bottom, nothing opens', () => {
    const { catalog, buildIt, turnTo, items, manuals } = boot({ flag: '' });
    turnTo(1);
    buildIt.fire('click');
    expect(items.current).not.toBeNull();
    expect(catalog.expanded).toBe(false);
    expect(manuals).toHaveLength(1);
    expect(manuals[0].expanded).toBe(false);
    // Each in a place of its own: the catalog upper left, the manual the strip, no corner.
    expect(catalog.thumb.dataset.corner).toBe('topLeft');
    expect(manuals[0].thumb.className).toBe('booklet-strip');
    expect(manuals[0].thumb.dataset.corner).toBeUndefined();
    expect(manuals[0].scrim).toBeNull();
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

  it('picking another item keeps the first world: its manual is put away, a new one docks in front', () => {
    const { catalog, buildIt, turnTo, items, manuals, door } = boot({ flag: '' });
    turnTo(1);
    buildIt.fire('click');
    catalog.thumb.fire('click');
    turnTo(2);
    buildIt.fire('click');
    expect(door()).toBe('blank');
    expect(manuals).toHaveLength(2);
    expect(items.all()).toHaveLength(2);
    expect(manuals[0].thumb.hidden).toBe(true);
    expect(body.children).toContain(manuals[0].thumb);
    expect(body.children).toContain(manuals[1].thumb);
    expect(manuals[1].thumb.hidden).toBe(false);
  });

  it('picking an item whose world is in the room builds nothing: one manual per item', () => {
    const { catalog, buildIt, turnTo, items, manuals, door } = boot({ flag: '' });
    turnTo(1);
    buildIt.fire('click');
    catalog.thumb.fire('click');
    turnTo(2);
    buildIt.fire('click');
    catalog.thumb.fire('click');
    turnTo(1);
    buildIt.fire('click');
    expect(door()).toBe('johnny');
    expect(manuals).toHaveLength(2);
    expect(items.all()).toHaveLength(2);
    expect(manuals[0].thumb.hidden).toBe(false);
    expect(manuals[1].thumb.hidden).toBe(true);
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

describe('AC6: the manuals are the switcher (1.9.9.3)', () => {
  /** JOHNNY then BLANK built from the catalog, as a player does. */
  function twoBuilt() {
    const rig = boot({ flag: '' });
    rig.turnTo(1);
    rig.buildIt.fire('click');
    rig.catalog.thumb.fire('click');
    rig.turnTo(2);
    rig.buildIt.fire('click');
    const covers = () => (rig.fan.element as unknown as FakeElement).children[0].children;
    // A tap, as the fan reads one: down and up on a cover.
    const tap = (target: FakeElement) => {
      target.fire('pointerdown', { clientX: 5, clientY: 5 });
      target.fire('pointerup', { clientX: 5, clientY: 5, timeStamp: 40 });
    };
    return { ...rig, covers, tap };
  }

  it('one cover appears, the kept JOHNNY\'s, and the catalog thumb stays its own', () => {
    const { covers, catalog, fan } = twoBuilt();
    expect(fan.element.hidden).toBe(false);
    expect(covers().map((c) => c.dataset.id)).toEqual(['johnny']);
    expect(catalog.thumb.dataset.corner).toBe('topLeft');
  });

  it('is absent while one world is in the room', () => {
    const rig = boot({ flag: '' });
    rig.turnTo(1);
    rig.buildIt.fire('click');
    expect(rig.fan.element.hidden).toBe(true);
  });

  it('a tap on the stack then on JOHNNY\'s cover makes JOHNNY active, builds nothing, and leaves BLANK\'s cover in the fan', () => {
    const { covers, tap, door, items, manuals, fan } = twoBuilt();
    tap(covers()[0]);
    expect(fan.expanded).toBe(true);
    tap(covers()[0]);
    expect(door()).toBe('johnny');
    expect(items.current?.id).toBe('johnny');
    expect(manuals[0].thumb.hidden).toBe(false);
    expect(manuals[1].thumb.hidden).toBe(true);
    expect(items.all()).toHaveLength(2);
    expect(manuals).toHaveLength(2);
    expect(fan.expanded).toBe(false);
    expect(covers().map((c) => c.dataset.id)).toEqual(['blank']);
  });

  it('opening the catalog folds a spread fan', () => {
    const { covers, tap, fan, catalog } = twoBuilt();
    tap(covers()[0]);
    expect(fan.expanded).toBe(true);
    catalog.thumb.fire('click');
    expect(fan.expanded).toBe(false);
  });
});
