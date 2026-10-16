import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET_UI, GESTURE } from '../src/constants.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.1.2: the manual docked as a carousel strip along the bottom, opened without blocking
// the room. Driven headlessly on the fake DOM; how the swipe, the hold and the strip's size
// feel on a phone is the manual plan.

let dom: FakeDom;
const mounted: { dispose(): void }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom();
});
afterEach(() => {
  for (const sheet of mounted.splice(0)) sheet.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const COUNT = 10;
type FakeSheet<Scrim> = Omit<ReturnType<typeof createBookletSheet>, 'scrim' | 'thumb' | 'element'> & { scrim: Scrim; thumb: FakeElement; element: FakeElement };

function mountStrip(options: { page?: number; viewport?: number } = {}) {
  if (options.viewport) dom.viewport.width = options.viewport;
  const manual = createBookletSheet({
    pages: { count: COUNT, canvas: (index) => ({ index }) as unknown as CanvasImageSource },
    docked: 'strip',
    blocking: false,
    open: false,
  }) as unknown as FakeSheet<null>;
  mounted.push(manual);
  dom.body.append(manual.thumb, manual.element);
  const changes: { page: number; expanded: boolean }[] = [];
  manual.onChange((change) => changes.push(change));
  const [prev, box, next] = manual.thumb.children;
  const slots = () => box.children;
  const view = manual.element.children[1];
  for (let i = 0; i < (options.page ?? 0); i++) next.fire('click');
  changes.length = 0;
  return { manual, prev, next, slots, centre: () => slots()[Math.floor(slots().length / 2)], view, changes };
}

// What each slot shows: a page number, or null for an empty slot.
const shown = (slots: FakeElement[]) => slots.map((slot) => (slot.dataset.empty === 'true' ? null : (slot.children[0].drawn as { index: number }).index));

const down = (target: FakeElement, init: { pointerType?: string; x?: number; y?: number; pointerId?: number } = {}) =>
  target.fire('pointerdown', { pointerType: init.pointerType ?? 'mouse', clientX: init.x ?? 100, clientY: init.y ?? 100, pointerId: init.pointerId ?? 1, timeStamp: 1000 });
const up = (target: FakeElement, init: { pointerType?: string; x?: number; y?: number; pointerId?: number; ms?: number } = {}) =>
  target.fire('pointerup', { pointerType: init.pointerType ?? 'mouse', clientX: init.x ?? 100, clientY: init.y ?? 100, pointerId: init.pointerId ?? 1, timeStamp: 1000 + (init.ms ?? 0) });
const touchDown = (target: FakeElement, x = 100, y = 100) => down(target, { pointerType: 'touch', x, y });
const touchUp = (target: FakeElement, x = 100, y = 100) => up(target, { pointerType: 'touch', x, y });

describe('what the strip shows', () => {
  it('is three pages on a phone, the centre current, empty past the cover', () => {
    const { slots } = mountStrip({ viewport: 390 });
    expect(slots()).toHaveLength(3);
    expect(shown(slots())).toEqual([null, 0, 1]);
  });

  it('is five pages on a desktop', () => {
    const { slots } = mountStrip({ viewport: 1280 });
    expect(slots()).toHaveLength(5);
    expect(shown(slots())).toEqual([null, null, 0, 1, 2]);
  });

  it('puts the current page in the middle, with its neighbours either side, and empty slots past the last', () => {
    const { slots, manual } = mountStrip({ viewport: 1280, page: 4 });
    expect(shown(slots())).toEqual([2, 3, 4, 5, 6]);
    expect(manual.currentPage).toBe(4);
    const last = mountStrip({ viewport: 1280, page: COUNT - 1 });
    expect(shown(last.slots())).toEqual([COUNT - 3, COUNT - 2, COUNT - 1, null, null]);
  });

  it('marks the centre slot as the large current one, the others not', () => {
    const { slots } = mountStrip({ viewport: 1280 });
    expect(slots().map((slot) => slot.dataset.centre)).toEqual(['false', 'false', 'true', 'false', 'false']);
  });

  it('has no scrim: nothing over the room but the strip and the page', () => {
    const { manual } = mountStrip();
    expect(manual.scrim).toBeNull();
    expect(dom.body.children).toEqual([manual.thumb, manual.element]);
  });

  it('re-lays out when the viewport crosses the breakpoint', () => {
    const { slots, manual } = mountStrip({ viewport: 1280, page: 3 });
    expect(slots()).toHaveLength(5);
    dom.viewport.width = 390;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(slots()).toHaveLength(3);
    expect(shown(slots())).toEqual([2, 3, 4]);
    expect(manual.currentPage).toBe(3);
  });
});

describe('moving along the strip', () => {
  it('an end arrow moves one page, and does nothing past the ends', () => {
    const { prev, next, manual, changes } = mountStrip();
    prev.fire('click');
    expect(manual.currentPage).toBe(0);
    expect(changes).toEqual([]);
    next.fire('click');
    next.fire('click');
    expect(manual.currentPage).toBe(2);
    prev.fire('click');
    expect(manual.currentPage).toBe(1);
    expect(prev.attributes['aria-disabled']).toBe('false');
  });

  it('marks an end arrow inert at its end, never disabled', () => {
    const { prev, next, manual } = mountStrip();
    expect(prev.attributes['aria-disabled']).toBe('true');
    expect(prev.disabled).toBe(false);
    for (let i = 0; i < COUNT; i++) next.fire('click');
    expect(manual.currentPage).toBe(COUNT - 1);
    expect(next.attributes['aria-disabled']).toBe('true');
  });

  it('a swipe along the strip moves one page, whichever way, and never opens it', () => {
    const { manual, slots } = mountStrip({ viewport: 1280, page: 3 });
    touchDown(slots()[3]);
    touchUp(slots()[3], 100 - BOOKLET_UI.swipeDistance, 100);
    expect(manual.currentPage).toBe(4);
    touchDown(slots()[2], 100, 100);
    touchUp(slots()[2], 100 + BOOKLET_UI.swipeDistance, 100);
    expect(manual.currentPage).toBe(3);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
  });

  it('a tap on a side page centres it', () => {
    const { manual, slots } = mountStrip({ viewport: 1280, page: 4 });
    touchDown(slots()[4]);
    touchUp(slots()[4]);
    expect(manual.currentPage).toBe(6);
    down(slots()[1]);
    up(slots()[1]);
    expect(manual.currentPage).toBe(5);
  });

  it('a tap on an empty slot does nothing', () => {
    const { manual, slots } = mountStrip({ viewport: 1280 });
    down(slots()[0]);
    up(slots()[0]);
    expect(manual.currentPage).toBe(0);
    expect(manual.expanded).toBe(false);
  });

  it('the arrow keys step it docked, and not while the catalog is the sheet in hand', () => {
    const { manual } = mountStrip();
    dom.key('ArrowRight');
    dom.key('ArrowRight');
    dom.key('ArrowLeft');
    expect(manual.currentPage).toBe(1);
    const catalog = createBookletSheet({ pages: { count: 4, canvas: () => ({}) as CanvasImageSource }, name: 'catalog', corner: 'topLeft', open: true });
    mounted.push(catalog);
    dom.key('ArrowRight');
    expect(manual.currentPage).toBe(1);
    expect(catalog.currentPage).toBe(1);
  });

  it('leaves the arrow keys to a slider that has focus', () => {
    const { manual } = mountStrip();
    const slider = new FakeElement('input', dom);
    slider.closest = (tag: string) => (tag.includes('input') ? slider : null);
    dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: 'ArrowRight', target: slider }));
    expect(manual.currentPage).toBe(0);
  });
});

