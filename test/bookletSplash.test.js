import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET_UI, GESTURE } from '../src/constants.js';
import { createBookletSheet } from '../src/ui/booklet.js';

// The real booklet sheet (src/ui/booklet.js), driven headlessly on a minimal fake DOM:
// it boots open on the cover, and whenever it is open a tap on the room puts it down and
// does nothing else; so does a tap on the sheet, while a swipe flips (1.6.2). How it feels
// on a phone is the manual plan.

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
  closest(tag) {
    for (let node = this; node; node = node.parent) if (node.tag === tag) return node;
    return null;
  }
  // Bubbles from this element up through its parents, as a DOM event does.
  fire(type, init = {}) {
    const event = { type, target: this, pointerId: 1, button: 0, clientX: 0, clientY: 0, timeStamp: 0, ...init };
    for (let node = this; node; node = node.parent) for (const fn of node.listeners.get(type) ?? []) fn(event);
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
  const scrimUp = () => dom.body.children.includes(booklet.scrim) && !booklet.scrim.hidden;
  return { booklet, changes, handle, prev, next, count, key, scrimUp };
}

// A tap on the room: pressed and lifted on the scrim.
const tapRoom = (scrim, pointerId = 1) => {
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
  const openings = [
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

  it.each([
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
const press = (target, { dx = 0, dy = 0, ms = 0, pointerId = 1, button = 0 } = {}) => {
  target.fire('pointerdown', { pointerId, button, clientX: 100, clientY: 100, timeStamp: 1000 });
  target.fire('pointerup', { pointerId, button, clientX: 100 + dx, clientY: 100 + dy, timeStamp: 1000 + ms });
};

describe('tap the sheet to put it down, swipe to flip (1.6.2)', () => {
  const view = (booklet) => booklet.element.children[1];

  it.each([
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
    const far = mount();
    press(view(far.booklet), { dx: GESTURE.tapMaxDistance + 1 });
    expect(far.booklet.expanded).toBe(true);
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

  it.each([
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
