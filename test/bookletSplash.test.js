import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET_UI } from '../src/constants.js';
import { createBookletSheet } from '../src/ui/booklet.js';

// The real booklet sheet (src/ui/booklet.js), driven headlessly on a minimal fake DOM:
// the boot splash — open on the cover, the first tap on the room puts it down and nothing
// else — and an ordinary booklet from then on. How it feels on a phone is the manual plan.

class FakeElement {
  constructor(tag) {
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
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  append(...nodes) {
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
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  setPointerCapture(id) {
    this.captured.push(id);
  }
  focus() {
    dom.focused = this;
  }
  getContext() {
    return { drawImage() {} };
  }
  fire(type, init = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, pointerId: 1, clientX: 0, clientY: 0, ...init });
  }
}

let dom;

beforeEach(() => {
  vi.useFakeTimers();
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const windowListeners = new Map();
  dom = { head, body, focused: null, windowListeners };
  vi.stubGlobal('document', {
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => head.children.find((node) => node.id === id) ?? null,
  });
  vi.stubGlobal('window', {
    addEventListener: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const COUNT = 18;

// Mounted as main.js mounts it.
function mount() {
  const booklet = createBookletSheet({ pages: { count: COUNT, canvas: () => ({}) } });
  dom.body.append(booklet.scrim, booklet.thumb, booklet.element);
  const changes = [];
  booklet.onChange((change) => changes.push(change));
  const [handle, , controls] = booklet.element.children;
  const [prev, , next] = controls.children;
  const count = controls.children[1];
  const key = (k) => dom.windowListeners.get('keydown').forEach((fn) => fn({ key: k }));
  const mounted = () => dom.body.children.includes(booklet.scrim);
  return { booklet, changes, handle, prev, next, count, key, mounted };
}

// A tap on the room: pressed and lifted on the scrim.
const tapRoom = (scrim, pointerId = 1) => {
  scrim.fire('pointerdown', { pointerId });
  scrim.fire('pointerup', { pointerId });
};

describe('boot splash: the booklet in hand on its cover (1.6.1)', () => {
  it('boots open on page 1, the scrim over the room, the sheet over the scrim, focus untouched', () => {
    const { booklet, count, mounted } = mount();
    expect(booklet.expanded).toBe(true);
    expect(booklet.currentPage).toBe(0);
    expect(booklet.element.dataset.open).toBe('true');
    expect(booklet.element.dataset.splash).toBe('true');
    expect(booklet.thumb.hidden).toBe(true);
    expect(count.textContent).toBe(`1 / ${COUNT}`);
    expect(mounted()).toBe(true);
    expect(dom.focused).toBe(null);
  });

  it('puts the booklet down on one tap on the room, and only that', () => {
    const { booklet, changes } = mount();
    tapRoom(booklet.scrim);
    expect(booklet.expanded).toBe(false);
    expect(booklet.currentPage).toBe(0);
    expect(booklet.element.dataset.open).toBe('false');
    expect(booklet.element.dataset.splash).toBeUndefined();
    expect(booklet.thumb.hidden).toBe(false);
    expect(changes).toEqual([{ page: 0, expanded: false }]);
    // A tap on the room is not a reason to move focus onto the thumb.
    expect(dom.focused).toBe(null);
  });

  it('captures the pressed pointer, so a finger sliding onto the sheet still ends on the scrim', () => {
    const { booklet } = mount();
    booklet.scrim.fire('pointerdown', { pointerId: 7 });
    expect(booklet.scrim.captured).toEqual([7]);
  });

  it('keeps the scrim for splashLingerMs after the lift, to catch the synthesised click', () => {
    const { booklet, mounted } = mount();
    tapRoom(booklet.scrim);
    expect(mounted()).toBe(true);
    vi.advanceTimersByTime(BOOKLET_UI.splashLingerMs - 1);
    expect(mounted()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(mounted()).toBe(false);
  });

  it('ignores a lift whose press began elsewhere — a mouse pressed on the sheet, released off it', () => {
    const { booklet, mounted } = mount();
    booklet.scrim.fire('pointerup', { pointerId: 3 });
    expect(booklet.expanded).toBe(true);
    expect(booklet.element.dataset.splash).toBe('true');
    vi.runAllTimers();
    expect(mounted()).toBe(true);
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

  it.each([
    ['the handle', ({ handle }) => handle.fire('click')],
    ['Escape', ({ key }) => key('Escape')],
  ])('ends the splash at once when closed by %s, focus back on the thumb', (_, close) => {
    const sheet = mount();
    close(sheet);
    expect(sheet.booklet.expanded).toBe(false);
    expect(sheet.booklet.element.dataset.splash).toBeUndefined();
    expect(sheet.mounted()).toBe(false);
    expect(dom.focused).toBe(sheet.booklet.thumb);
  });

  it('flips during the splash like any open booklet, and the splash survives it', () => {
    const { booklet, next, key, count } = mount();
    next.fire('click');
    key('ArrowRight');
    expect(booklet.currentPage).toBe(2);
    expect(count.textContent).toBe(`3 / ${COUNT}`);
    expect(booklet.element.dataset.splash).toBe('true');
  });
});

describe('after the splash: an ordinary booklet (1.6.1)', () => {
  it('reopens from the thumb on the same page, flips, and closes — with no splash again', () => {
    const { booklet, handle, next, changes, mounted } = mount();
    tapRoom(booklet.scrim);
    vi.runAllTimers();
    booklet.thumb.fire('click');
    expect(booklet.expanded).toBe(true);
    expect(booklet.element.dataset.splash).toBeUndefined();
    expect(mounted()).toBe(false);
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
  });

  it('swipes down to close and across to flip, as before', () => {
    const { booklet } = mount();
    tapRoom(booklet.scrim);
    booklet.thumb.fire('click');
    const view = booklet.element.children[1];
    view.fire('pointerdown', { clientX: 100, clientY: 100 });
    view.fire('pointerup', { clientX: 100 - BOOKLET_UI.swipeDistance, clientY: 100 });
    expect(booklet.currentPage).toBe(1);
    view.fire('pointerdown', { clientX: 100, clientY: 100 });
    view.fire('pointerup', { clientX: 100, clientY: 100 + BOOKLET_UI.swipeDistance });
    expect(booklet.expanded).toBe(false);
  });

  it('closes only the splash: a tap still swallowed by the lingering scrim never closes a reopened booklet', () => {
    const { booklet, changes, mounted } = mount();
    tapRoom(booklet.scrim);
    // Reopened inside the linger (keyboard: Enter on the thumb clicks it), then a second
    // tap on the room while the scrim is still up.
    booklet.thumb.fire('click');
    expect(mounted()).toBe(true);
    tapRoom(booklet.scrim, 2);
    expect(booklet.expanded).toBe(true);
    expect(changes.at(-1)).toEqual({ page: 0, expanded: true });
  });
});