describe('opening it on a touch: hold to peek, release to put it back', () => {
  it('holding the centre page past the peek delay opens it, and the release closes it', () => {
    const { manual, centre, changes } = mountStrip();
    touchDown(centre());
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs - 1);
    expect(manual.expanded).toBe(false);
    vi.advanceTimersByTime(1);
    expect(manual.expanded).toBe(true);
    expect(manual.element.dataset.open).toBe('true');
    touchUp(centre());
    expect(manual.expanded).toBe(false);
    expect(changes).toEqual([
      { page: 0, expanded: true },
      { page: 0, expanded: false },
    ]);
  });

  it('a quick tap on the centre page peeks nothing, and the late delay does nothing', () => {
    const { manual, centre } = mountStrip();
    touchDown(centre());
    touchUp(centre());
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
  });

  it('a touch that moves past the tap distance before the delay is a swipe, never a peek', () => {
    const { manual, centre } = mountStrip({ page: 3 });
    touchDown(centre());
    centre().fire('pointermove', { pointerType: 'touch', clientX: 100 - (GESTURE.tapMaxDistance + 1), clientY: 100 });
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
    touchUp(centre(), 100 - BOOKLET_UI.swipeDistance, 100);
    expect(manual.expanded).toBe(false);
    expect(manual.currentPage).toBe(4);
  });

  it('wobble inside the tap distance still peeks', () => {
    const { manual, centre } = mountStrip();
    touchDown(centre());
    centre().fire('pointermove', { pointerType: 'touch', clientX: 100 + GESTURE.tapMaxDistance, clientY: 100 });
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.expanded).toBe(true);
  });

  it('a cancelled touch puts a peeked page back', () => {
    const { manual, centre } = mountStrip();
    touchDown(centre());
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    centre().fire('pointercancel', { pointerType: 'touch' });
    expect(manual.expanded).toBe(false);
  });

  it('while peeking, a swipe along the strip is not a flip: the release only closes', () => {
    const { manual, centre } = mountStrip({ page: 2 });
    touchDown(centre());
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    touchUp(centre(), 100 - 3 * BOOKLET_UI.swipeDistance, 100);
    expect(manual.expanded).toBe(false);
    expect(manual.currentPage).toBe(2);
  });
});

