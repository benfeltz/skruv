import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, BOOKLET_UI, CLUSTER, COLORS, GESTURE, INSET, MENU } from '../src/constants.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.1.2: the manual docked as a carousel band (along the bottom in portrait, down the right
// in landscape: 1.9.7.1.2), opened without blocking the room. Driven headlessly on the fake DOM;
// how the drag, the hold and the band's look feel on a phone is the manual plan.

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

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

function mountStrip(options: { page?: number; viewport?: { width: number; height: number } } = {}) {
  dom.viewport.width = (options.viewport ?? PORTRAIT).width;
  dom.viewport.height = (options.viewport ?? PORTRAIT).height;
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
  const [track] = manual.thumb.children;
  const slots = () => track.children;
  const view = manual.element.children[1];
  for (let i = 0; i < (options.page ?? 0); i++) dom.key('ArrowRight');
  changes.length = 0;
  return { manual, track, slots, centre: () => slots()[Math.floor(slots().length / 2)], view, changes };
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
  it('is three pages and a hidden one past each end on a phone held upright, the centre current, empty past the cover', () => {
    const { slots } = mountStrip({ viewport: PORTRAIT });
    expect(slots()).toHaveLength(3 + 2 * BOOKLET_UI.strip.buffer);
    expect(shown(slots())).toEqual([null, null, 0, 1, 2]);
  });

  it('follows the width in portrait and the height in landscape', () => {
    expect(mountStrip({ viewport: { width: 1000, height: 1200 } }).slots()).toHaveLength(11 + 2);
    mounted.pop()!.dispose();
    // 1280 x 800 is landscape: the band stands on the right edge, so the long side is the height.
    expect(mountStrip({ viewport: { width: 1280, height: 800 } }).slots()).toHaveLength(9 + 2);
    mounted.pop()!.dispose();
    expect(mountStrip({ viewport: LANDSCAPE }).slots()).toHaveLength(3 + 2);
  });

  it('puts the current page in the middle, with its neighbours either side, and empty slots past the last', () => {
    const { slots, manual } = mountStrip({ page: 4 });
    expect(shown(slots())).toEqual([2, 3, 4, 5, 6]);
    expect(manual.currentPage).toBe(4);
    const last = mountStrip({ page: COUNT - 1 });
    expect(shown(last.slots())).toEqual([COUNT - 3, COUNT - 2, COUNT - 1, null, null]);
  });

  it('marks the centre slot as the current one, the others not', () => {
    const { slots } = mountStrip();
    expect(slots().map((slot) => slot.dataset.centre)).toEqual(['false', 'false', 'true', 'false', 'false']);
  });

  it("draws the slots into small canvases, not the page's full resolution, and builds no thumbnail canvas", () => {
    const { slots } = mountStrip();
    const canvas = slots()[2].children[0] as unknown as { width: number; height: number };
    // The fake window has no device pixel ratio: one canvas pixel per CSS pixel.
    expect(canvas.width).toBe(BOOKLET_UI.strip.page);
    expect(canvas.width * canvas.height).toBeLessThan(BOOKLET.pageSize[0] * BOOKLET.pageSize[1] * 0.05);
    expect(slots().every((slot) => slot.children.length === 1)).toBe(true);
  });

  it('has no scrim: nothing over the room but the strip and the page', () => {
    const { manual } = mountStrip();
    expect(manual.scrim).toBeNull();
    expect(dom.body.children).toEqual([manual.thumb, manual.element]);
  });

  it('keeps focus on the strip when a resize rebuilds its slots', () => {
    const { centre } = mountStrip({ viewport: { width: 1000, height: 1200 }, page: 3 });
    // The fake document's active element is the focused one, as a real document's is.
    vi.stubGlobal('document', { ...document, get activeElement() { return dom.focused; } });
    centre().focus();
    dom.viewport.width = 390;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(dom.focused).toBe(centre());
    expect(dom.focused?.dataset.centre).toBe('true');
  });

  it('re-lays out when the viewport turns', () => {
    const { slots, manual, track } = mountStrip({ viewport: { width: 1000, height: 1200 }, page: 3 });
    expect(slots()).toHaveLength(13);
    dom.viewport.width = 390;
    dom.viewport.height = 844;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(slots()).toHaveLength(5);
    expect(shown(slots())).toEqual([1, 2, 3, 4, 5]);
    expect(manual.currentPage).toBe(3);
    expect(track.dataset.axis).toBe('x');
  });
});

