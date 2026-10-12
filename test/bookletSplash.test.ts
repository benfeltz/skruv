import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET_UI, CATALOG, GESTURE } from '../src/constants.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { createCatalogSheet } from '../src/ui/catalogSheet.js';
import { BuildFailed } from '../src/game/itemSlot.js';
import type { CatalogPage } from '../src/game/catalogModel.js';

// The real booklet sheet (src/ui/booklet.ts), driven headlessly on a minimal fake DOM:
// it boots open on the cover, and whenever it is open a tap on the room puts it down and
// does nothing else; so does a tap on the sheet, while a swipe flips (1.6.2). How it feels
// on a phone is the manual plan.

type FakeEvent = { type: string; target: FakeElement; pointerId: number; button: number; clientX: number; clientY: number; timeStamp: number };
type Listener = (event: object) => void;

class FakeElement {
  tag: string;
  children: FakeElement[];
  parent: FakeElement | null;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  listeners: Map<string, Listener[]>;
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  captured: number[];
  style: Record<string, string>;
  inert = false;
  declare id?: string; // set by the sheet on its style element

  constructor(tag: string) {
    this.tag = tag;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.captured = [];
    this.style = {};
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
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  focus() {
    dom.focused = this;
  }
  getContext() {
    return { drawImage() {} };
  }
  closest(tag: string) {
    for (let node: FakeElement | null = this; node; node = node.parent) if (node.tag === tag) return node;
    return null;
  }
  // Bubbles from this element up through its parents, as a DOM event does.
  fire(type: string, init: Partial<FakeEvent> = {}) {
    const event: FakeEvent = { type, target: this, pointerId: 1, button: 0, clientX: 0, clientY: 0, timeStamp: 0, ...init };
    for (let node: FakeElement | null = this; node; node = node.parent) for (const fn of node.listeners.get(type) ?? []) fn(event);
  }
}

let dom: { head: FakeElement; body: FakeElement; focused: FakeElement | null; windowListeners: Map<string, Listener[]> };

beforeEach(() => {
  vi.useFakeTimers();
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const windowListeners = new Map<string, Listener[]>();
  dom = { head, body, focused: null, windowListeners };
  vi.stubGlobal('document', {
    head,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
  });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: Listener) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: Listener) => windowListeners.set(type, (windowListeners.get(type) ?? []).filter((f) => f !== fn)),
  });
});
// Every sheet a test mounts, disposed after it: the booklet module keeps one open at a time
// across all live sheets.
const mounted: { dispose(): void }[] = [];
afterEach(() => {
  for (const sheet of mounted.splice(0)) sheet.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const COUNT = 18;

// On the fake DOM, the sheet's three elements are FakeElements.
type FakeBooklet = Omit<ReturnType<typeof createBookletSheet>, 'scrim' | 'thumb' | 'element'> & { scrim: FakeElement; thumb: FakeElement; element: FakeElement };
type Sheet = ReturnType<typeof mount>;

// Mounted as main.js mounts it.
function mount() {
  // The fake context's drawImage ignores the canvas, so an empty stand-in will do.
  const booklet = createBookletSheet({ pages: { count: COUNT, canvas: () => ({}) as CanvasImageSource } }) as unknown as FakeBooklet;
  mounted.push(booklet);
  dom.body.append(booklet.scrim, booklet.thumb, booklet.element);
  const changes: { page: number; expanded: boolean }[] = [];
  booklet.onChange((change) => changes.push(change));
  const [handle, , controls] = booklet.element.children;
  const [prev, , next] = controls.children;
  const count = controls.children[1];
  const key = (k: string) => dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: k }));
  const scrimUp = () => dom.body.children.includes(booklet.scrim) && !booklet.scrim.hidden;
  return { booklet, changes, handle, prev, next, count, key, scrimUp };
}

// A tap on the room: pressed and lifted on the scrim.
const tapRoom = (scrim: FakeElement, pointerId = 1) => {
  scrim.fire('pointerdown', { pointerId });
  scrim.fire('pointerup', { pointerId });
};