describe('opening it with a mouse or a key: click to open, click the page to close', () => {
  it('a click on the centre page opens it, with no hold', () => {
    const { manual, centre, changes } = mountStrip();
    down(centre());
    up(centre());
    expect(manual.expanded).toBe(true);
    expect(changes).toEqual([{ page: 0, expanded: true }]);
  });

  it('a click on the open page closes it, like a tap on any sheet', () => {
    const { manual, centre, view } = mountStrip();
    down(centre());
    up(centre());
    down(view);
    up(view, { ms: GESTURE.tapMaxMs });
    expect(manual.expanded).toBe(false);
  });

  it('a click on the centre page again closes it too', () => {
    const { manual, centre } = mountStrip();
    down(centre());
    up(centre());
    down(centre());
    up(centre());
    expect(manual.expanded).toBe(false);
  });

  it('Escape closes it', () => {
    const { manual, centre } = mountStrip();
    down(centre());
    up(centre());
    dom.key('Escape');
    expect(manual.expanded).toBe(false);
  });

  it("Enter on the centre page (a key's click) opens it; the pointer's own click is not counted twice", () => {
    const { manual, centre } = mountStrip();
    centre().fire('click', { detail: 0 });
    expect(manual.expanded).toBe(true);
    centre().fire('click', { detail: 0 });
    expect(manual.expanded).toBe(false);
    down(centre());
    up(centre());
    centre().fire('click', { detail: 1 });
    expect(manual.expanded).toBe(true);
  });

  it('flips the open page by the strip and the keys, the page following the centre', () => {
    const { manual, centre, next } = mountStrip({ viewport: 1280 });
    down(centre());
    up(centre());
    next.fire('click');
    dom.key('ArrowRight');
    expect(manual.currentPage).toBe(2);
    expect(manual.expanded).toBe(true);
  });
});

describe("the manual's open page prints no arrows, so it lays no hit zones over its corners", () => {
  it('has only the page in its frame — a tap in a lower corner closes it, as anywhere on the page', () => {
    const { manual, centre, view } = mountStrip();
    down(centre());
    up(centre());
    const frame = view.children[0];
    expect(frame.children).toHaveLength(1);
    down(frame.children[0]);
    up(frame.children[0]);
    expect(manual.expanded).toBe(false);
  });

  it('keeps focus on the strip when it opens, and names the page for a screen reader', () => {
    const { manual, centre } = mountStrip();
    centre().focus();
    centre().fire('click', { detail: 0 });
    expect(manual.expanded).toBe(true);
    expect(dom.focused).toBe(centre());
    expect(manual.element.children[2].textContent).toBe(`Page 1 of ${COUNT}`);
  });
});

describe('it never blocks the room', () => {
  it('builds no scrim and swallows nothing: the page takes input only on itself', () => {
    const { manual } = mountStrip();
    expect(manual.scrim).toBeNull();
    expect([...dom.head.children].map((node) => node.textContent).join('')).toContain('.booklet-strip');
  });

  it('grows the page from the centre slot, resting on the strip', () => {
    const { manual, centre } = mountStrip();
    centre().rect = { left: 300, top: 600, width: 120, height: 167 };
    manual.element.offsetWidth = 600;
    // Docked, the page sits scaled onto the centre slot's own rect.
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(manual.element.style.transform).toBe('translate(300px, 600px) scale(0.2)');
    down(centre());
    up(centre());
    expect(manual.element.style.transform).toBe('translate(-50%, 0)');
    expect(manual.element.dataset.docked).toBe('strip');
  });
});

describe('the catalog wins', () => {
  it('opening the catalog puts an open manual page down, without moving focus', () => {
    const { manual, centre } = mountStrip();
    const catalog = createBookletSheet({ pages: { count: 4, canvas: () => ({}) as CanvasImageSource }, name: 'catalog', corner: 'topLeft', open: false });
    mounted.push(catalog);
    dom.body.append(catalog.scrim as unknown as FakeElement, catalog.thumb as unknown as FakeElement, catalog.element as unknown as FakeElement);
    down(centre());
    up(centre());
    expect(manual.expanded).toBe(true);
    dom.focused = null;
    catalog.setOpen(true);
    expect(catalog.expanded).toBe(true);
    expect(manual.expanded).toBe(false);
  });

  it("the manual stays down under an open catalog, and the catalog's thumb is not made inert by an open manual page", () => {
    const { manual, centre } = mountStrip();
    const catalog = createBookletSheet({ pages: { count: 4, canvas: () => ({}) as CanvasImageSource }, name: 'catalog', corner: 'topLeft', open: false });
    mounted.push(catalog);
    down(centre());
    up(centre());
    expect((catalog.thumb as unknown as FakeElement).inert).toBe(false);
    catalog.setOpen(true);
    manual.setOpen(true);
    expect(manual.expanded).toBe(false);
    expect((manual.thumb as unknown as FakeElement).inert).toBe(true);
  });

  it('puts focus on the centre page when asked', () => {
    const { manual, centre } = mountStrip();
    manual.focus();
    expect(dom.focused).toBe(centre());
  });
});