describe('the band, by orientation', () => {
  const rules = () => dom.head.children.find((node) => node.id === 'skruv-booklet')!.textContent;
  const [pageW, pageH] = BOOKLET.pageSize;
  const { strip, page } = BOOKLET_UI;
  const pageHeight = Math.round((strip.page * pageH) / pageW);
  const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

  it("says its axis to the band, the track and the open page, and follows a turn", () => {
    const { manual, track } = mountStrip({ viewport: PORTRAIT });
    expect(manual.thumb.dataset.axis).toBe('x');
    expect(track.dataset.axis).toBe('x');
    expect(manual.element.dataset.axis).toBe('x');
    dom.viewport.width = LANDSCAPE.width;
    dom.viewport.height = LANDSCAPE.height;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(manual.thumb.dataset.axis).toBe('y');
    expect(track.dataset.axis).toBe('y');
    expect(manual.element.dataset.axis).toBe('y');
  });

  it('calls a square viewport portrait, as CSS does', () => {
    const { manual } = mountStrip({ viewport: { width: 800, height: 800 } });
    expect(manual.thumb.dataset.axis).toBe('x');
  });

  it('sets the root variables for the room\'s view: the bottom in portrait, the right in landscape, and clears them on dispose', () => {
    const bottom = `calc(${pageHeight + 2 * page.gutter}px + env(safe-area-inset-bottom))`;
    const right = `calc(${strip.page + 2 * page.gutter}px + env(safe-area-inset-right))`;
    const { manual } = mountStrip({ viewport: PORTRAIT });
    expect(dom.rootStyle.props).toEqual({ '--strip-bottom': bottom, '--strip-right': '0px' });
    dom.viewport.width = LANDSCAPE.width;
    dom.viewport.height = LANDSCAPE.height;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(dom.rootStyle.props).toEqual({ '--strip-bottom': '0px', '--strip-right': right });
    manual.dispose();
    expect(dom.rootStyle.props).toEqual({});
  });

  it('is edge to edge: the whole bottom in portrait, the whole right edge in landscape, each from the page ratio', () => {
    mountStrip();
    const css = rules();
    const portrait = css.slice(css.indexOf(".booklet-strip[data-axis='x'] {"), css.indexOf(".booklet-strip[data-axis='y'] {"));
    const landscape = css.slice(css.indexOf(".booklet-strip[data-axis='y'] {"), css.indexOf('.booklet-track {'));
    expect(pageHeight).toBe(100);
    expect(portrait).toContain('left: 0;');
    expect(portrait).toContain('right: 0;');
    expect(portrait).toContain('bottom: 0;');
    expect(portrait).toContain(`height: calc(${pageHeight + 2 * page.gutter}px + env(safe-area-inset-bottom));`);
    expect(landscape).toContain('top: 0;');
    expect(landscape).toContain('right: 0;');
    expect(landscape).toContain('bottom: 0;');
    expect(landscape).toContain(`width: calc(${strip.page + 2 * page.gutter}px + env(safe-area-inset-right));`);
  });

  it('is paper with an ink rule on its view side, its slots cut at its edges, and nothing softer', () => {
    mountStrip();
    const css = rules();
    const band = css.slice(css.indexOf('.booklet-strip {'), css.indexOf(".booklet-strip[data-axis='x'] {"));
    expect(band).toContain('overflow: hidden;');
    expect(band).toContain(`background: ${hex(COLORS.bookletPaper)};`);
    expect(css).toContain(`box-shadow: inset 0 ${strip.rule}px 0 ${hex(COLORS.bookletInk)};`);
    expect(css).toContain(`box-shadow: inset ${strip.rule}px 0 0 ${hex(COLORS.bookletInk)};`);
    expect(band).not.toContain('border-radius');
    expect(strip.rule).toBe(INSET.ring.width);
  });

  it('draws every page one size from the page ratio, the centre told by its gold border, and has no arrows', () => {
    mountStrip();
    const css = rules();
    const slot = css.slice(css.indexOf('.booklet-slot {'), css.indexOf(".booklet-slot[data-centre='true']"));
    expect(slot).toContain('flex: none;');
    expect(slot).toContain(`width: ${strip.page}px;`);
    expect(css).toContain(`.booklet-slot[data-centre='true'] { border-color: ${hex(COLORS.uiAccent)}; }`);
    expect(css).not.toContain('--slot-');
    expect(css).not.toContain('.booklet-arrow');
  });
});