describe('boot: the booklet in hand on its cover (1.6.1)', () => {
  it('boots open on page 1, the scrim up over the room, focus untouched', () => {
    const { booklet, count, scrimUp } = mount();
    expect(booklet.expanded).toBe(true);
    expect(booklet.currentPage).toBe(0);
    expect(booklet.element.dataset.open).toBe('true');
    expect(booklet.thumb.hidden).toBe(true);
    expect(count.textContent).toBe(`1 / ${COUNT}`);
    expect(scrimUp()).toBe(true);
    expect(dom.focused).toBe(null);
  });
});

describe('tap off to put it down — every time it is open (1.6.1)', () => {
  // Open at boot, and open again from the thumb after a first put-down.
  const openings: [string, (sheet: Sheet) => void][] = [
    ['at boot', () => {}],
    [
      'reopened from the thumb',
      ({ booklet }) => {
        tapRoom(booklet.scrim);
        vi.runAllTimers();
        booklet.thumb.fire('click');
      },
    ],
  ];

  it.each(openings)('puts the booklet down on one tap on the room, and only that (%s)', (_, open) => {
    const sheet = mount();
    open(sheet);
    const { booklet, changes } = sheet;
    const before = changes.length;
    dom.focused = null;
    tapRoom(booklet.scrim);
    expect(booklet.expanded).toBe(false);
    expect(booklet.element.dataset.open).toBe('false');
    expect(booklet.thumb.hidden).toBe(false);
    expect(changes.slice(before)).toEqual([{ page: 0, expanded: false }]);
    // A tap on the room is not a reason to move focus onto the thumb.
    expect(dom.focused).toBe(null);
  });

  it.each(openings)('keeps the scrim exactly scrimLingerMs after the lift, then drops it (%s)', (_, open) => {
    const sheet = mount();
    open(sheet);
    tapRoom(sheet.booklet.scrim);
    expect(sheet.scrimUp()).toBe(true);
    vi.advanceTimersByTime(BOOKLET_UI.scrimLingerMs - 1);
    expect(sheet.scrimUp()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(sheet.scrimUp()).toBe(false);
  });

  it('captures the pressed pointer, so a finger sliding onto the sheet still ends on the scrim', () => {
    const { booklet } = mount();
    booklet.scrim.fire('pointerdown', { pointerId: 7 });
    expect(booklet.scrim.captured).toEqual([7]);
  });

  it('ignores a lift whose press began elsewhere — a mouse pressed on the sheet, released off it', () => {
    const { booklet, scrimUp } = mount();
    booklet.scrim.fire('pointerup', { pointerId: 3 });
    expect(booklet.expanded).toBe(true);
    vi.runAllTimers();
    expect(scrimUp()).toBe(true);
  });

  it('ignores a lift after the press was cancelled', () => {
    const { booklet } = mount();
    booklet.scrim.fire('pointerdown', { pointerId: 4 });
    booklet.scrim.fire('pointercancel', { pointerId: 4 });
    booklet.scrim.fire('pointerup', { pointerId: 4 });
    expect(booklet.expanded).toBe(true);
  });

  it('puts the booklet down once for a two-finger tap', () => {
    const { booklet, changes } = mount();
    booklet.scrim.fire('pointerdown', { pointerId: 1 });
    booklet.scrim.fire('pointerdown', { pointerId: 2 });
    booklet.scrim.fire('pointerup', { pointerId: 1 });
    booklet.scrim.fire('pointerup', { pointerId: 2 });
    expect(booklet.expanded).toBe(false);
    expect(changes).toEqual([{ page: 0, expanded: false }]);
  });

  it('swallows a tap while the scrim lingers over the closed booklet, and does nothing with it', () => {
    const { booklet, changes } = mount();
    tapRoom(booklet.scrim);
    tapRoom(booklet.scrim, 2);
    expect(booklet.expanded).toBe(false);
    expect(changes).toEqual([{ page: 0, expanded: false }]);
  });

  it('reopened inside the linger: the scrim stays up past it, and the next tap off closes again', () => {
    const { booklet, scrimUp } = mount();
    tapRoom(booklet.scrim);
    // Keyboard: Enter on the thumb clicks it.
    booklet.thumb.fire('click');
    vi.runAllTimers();
    expect(booklet.expanded).toBe(true);
    expect(scrimUp()).toBe(true);
    tapRoom(booklet.scrim, 2);
    expect(booklet.expanded).toBe(false);
  });

  it.each<[string, (sheet: Sheet) => void]>([
    ['the handle', ({ handle }) => handle.fire('click')],
    ['Escape', ({ key }) => key('Escape')],
  ])('drops the scrim at once when closed by %s, focus back on the thumb', (_, close) => {
    const sheet = mount();
    close(sheet);
    expect(sheet.booklet.expanded).toBe(false);
    expect(sheet.scrimUp()).toBe(false);
    expect(dom.focused).toBe(sheet.booklet.thumb);
  });

  it('flips with the scrim up, the scrim staying', () => {
    const { booklet, next, key, count, scrimUp } = mount();
    next.fire('click');
    key('ArrowRight');
    expect(booklet.currentPage).toBe(2);
    expect(count.textContent).toBe(`3 / ${COUNT}`);
    expect(scrimUp()).toBe(true);
  });
});

describe('the rest of the booklet, unchanged (1.6.1)', () => {
  it('reopens from the thumb on the same page, flips, and closes by the handle', () => {
    const { booklet, handle, next, changes, scrimUp } = mount();
    tapRoom(booklet.scrim);
    vi.runAllTimers();
    booklet.thumb.fire('click');
    expect(booklet.expanded).toBe(true);
    expect(scrimUp()).toBe(true);
    expect(dom.focused).toBe(next);
    next.fire('click');
    handle.fire('click');
    expect(changes).toEqual([
      { page: 0, expanded: false },
      { page: 0, expanded: true },
      { page: 1, expanded: true },
      { page: 1, expanded: false },
    ]);
    expect(dom.focused).toBe(booklet.thumb);
    expect(scrimUp()).toBe(false);
  });

  it('swipes down to close and across to flip, as before', () => {
    const { booklet, scrimUp } = mount();
    const view = booklet.element.children[1];
    view.fire('pointerdown', { clientX: 100, clientY: 100 });
    view.fire('pointerup', { clientX: 100 - BOOKLET_UI.swipeDistance, clientY: 100 });
    expect(booklet.currentPage).toBe(1);
    view.fire('pointerdown', { clientX: 100, clientY: 100 });
    view.fire('pointerup', { clientX: 100, clientY: 100 + BOOKLET_UI.swipeDistance });
    expect(booklet.expanded).toBe(false);
    expect(scrimUp()).toBe(false);
  });
});

// A press and lift on `target`, `dx`/`dy` CSS px and `ms` apart.
const press = (target: FakeElement, { dx = 0, dy = 0, ms = 0, pointerId = 1, button = 0 }: { dx?: number; dy?: number; ms?: number; pointerId?: number; button?: number } = {}) => {
  target.fire('pointerdown', { pointerId, button, clientX: 100, clientY: 100, timeStamp: 1000 });
  target.fire('pointerup', { pointerId, button, clientX: 100 + dx, clientY: 100 + dy, timeStamp: 1000 + ms });
};

describe('tap the sheet to put it down, swipe to flip (1.6.2)', () => {
  const view = (booklet: FakeBooklet) => booklet.element.children[1];

  it.each<[string, (sheet: Sheet) => FakeElement]>([
    ['the page', ({ booklet }) => view(booklet)],
    ['the page count', ({ count }) => count],
    ['the controls row between the arrows', ({ booklet }) => booklet.element.children[2]],
    ['the sheet itself', ({ booklet }) => booklet.element],
  ])('one tap on %s puts the booklet down, like a tap on the room', (_, target) => {
    const sheet = mount();
    press(target(sheet));
    expect(sheet.booklet.expanded).toBe(false);
    expect(sheet.changes).toEqual([{ page: 0, expanded: false }]);
    // Treated as the room tap is: no focus move, the scrim lingering for the synthesised click.
    expect(dom.focused).toBe(null);
    expect(sheet.scrimUp()).toBe(true);
    vi.advanceTimersByTime(BOOKLET_UI.scrimLingerMs);
    expect(sheet.scrimUp()).toBe(false);
  });

  it('closes on the edge of both tap thresholds, and not one past either', () => {
    const edge = mount();
    press(view(edge.booklet), { dx: GESTURE.tapMaxDistance, ms: GESTURE.tapMaxMs });
    expect(edge.booklet.expanded).toBe(false);
    // One sheet open at a time: each is put away before the next is mounted.
    edge.booklet.dispose();
    const far = mount();
    press(view(far.booklet), { dx: GESTURE.tapMaxDistance + 1 });
    expect(far.booklet.expanded).toBe(true);
    far.booklet.dispose();
    const slow = mount();
    press(view(slow.booklet), { ms: GESTURE.tapMaxMs + 1 });
    expect(slow.booklet.expanded).toBe(true);
  });

  it('a swipe across flips and never closes, quick or slow', () => {
    const { booklet } = mount();
    press(view(booklet), { dx: -BOOKLET_UI.swipeDistance, ms: 100 });
    press(view(booklet), { dx: -BOOKLET_UI.swipeDistance, ms: 2000 });
    expect(booklet.currentPage).toBe(2);
    expect(booklet.expanded).toBe(true);
  });

  it('a short sloppy swipe past the tap distance does nothing at all', () => {
    const { booklet, changes } = mount();
    press(view(booklet), { dx: -(GESTURE.tapMaxDistance + 1), dy: 3 });
    expect(changes).toEqual([]);
  });

  it.each<[string, (sheet: Sheet) => FakeElement, number, boolean]>([
    ['next', ({ next }) => next, 1, true],
    ['prev, disabled on the cover', ({ prev }) => prev, 0, true],
    ['the handle', ({ handle }) => handle, 0, false],
  ])('a tap on %s keeps its own job and is not a sheet tap', (_, control, page, expanded) => {
    const sheet = mount();
    const target = control(sheet);
    press(target);
    if (!target.disabled) target.fire('click');
    expect(sheet.booklet.currentPage).toBe(page);
    expect(sheet.booklet.expanded).toBe(expanded);
  });

  it('ignores a right click, a cancelled press, and a lift with no press', () => {
    const { booklet } = mount();
    press(view(booklet), { button: 2 });
    view(booklet).fire('pointerdown', { pointerId: 5 });
    view(booklet).fire('pointercancel', { pointerId: 5 });
    view(booklet).fire('pointerup', { pointerId: 5 });
    booklet.element.fire('pointerup', { pointerId: 6 });
    expect(booklet.expanded).toBe(true);
  });

  it('reopened from the thumb, a tap on the sheet puts it down again', () => {
    const { booklet } = mount();
    press(view(booklet));
    vi.runAllTimers();
    booklet.thumb.fire('click');
    expect(booklet.expanded).toBe(true);
    press(view(booklet));
    expect(booklet.expanded).toBe(false);
  });
});

describe('tap to put down, from the 1.6.2 test plan', () => {
  const view = (booklet: FakeBooklet) => booklet.element.children[1];

  it('reopened after a tap on the sheet, it flips by swipe and by arrow, and taps down again', () => {
    const { booklet, next, count } = mount();
    press(view(booklet));
    vi.runAllTimers();
    booklet.thumb.fire('click');
    press(view(booklet), { dx: -BOOKLET_UI.swipeDistance });
    next.fire('click');
    expect(booklet.currentPage).toBe(2);
    expect(count.textContent).toBe(`3 / ${COUNT}`);
    expect(booklet.expanded).toBe(true);
    press(view(booklet));
    expect(booklet.expanded).toBe(false);
    expect(booklet.currentPage).toBe(2);
  });

  it('puts the booklet down once for a two-finger tap on the sheet', () => {
    const { booklet, changes } = mount();
    view(booklet).fire('pointerdown', { pointerId: 1 });
    view(booklet).fire('pointerdown', { pointerId: 2 });
    view(booklet).fire('pointerup', { pointerId: 1 });
    view(booklet).fire('pointerup', { pointerId: 2 });
    expect(changes).toEqual([{ page: 0, expanded: false }]);
  });

  it('a mouse pressed on the sheet and released over the scrim closes nothing', () => {
    const { booklet } = mount();
    view(booklet).fire('pointerdown', { pointerId: 1 });
    booklet.scrim.fire('pointerup', { pointerId: 1 });
    expect(booklet.expanded).toBe(true);
  });

  it('a tap on the sheet while it is down does nothing', () => {
    const { booklet, changes } = mount();
    press(view(booklet));
    press(view(booklet), { pointerId: 2 });
    expect(changes).toEqual([{ page: 0, expanded: false }]);
  });
});

// 1.9.1: the catalog is the splash — the same sheet, mounted as src/main.ts mounts it: open
// on its cover at boot, nothing putting it down until a pick has built a room, BUILD IT laid
// over a buildable item's tag only.
describe('boot with the catalog up (1.9.1)', () => {
  const catalogPages: CatalogPage[] = [
    { kind: 'cover' },
    { kind: 'item', id: 'johnny', name: 'JOHNNY', partCount: 60, pickable: false },
    { kind: 'item', id: 'blank', name: 'BLANK', partCount: 9, pickable: true },
  ];

  function mountCatalog() {
    let room = false;
    const picks: string[] = [];
    const catalog = createCatalogSheet({
      pages: { count: catalogPages.length, pages: catalogPages, canvas: () => ({}) as CanvasImageSource },
      open: true,
      canClose: () => room,
      onPick: (id) => {
        picks.push(id);
        room = true;
        catalog.setOpen(false);
      },
    }) as unknown as FakeBooklet;
    mounted.push(catalog);
    dom.body.append(catalog.scrim, catalog.thumb, catalog.element);
    const [handle, view, controls] = catalog.element.children;
    const [, buildIt] = view.children[0].children;
    const next = controls.children[2];
    const key = (k: string) => dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: k }));
    return { catalog, handle, view, buildIt, next, key, picks };
  }

  it('boots open on its cover, with no BUILD IT on the cover', () => {
    const { catalog, buildIt } = mountCatalog();
    expect(catalog.expanded).toBe(true);
    expect(catalog.currentPage).toBe(0);
    expect(buildIt.hidden).toBe(true);
  });

  it('before any pick, nothing puts it down: the room, the sheet, the handle, Escape, a swipe', () => {
    const { catalog, handle, view, key } = mountCatalog();
    tapRoom(catalog.scrim);
    press(view);
    handle.fire('click');
    key('Escape');
    press(view, { dy: BOOKLET_UI.swipeDistance });
    expect(catalog.expanded).toBe(true);
  });

  it('a sold-out page has no BUILD IT, and tapping its stamp builds nothing', () => {
    const { catalog, buildIt, next, view, picks } = mountCatalog();
    next.fire('click');
    expect(catalog.currentPage).toBe(1);
    expect(buildIt.hidden).toBe(true);
    press(view);
    expect(picks).toEqual([]);
    expect(catalog.expanded).toBe(true);
  });

  it('BUILD IT on a buildable page picks it and goes straight into the room, the catalog docked', () => {
    const { catalog, buildIt, next, picks } = mountCatalog();
    next.fire('click');
    next.fire('click');
    expect(buildIt.hidden).toBe(false);
    expect(buildIt.attributes['aria-label']).toBe('Build BLANK');
    // A press on the tag is the tag's: no sheet tap, no swipe.
    press(buildIt);
    expect(catalog.expanded).toBe(true);
    buildIt.fire('click');
    expect(picks).toEqual(['blank']);
    expect(catalog.expanded).toBe(false);
    expect(catalog.thumb.hidden).toBe(false);
  });

  it('after a pick it is a booklet like any other: reopened from the stack, a tap off puts it down', () => {
    const { catalog, buildIt, next } = mountCatalog();
    next.fire('click');
    next.fire('click');
    buildIt.fire('click');
    catalog.thumb.fire('click');
    expect(catalog.expanded).toBe(true);
    tapRoom(catalog.scrim);
    expect(catalog.expanded).toBe(false);
  });

  it('sits behind the manual in the corner stack, fanned up', () => {
    const { catalog } = mountCatalog();
    expect(catalog.thumb.style.transform).toMatch(/^translate\(\d+px, -\d+px\) rotate\(-?[\d.]+rad\)$/);
    const manual = mount();
    expect(manual.booklet.thumb.style.transform).toBeUndefined();
  });

  it('one sheet open at a time: under an open sheet the other thumb is inert, and opening it does nothing', () => {
    const { catalog, buildIt, next } = mountCatalog();
    next.fire('click');
    next.fire('click');
    buildIt.fire('click');
    // The item's manual, mounted after the pick as the item world mounts it: docked.
    const manual = createBookletSheet({ pages: { count: COUNT, canvas: () => ({}) as CanvasImageSource }, open: false }) as unknown as FakeBooklet;
    mounted.push(manual);
    expect(manual.thumb.inert).toBe(false);
    catalog.thumb.fire('click');
    expect(catalog.expanded).toBe(true);
    expect(manual.thumb.inert).toBe(true);
    // A click reaching the manual's thumb anyway (Enter on it) opens nothing.
    manual.thumb.fire('click');
    expect(manual.expanded).toBe(false);
    // Escape closes the one that is open, and the thumbs come back.
    dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: 'Escape' }));
    expect(catalog.expanded).toBe(false);
    expect(manual.expanded).toBe(false);
    expect(manual.thumb.inert).toBe(false);
    expect(catalog.thumb.inert).toBe(false);
  });

  it("rounds BUILD IT's corners as the drawn tag's, in shares of the button", () => {
    const { buildIt } = mountCatalog();
    const [, , w, h] = CATALOG.page.action;
    expect(buildIt.style.borderRadius).toBe(`${(100 * CATALOG.page.tagRadius) / w}% / ${(100 * CATALOG.page.tagRadius) / h}%`);
  });

  it('a pick that fails keeps the catalog open, says so, and a later pick still works', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const picks: string[] = [];
    const catalog = createCatalogSheet({
      pages: { count: catalogPages.length, pages: catalogPages, canvas: () => ({}) as CanvasImageSource },
      open: true,
      canClose: () => picks.length > 0,
      onPick: (id) => {
        if (fail) throw new BuildFailed(id, new Error('build broke'));
        picks.push(id);
        catalog.setOpen(false);
      },
    }) as unknown as FakeBooklet;
    mounted.push(catalog);
    const [, view, controls, notice] = catalog.element.children;
    const [, buildIt] = view.children[0].children;
    const next = controls.children[2];
    expect(notice.hidden).toBe(true);
    next.fire('click');
    next.fire('click');
    expect(() => buildIt.fire('click')).not.toThrow();
    expect(catalog.expanded).toBe(true);
    expect(notice.hidden).toBe(false);
    expect(notice.attributes.role).toBe('alert');
    expect(notice.textContent).toBe(CATALOG.words.buildFailed);
    expect(errors).toHaveBeenCalledOnce();
    // Flipping away clears it; the next try builds.
    controls.children[0].fire('click');
    expect(notice.hidden).toBe(true);
    next.fire('click');
    fail = false;
    buildIt.fire('click');
    expect(picks).toEqual(['blank']);
    expect(catalog.expanded).toBe(false);
  });

  it('an error that is not a failed build is logged, never put to the player as one', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const catalog = createCatalogSheet({
      pages: { count: catalogPages.length, pages: catalogPages, canvas: () => ({}) as CanvasImageSource },
      open: true,
      onPick: () => {
        // Built fine; something after it (putting the catalog down, focus) threw.
        throw new Error('focus broke');
      },
    }) as unknown as FakeBooklet;
    mounted.push(catalog);
    const [, view, controls, notice] = catalog.element.children;
    const [, buildIt] = view.children[0].children;
    controls.children[2].fire('click');
    controls.children[2].fire('click');
    buildIt.fire('click');
    expect(notice.hidden).toBe(true);
    expect(errors).toHaveBeenCalledOnce();
  });
});