describe('moving along the strip', () => {
  it('a swipe along the strip moves one page, whichever way, and never opens it', () => {
    const { manual, slots } = mountStrip({ page: 3 });
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
    const { manual, slots } = mountStrip({ page: 4 });
    touchDown(slots()[4]);
    touchUp(slots()[4]);
    expect(manual.currentPage).toBe(6);
    down(slots()[1]);
    up(slots()[1]);
    expect(manual.currentPage).toBe(5);
  });

  it('a tap on an empty slot does nothing', () => {
    const { manual, slots } = mountStrip();
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

  it('leaves the arrow keys to a slider or a control that is not its own', () => {
    const { manual } = mountStrip();
    const control = (tag: string) => {
      const element = new FakeElement(tag, dom);
      element.closest = () => element;
      return element;
    };
    for (const target of [control('input'), control('button')]) {
      dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: 'ArrowRight', target }));
    }
    expect(manual.currentPage).toBe(0);
  });

  it("steps on the arrow keys from its own strip, and from the page's own body", () => {
    const { manual, centre } = mountStrip();
    dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: 'ArrowRight', target: centre() }));
    expect(manual.currentPage).toBe(1);
    // Focus on the document body (nothing focused) is the common case.
    dom.key('ArrowRight');
    expect(manual.currentPage).toBe(2);
  });

  it('leaves a chord or a key already handled alone: Alt+Left is the browser back, not a flip', () => {
    const { manual } = mountStrip();
    const send = (extra: object) => dom.windowListeners.get('keydown')!.forEach((fn) => fn({ key: 'ArrowRight', ...extra }));
    send({ altKey: true });
    send({ ctrlKey: true });
    send({ metaKey: true });
    send({ shiftKey: true });
    send({ defaultPrevented: true });
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

  it('a lost capture ends the press: a peeked page goes back and the strip takes the next press', () => {
    const { manual, centre } = mountStrip();
    touchDown(centre());
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.expanded).toBe(true);
    centre().fire('lostpointercapture', { pointerType: 'touch' });
    expect(manual.expanded).toBe(false);
    // Not stuck: a press lost before the delay never peeks late, and the next press works.
    touchDown(centre());
    centre().fire('lostpointercapture', { pointerType: 'touch' });
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
    touchDown(centre());
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

describe('holding a side page peeks it in place', () => {
  const held = () => {
    const strip = mountStrip();
    return { ...strip, side: strip.slots()[3] };
  };

  it('opens that page without moving the band, and the release puts it back', () => {
    const { manual, slots, side, view, changes } = held();
    touchDown(side);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.expanded).toBe(true);
    expect((view.children[0].children[0].drawn as { index: number }).index).toBe(1);
    expect(manual.currentPage).toBe(0);
    expect(shown(slots())).toEqual([null, null, 0, 1, 2]);
    touchUp(side);
    expect(manual.expanded).toBe(false);
    expect(manual.currentPage).toBe(0);
    expect(shown(slots())).toEqual([null, null, 0, 1, 2]);
    expect(changes).toEqual([
      { page: 1, expanded: true },
      { page: 0, expanded: false },
    ]);
  });

  it('grows from and shrinks back to the held slot, not the centre', () => {
    const { manual, centre, side } = held();
    side.rect = { left: 500, top: 620, width: 72, height: 100 };
    centre().rect = { left: 300, top: 600, width: 120, height: 167 };
    manual.element.offsetWidth = 720;
    touchDown(side);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.element.style.transform).toBe('translate(-50%, 0)');
    touchUp(side);
    expect(manual.element.style.transform).toBe('translate(500px, 620px) scale(0.1)');
  });

  it('a hold on an empty slot peeks nothing', () => {
    const { manual, slots } = held();
    touchDown(slots()[0]);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
    touchUp(slots()[0]);
    expect(manual.currentPage).toBe(0);
  });

  it('a quick tap on a side page still centres it, and a held page does not flip on release', () => {
    const { manual, side } = held();
    touchDown(side);
    touchUp(side);
    expect(manual.currentPage).toBe(1);
    expect(manual.expanded).toBe(false);
  });

  it('with the manual open, a hold on a side page still flips to it and never closes the page', () => {
    const { manual, side, changes } = held();
    down(manual.thumb.children[0].children[2]);
    up(manual.thumb.children[0].children[2]);
    expect(manual.expanded).toBe(true);
    changes.length = 0;
    touchDown(side);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(true);
    touchUp(side);
    expect(manual.expanded).toBe(true);
    expect(manual.currentPage).toBe(1);
    expect(changes.every((change) => change.expanded)).toBe(true);
  });

  it('the page on view is the one reported, so the glow follows it', () => {
    const { side, changes, manual } = held();
    touchDown(side);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(changes.at(-1)).toEqual({ page: 1, expanded: true });
    expect(manual.currentPage).toBe(0);
  });
});

describe('a second finger on the band cancels its gesture', () => {
  const finger = (target: FakeElement, pointerId: number, x: number) => down(target, { pointerType: 'touch', pointerId, x });
  const lift = (target: FakeElement, pointerId: number, x: number) => up(target, { pointerType: 'touch', pointerId, x });

  it('a pinch with both fingers on the band flips nothing and peeks nothing', () => {
    const { manual, slots, centre, changes } = mountStrip({ page: 3 });
    finger(centre(), 1, 100);
    finger(slots()[3], 2, 200);
    // The first finger spreads past the swipe distance and lifts.
    centre().fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 100 - 2 * BOOKLET_UI.swipeDistance, clientY: 100 });
    lift(centre(), 1, 100 - 2 * BOOKLET_UI.swipeDistance);
    lift(slots()[3], 2, 200);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.currentPage).toBe(3);
    expect(manual.expanded).toBe(false);
    expect(changes).toEqual([]);
  });

  it('a second finger puts a peeked page back, and the first finger\'s lift changes nothing', () => {
    const { manual, slots, centre, changes } = mountStrip({ page: 3 });
    finger(centre(), 1, 100);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.expanded).toBe(true);
    finger(slots()[3], 2, 200);
    expect(manual.expanded).toBe(false);
    lift(centre(), 1, 100);
    lift(slots()[3], 2, 200);
    expect(manual.currentPage).toBe(3);
    expect(manual.expanded).toBe(false);
    expect(changes).toEqual([
      { page: 3, expanded: true },
      { page: 3, expanded: false },
    ]);
  });

  it('the next single press works', () => {
    const { manual, slots, centre } = mountStrip({ page: 3 });
    finger(centre(), 1, 100);
    finger(slots()[3], 2, 200);
    lift(centre(), 1, 100);
    lift(slots()[3], 2, 200);
    down(slots()[3], { pointerType: 'touch', pointerId: 3 });
    up(slots()[3], { pointerType: 'touch', pointerId: 3 });
    expect(manual.currentPage).toBe(4);
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
    const { manual, centre, slots } = mountStrip();
    down(centre());
    up(centre());
    down(slots()[3]);
    up(slots()[3]);
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

// What the open page may take of a screen is CSS; these pin the numbers it is built from.
describe("the open manual page's room above the strip", () => {
  const css = () => {
    mountStrip();
    return dom.head.children.find((node) => node.id === 'skruv-booklet')!.textContent;
  };
  const { strip, page } = BOOKLET_UI;

  it('rests on the band: the root variable and the gap', () => {
    const rules = css();
    expect(rules).toContain(`--strip-reserve: calc(var(--strip-bottom, 0px) + ${strip.openGap}px);`);
    expect(rules).toContain('bottom: var(--strip-reserve);');
  });

  it("holds a portrait page's top below the menu button, the cluster's one row", () => {
    const rules = css();
    const below = CLUSTER.inset + MENU.size + page.gutter;
    expect(rules).toContain('@media (orientation: portrait) {');
    expect(rules).toContain(`--strip-top: ${below}px;`);
    // ...which clears the cluster's bottom edge (the menu button's row) by the gutter.
    expect(below - page.gutter).toBe(CLUSTER.inset + MENU.size);
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
