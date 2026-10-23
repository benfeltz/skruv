import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, BOOKLET_UI, CLUSTER, COLORS, GESTURE, INSET, MENU } from '../src/constants.js';
import { centreSlot, slotCount, visibleCount } from '../src/game/carouselModel.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.1.2: the manual docked as a carousel band (along the bottom in portrait, down the right
// in landscape: 1.9.7.1.2), opened without blocking the room. Driven headlessly on the fake DOM;
// how the drag, the hold and the band's look feel on a phone is the manual plan.

let dom: FakeDom;
const mounted: { dispose(): void }[] = [];
beforeEach(() => {
  canvasOf.mockClear();
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

const PITCH = BOOKLET_UI.strip.page + BOOKLET_UI.strip.gap;
// Down the right edge a slot's length along the band is a page's height.
const TALL_PITCH = Math.round((BOOKLET_UI.strip.page * BOOKLET.pageSize[1]) / BOOKLET.pageSize[0]) + BOOKLET_UI.strip.gap;
const PORTRAIT = { width: 390, height: 844 };
// The slots a band builds: enough for its long side, the track's rest shift, and a slot for every
// page round any current one.
const built = (extent: number, sizes: { slot: number; gap: number }) => slotCount(extent, sizes, 12, COUNT);
// The slot `by` places from the centre one.
const C = (slots: readonly unknown[], by = 0) => centreSlot(slots.length) + by;
const LANDSCAPE = { width: 844, height: 390 };

const canvasOf = vi.fn((index: number) => ({ index }) as unknown as CanvasImageSource);

function mountStrip(options: { page?: number; viewport?: { width: number; height: number } } = {}) {
  dom.viewport.width = (options.viewport ?? PORTRAIT).width;
  dom.viewport.height = (options.viewport ?? PORTRAIT).height;
  const manual = createBookletSheet({
    pages: { count: COUNT, canvas: canvasOf },
    docked: 'strip',
    blocking: false,
    open: false,
  }) as unknown as FakeSheet<null>;
  mounted.push(manual);
  dom.body.append(manual.thumb, manual.element);
  const changes: { page: number; expanded: boolean }[] = [];
  manual.onChange((change) => changes.push(change));
  const [lane] = manual.thumb.children;
  const [track] = lane.children;
  const slots = () => track.children;
  const view = manual.element.children[1];
  for (let i = 0; i < (options.page ?? 0); i++) dom.key('ArrowRight');
  changes.length = 0;
  return { manual, track, slots, centre: () => slots()[Math.floor(slots().length / 2)], view, changes };
}

// What each slot shows: a page number, or null for an empty slot.
const shown = (slots: FakeElement[]) => slots.map((slot) => (slot.dataset.empty === 'true' ? null : Number(slot.dataset.page)));

const down = (target: FakeElement, init: { pointerType?: string; x?: number; y?: number; pointerId?: number } = {}) =>
  target.fire('pointerdown', { pointerType: init.pointerType ?? 'mouse', clientX: init.x ?? 100, clientY: init.y ?? 100, pointerId: init.pointerId ?? 1, timeStamp: 1000 });
const up = (target: FakeElement, init: { pointerType?: string; x?: number; y?: number; pointerId?: number; ms?: number } = {}) =>
  target.fire('pointerup', { pointerType: init.pointerType ?? 'mouse', clientX: init.x ?? 100, clientY: init.y ?? 100, pointerId: init.pointerId ?? 1, timeStamp: 1000 + (init.ms ?? 0) });
const move = (target: FakeElement, init: { pointerType?: string; x?: number; y?: number; pointerId?: number; ms?: number } = {}) =>
  target.fire('pointermove', { pointerType: init.pointerType ?? 'mouse', clientX: init.x ?? 100, clientY: init.y ?? 100, pointerId: init.pointerId ?? 1, timeStamp: 1000 + (init.ms ?? 0) });
const touchDown = (target: FakeElement, x = 100, y = 100) => down(target, { pointerType: 'touch', x, y });
const touchUp = (target: FakeElement, x = 100, y = 100) => up(target, { pointerType: 'touch', x, y });

describe('what the strip shows', () => {
  it('is three pages and the hidden ones past each end on a phone held upright, the current one in the centre slot, empty past the cover', () => {
    const { slots } = mountStrip({ viewport: PORTRAIT });
    // Three shown, and a slot for every page round any current one: 2 x 10 - 1.
    expect(slots()).toHaveLength(19);
    expect(shown(slots())).toEqual([null, null, null, null, null, null, null, null, null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('follows the width in portrait and the height in landscape, a slot counting its length along the band', () => {
    // Pages 80 apart along a 1000 px wide band, then the hidden ones.
    expect(mountStrip({ viewport: { width: 1000, height: 1200 } }).slots()).toHaveLength(built(1000, { slot: 72, gap: 8 }));
    mounted.pop()!.dispose();
    // 1280 x 800 is landscape: the band stands on an edge, so the long side is the height, and a
    // slot is a page's height (108 apart): 7 shown, not the 9 that 80 apart would give.
    expect(mountStrip({ viewport: { width: 1280, height: 800 } }).slots()).toHaveLength(built(800, { slot: 100, gap: 8 }));
    expect(visibleCount(800, { slot: 100, gap: 8 }, 12)).toBe(7);
    mounted.pop()!.dispose();
    expect(mountStrip({ viewport: LANDSCAPE }).slots()).toHaveLength(built(390, { slot: 100, gap: 8 }));
  });

  it('puts the current page in the middle, with its neighbours either side, and empty slots past the last', () => {
    const { slots, manual } = mountStrip({ page: 4 });
    expect(shown(slots())).toEqual([null, null, null, null, null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null, null]);
    expect(manual.currentPage).toBe(4);
    const last = mountStrip({ page: COUNT - 1 });
    expect(shown(last.slots())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null, null, null, null, null, null, null]);
  });

  it('marks the centre slot as the current one, the others not', () => {
    const { slots } = mountStrip();
    expect(slots().map((slot) => slot.dataset.centre)).toEqual(slots().map((_, at) => String(at === 9)));
    expect(slots()).toHaveLength(19);
  });

  it("draws the slots into small canvases, not the page's full resolution, and builds no thumbnail canvas", () => {
    const { slots } = mountStrip();
    const canvas = slots()[3].children[0] as unknown as { width: number; height: number };
    // The fake window has no device pixel ratio: one canvas pixel per CSS pixel.
    expect(canvas.width).toBe(BOOKLET_UI.strip.page);
    expect(canvas.width * canvas.height).toBeLessThan(BOOKLET.pageSize[0] * BOOKLET.pageSize[1] * 0.05);
    expect(slots().every((slot) => slot.children.length === 1)).toBe(true);
  });

  it('has no scrim: nothing over the room but the strip and the page', () => {
    const { manual } = mountStrip();
    expect(manual.scrim).toBeNull();
    // (The strip's hidden safe-area probe is in the body too.)
    expect(dom.body.children.filter((node) => node.attributes['aria-hidden'] !== 'true')).toEqual([manual.thumb, manual.element]);
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
    expect(slots()).toHaveLength(built(1000, { slot: 72, gap: 8 }));
    dom.viewport.width = 390;
    dom.viewport.height = 844;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(slots()).toHaveLength(19);
    expect(shown(slots())).toEqual([null, null, null, null, null, null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null]);
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

  const turn = (viewport: { width: number; height: number }, safe = { left: 0, right: 0 }) => {
    dom.viewport.width = viewport.width;
    dom.viewport.height = viewport.height;
    dom.safe.left = safe.left;
    dom.safe.right = safe.right;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
  };
  const bandRight = strip.page + 2 * page.gutter;

  it("sets the root variables for the room's view: the bottom upright, and clears them on dispose", () => {
    const { manual } = mountStrip({ viewport: PORTRAIT });
    expect(dom.rootStyle.props).toEqual({ '--strip-bottom': `calc(${pageHeight + 2 * page.gutter}px + env(safe-area-inset-bottom))`, '--strip-left': '0px', '--strip-right': '0px' });
    expect(dom.rootStyle.dataset.strip).toBe('bottom');
    manual.dispose();
    expect(dom.rootStyle.props).toEqual({});
    expect(dom.rootStyle.dataset.strip).toBeUndefined();
  });

  // Ben, 2026-10-18: which side the notch is on cannot be told reliably (Safari reports the same
  // inset on both sides, Chrome on iOS none), so in landscape the band always stands on the right and
  // the menu and the lift line always on the left. Both safe-area margins are kept, drawn black.
  it('stands on the right in landscape: the view inset by the band and the right margin, and by the left margin, the backdrop black', () => {
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    expect(dom.rootStyle.props).toEqual({
      '--strip-bottom': '0px',
      '--strip-left': 'env(safe-area-inset-left)',
      '--strip-right': `calc(${bandRight}px + env(safe-area-inset-right))`,
      '--backdrop': '#000',
    });
    expect(manual.thumb.dataset.band).toBe('right');
    expect(dom.rootStyle.dataset.strip).toBe('right');
  });

  it('stays on the right whichever way the phone is turned, with insets on both sides or none', () => {
    dom.safe.left = 59;
    dom.safe.right = 59;
    dom.angle = 270;
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    expect(manual.thumb.dataset.band).toBe('right');
    dom.angle = 90;
    dom.rotate();
    turn(LANDSCAPE, { left: 0, right: 0 });
    expect(manual.thumb.dataset.band).toBe('right');
    expect(dom.rootStyle.dataset.strip).toBe('right');
  });

  it('turning back upright gives the whole width back: no backdrop', () => {
    mountStrip({ viewport: LANDSCAPE });
    turn(LANDSCAPE, { left: 59, right: 59 });
    turn(PORTRAIT, { left: 0, right: 0 });
    expect(dom.rootStyle.props['--backdrop']).toBeUndefined();
    expect(dom.rootStyle.props['--strip-left']).toBe('0px');
    expect(dom.rootStyle.dataset.strip).toBe('bottom');
  });

  it('is edge to edge: the whole bottom upright, the whole height of the right edge in landscape inside its safe-area margin, each from the page ratio', () => {
    mountStrip();
    const css = rules();
    const portrait = css.slice(css.indexOf(".booklet-strip[data-band='bottom'] {"), css.indexOf('/* Down the right edge'));
    const right = css.slice(css.indexOf(".booklet-strip[data-band='right'] {\n"), css.indexOf('/* Where the pages run'));
    expect(pageHeight).toBe(100);
    expect(portrait).toContain('left: 0;');
    expect(portrait).toContain('right: 0;');
    expect(portrait).toContain('bottom: 0;');
    expect(portrait).toContain(`height: calc(${pageHeight + 2 * page.gutter}px + env(safe-area-inset-bottom));`);
    expect(right).toContain('top: 0;');
    expect(right).toContain('bottom: 0;');
    expect(right).toContain('right: env(safe-area-inset-right);');
    expect(right).toContain(`width: ${bandRight}px;`);
    expect(right).toContain('padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0;');
    expect(css).not.toContain("data-band='left'");
  });

  it('is paper with an ink rule on its view side, its slots cut at its edges, and nothing softer', () => {
    mountStrip();
    const css = rules();
    const band = css.slice(css.indexOf('.booklet-strip {'), css.indexOf(".booklet-strip[data-band='bottom'] {"));
    expect(band).toContain('overflow: hidden;');
    expect(band).toContain(`background: ${hex(COLORS.bookletPaper)};`);
    expect(css).toContain(`box-shadow: inset 0 ${strip.rule}px 0 ${hex(COLORS.bookletInk)};`);
    expect(css).toContain(`box-shadow: inset ${strip.rule}px 0 0 ${hex(COLORS.bookletInk)};`);
    expect(band).not.toContain('border-radius');
    expect(strip.rule).toBe(INSET.ring.width);
  });

  it("puts the catalog's thumb in the control cluster's row, past the menu, and leaves the band's lane the whole height", () => {
    mountStrip();
    const css = rules();
    // Ben, 2026-10-22: beside the menu from the first load on (the fan takes the strip's side), in both orientations.
    expect(css).toContain(`.booklet-thumb[data-corner='topLeft'] {\n      top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));\n      bottom: auto;\n      right: auto;\n      left: calc(${CLUSTER.inset + MENU.size + CLUSTER.gap}px + env(safe-area-inset-left));`);
    // Past the ?tune gear where it stands beside the menu.
    expect(css).toContain(`html[data-tune='true']:not([data-strip='right']) .booklet-thumb[data-corner='topLeft'] {\n      left: calc(${CLUSTER.inset + 2 * (MENU.size + CLUSTER.gap)}px + env(safe-area-inset-left));`);
    expect(css).not.toContain("html[data-strip='right'] .booklet-thumb");
    expect(css).not.toContain("html[data-strip='left']");
    expect(css).not.toContain("html[data-strip='bottom']");
    expect(css).not.toContain('margin-top');
    // Over the band (z-index 0), under the scrim.
    expect(css.slice(css.indexOf('.booklet-strip {'), css.indexOf(".booklet-strip[data-band='bottom']"))).toContain('z-index: 0;');
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
  it('a tap on a side page centres it', () => {
    const { manual, slots } = mountStrip({ page: 4 });
    touchDown(slots()[C(slots(), 2)]);
    touchUp(slots()[C(slots(), 2)]);
    expect(manual.currentPage).toBe(6);
    down(slots()[C(slots(), -1)]);
    up(slots()[C(slots(), -1)]);
    expect(manual.currentPage).toBe(5);
  });

  it('a tap on an empty slot does nothing', () => {
    const { manual, slots } = mountStrip();
    down(slots()[C(slots(), -3)]);
    up(slots()[C(slots(), -3)]);
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

describe('goTo turns to a page as a tap would (1.9.9.1)', () => {
  it('lands on the page with one change', () => {
    const { manual, changes } = mountStrip();
    manual.goTo(3);
    expect(manual.currentPage).toBe(3);
    expect(changes).toHaveLength(1);
    expect(changes[0].page).toBe(3);
  });

  it('clamps past the last page', () => {
    const { manual } = mountStrip();
    manual.goTo(99);
    expect(manual.currentPage).toBe(COUNT - 1);
    manual.goTo(-4);
    expect(manual.currentPage).toBe(0);
  });

  it('fires nothing for the page it is on', () => {
    const { manual, changes } = mountStrip({ page: 2 });
    manual.goTo(2);
    expect(changes).toHaveLength(0);
  });
});

describe('the band scrolls as a carousel', () => {
  // A pull is a slow one: the press and the move share a time stamp, so the release carries
  // nothing past the nearest page. A flick is a `swipe`, with times of its own.
  const pull = (target: FakeElement, along: number, axis: 'x' | 'y' = 'x') => {
    const at = axis === 'x' ? { x: 100 + along, y: 100 } : { x: 100, y: 100 + along };
    down(target);
    move(target, at);
    return at;
  };

  it('follows the pointer while it moves, and snaps to the nearest page on release', () => {
    const { manual, slots, track, changes } = mountStrip({ page: 3 });
    const at = pull(slots()[C(slots())], -0.7 * PITCH);
    expect(track.style.transform).toBe(`translateX(${-0.7 * PITCH}px)`);
    expect(track.dataset.dragging).toBe('true');
    up(slots()[C(slots())], at);
    expect(manual.currentPage).toBe(4);
    expect(manual.expanded).toBe(false);
    expect(changes).toEqual([{ page: 4, expanded: false }]);
    // The new page is painted at once; the pages then slide the rest of the way home.
    expect(shown(slots())).toEqual([null, null, null, null, null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null, null]);
    expect(track.style.transform).toBe('translateX(0px)');
    expect(track.dataset.dragging).toBeUndefined();
  });

  it('slides from where the pages were let go, as far as the snap leaves them', () => {
    const { slots, track } = mountStrip({ page: 3 });
    const sets: string[] = [];
    let current = '';
    Object.defineProperty(track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
    const at = pull(slots()[C(slots())], -0.7 * PITCH);
    up(slots()[C(slots())], at);
    // The release: the track is put where the pages were let go (a pull of 56 short of the page's 80, so 24 past), then let go to 0.
    expect(sets.slice(-2)).toEqual([`translateX(${-0.7 * PITCH + PITCH}px)`, 'translateX(0px)']);
  });

  it('a short pull snaps back to the same page', () => {
    const { manual, slots, track, changes } = mountStrip({ page: 3 });
    const at = pull(slots()[C(slots())], -0.3 * PITCH);
    up(slots()[C(slots())], at);
    expect(manual.currentPage).toBe(3);
    expect(changes).toEqual([]);
    expect(track.style.transform).toBe('translateX(0px)');
  });

  it('pulls toward earlier pages the other way', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const at = pull(slots()[C(slots(), -2)], 0.6 * PITCH);
    up(slots()[C(slots(), -2)], at);
    expect(manual.currentPage).toBe(2);
  });

  it('stops at the ends: pulling past the last page is clamped, and a release there stays', () => {
    const { manual, slots, track } = mountStrip({ page: COUNT - 1 });
    const at = pull(slots()[C(slots(), -2)], -5 * PITCH);
    // The last page rests in the centre like any other (empty space beyond it): the pull goes no further.
    expect(track.style.transform).toBe('translateX(0px)');
    up(slots()[C(slots(), -2)], at);
    // A release there stays on the last page, which stays in the centre.
    expect(manual.currentPage).toBe(COUNT - 1);
    expect(track.style.transform).toBe('translateX(0px)');
    const first = mountStrip();
    const back = pull(first.slots()[C(first.slots())], 5 * PITCH);
    // The first page rests in the centre too.
    expect(first.track.style.transform).toBe('translateX(0px)');
    up(first.slots()[C(first.slots())], back);
    expect(first.manual.currentPage).toBe(0);
  });

  it('a long pull carries the last page to the centre and no further, and the release chooses it', () => {
    const { manual, slots, track } = mountStrip({ page: 4 });
    const at = pull(slots()[C(slots())], -5 * PITCH);
    // Five pitches on, page 9 in the centre: the pull goes no further.
    expect(track.style.transform).toBe(`translateX(${-5 * PITCH}px)`);
    up(slots()[C(slots())], at);
    expect(manual.currentPage).toBe(9);
    // The last page then rests in the centre.
    expect(track.style.transform).toBe('translateX(0px)');
    // ...and back toward the start: not clamped, down to page 4.
    const back = pull(slots()[C(slots())], 5 * PITCH);
    expect(track.style.transform).toBe(`translateX(${5 * PITCH}px)`);
    up(slots()[C(slots())], back);
    expect(manual.currentPage).toBe(4);
  });

  it('draws a slot the first time it comes into view, not before', () => {
    const { slots, track } = mountStrip();
    const asked = () => canvasOf.mock.calls.map(([index]) => index).sort();
    // Only the pages in the band (the first in the centre, the edges of the next ones in) are asked for at mount, not all ten.
    expect(asked()).toEqual([0, 1, 2]);
    pull(slots()[C(slots())], -2 * PITCH);
    expect(track.style.transform).toBe(`translateX(${-2 * PITCH}px)`);
    // Two pages arrived from under the edge and were drawn as they came; none is drawn twice.
    expect(asked()).toEqual([0, 1, 2, 3, 4]);
    move(slots()[C(slots())], { x: 100 - 2 * PITCH });
    expect(canvasOf).toHaveBeenCalledTimes(5);
  });

  // The press at 1000, moves at 1000 + ms, the lift `lift` ms in: `along` px along the band in all.
  const swipe = (target: FakeElement, along: number, ms: number) => {
    down(target);
    move(target, { x: 100 + along / 2, ms: ms / 2 });
    move(target, { x: 100 + along, ms });
    up(target, { x: 100 + along, ms });
  };

  it('a fast release carries a page past the nearest', () => {
    const { manual, slots, track } = mountStrip({ page: 3 });
    const sets: string[] = [];
    let current = '';
    Object.defineProperty(track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
    // 32 px (0.4 of a pitch, which alone is no page) over 40 ms: 0.8 px/ms, past the 0.6 threshold.
    swipe(slots()[C(slots())], -0.4 * PITCH, 40);
    expect(manual.currentPage).toBe(4);
    // The slide starts where the pages were let go, then eases home.
    expect(sets.slice(-2)).toEqual([`translateX(${-0.4 * PITCH + PITCH}px)`, 'translateX(0px)']);
  });

  it('a faster one carries two, never more', () => {
    const first = mountStrip({ page: 3 });
    swipe(first.slots()[C(first.slots())], -0.4 * PITCH, 20);
    expect(first.manual.currentPage).toBe(5);
    const second = mountStrip({ page: 3 });
    swipe(second.slots()[C(second.slots())], -0.4 * PITCH, 10);
    expect(second.manual.currentPage).toBe(5);
  });

  it('a flick the other way carries toward earlier pages', () => {
    const { manual, slots } = mountStrip({ page: 5 });
    swipe(slots()[C(slots())], 0.4 * PITCH, 40);
    expect(manual.currentPage).toBe(4);
  });

  it('a slow release carries nothing, and a pause before the lift is no speed', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    swipe(slots()[C(slots())], -0.4 * PITCH, 1000);
    expect(manual.currentPage).toBe(3);
    const paused = mountStrip({ page: 3 });
    const target = paused.slots()[C(paused.slots())];
    down(target);
    move(target, { x: 100 - 0.4 * PITCH, ms: 20 });
    up(target, { x: 100 - 0.4 * PITCH, ms: 400 });
    expect(paused.manual.currentPage).toBe(3);
  });

  it('a flick past the first page stays on it, and the band slides home', () => {
    const { manual, slots, track } = mountStrip();
    const target = slots()[C(slots())];
    const sets: string[] = [];
    let current = '';
    Object.defineProperty(track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
    down(target);
    // A little toward later pages, then fast back toward earlier ones.
    move(target, { x: 100 - 0.4 * PITCH, ms: 10 });
    move(target, { x: 100 + 0.8 * PITCH, ms: 30 });
    up(target, { x: 100 + 0.8 * PITCH, ms: 30 });
    expect(manual.currentPage).toBe(0);
    expect(track.dataset.dragging).toBeUndefined();
    expect(track.style.transform).toBe(sets.at(-1));
    expect(sets.at(-1)).toBe('translateX(0px)');
  });

  it('at either end, the page carried to the centre is the page chosen, and it stays centred', () => {
    // Round 4: the current page always rests in the centre, so a drag counts pages from there.
    for (const viewport of [PORTRAIT, { width: 500, height: 900 }]) {
      for (let target = 0; target < COUNT - 1; target++) {
        const last = mountStrip({ viewport, page: COUNT - 1 });
        const sets: string[] = [];
        let current = '';
        Object.defineProperty(last.track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
        const at = pull(last.slots()[C(last.slots())], (COUNT - 1 - target) * PITCH);
        up(last.slots()[C(last.slots())], at);
        expect(last.manual.currentPage).toBe(target);
        // The pages are let go in the centre and do not move.
        expect(sets.slice(-2)).toEqual(['translateX(0px)', 'translateX(0px)']);
      }
      const first = mountStrip({ viewport });
      const at = pull(first.slots()[C(first.slots())], -PITCH);
      up(first.slots()[C(first.slots())], at);
      expect(first.manual.currentPage).toBe(1);
      expect(first.track.style.transform).toBe('translateX(0px)');
    }
  });

  it('a flick at the end goes to the last page', () => {
    const { manual, slots, track } = mountStrip({ page: COUNT - 2 });
    const target = slots()[C(slots())];
    down(target);
    move(target, { x: 100 - 0.4 * PITCH, ms: 40 });
    // The track follows the finger: there is room to bring the last page to the centre.
    expect(track.style.transform).toBe(`translateX(${-0.4 * PITCH}px)`);
    up(target, { x: 100 - 0.4 * PITCH, ms: 40 });
    expect(manual.currentPage).toBe(COUNT - 1);
  });

  it('works with a mouse as with a finger', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const at = pull(slots()[C(slots(), -1)], -PITCH);
    up(slots()[C(slots(), -1)], at);
    expect(manual.currentPage).toBe(4);
  });

  it('on the right edge a vertical pull moves the track down the band, a slot being a page tall, and flips; a horizontal one is only a wobble', () => {
    const { manual, slots, track } = mountStrip({ viewport: LANDSCAPE, page: 3 });
    // A page's height and the gap: 108 apart, not the 80 of the bottom band.
    const next = slots()[Math.floor(slots().length / 2) + 1];
    const along = TALL_PITCH * 0.7;
    const at = pull(next, -along, 'y');
    expect(track.style.transform).toBe(`translateY(${-along}px)`);
    up(next, at);
    expect(manual.currentPage).toBe(4);
    const across = pull(next, -2 * PITCH, 'x');
    expect(track.style.transform).toBe('translateY(0px)');
    up(next, across);
    expect(manual.currentPage).toBe(4);
  });

  it('on the right edge a tap on a side page slides it a page-and-a-gap, not a page-width', () => {
    const { manual, slots, track } = mountStrip({ viewport: LANDSCAPE, page: 3 });
    const sets: string[] = [];
    let current = '';
    Object.defineProperty(track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
    const next = slots()[Math.floor(slots().length / 2) + 1];
    down(next);
    up(next);
    expect(manual.currentPage).toBe(4);
    // The paint puts the track at rest first; then the slide.
    expect(sets.slice(-2)).toEqual([`translateY(${TALL_PITCH}px)`, 'translateY(0px)']);
  });

  it('a tap on a side page slides it to the centre', () => {
    const { manual, slots, track } = mountStrip({ page: 4 });
    const sets: string[] = [];
    let current = '';
    Object.defineProperty(track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
    down(slots()[C(slots(), 1)]);
    up(slots()[C(slots(), 1)]);
    expect(manual.currentPage).toBe(5);
    expect(sets.slice(-2)).toEqual([`translateX(${PITCH}px)`, 'translateX(0px)']);
    down(slots()[C(slots(), -1)]);
    up(slots()[C(slots(), -1)]);
    expect(manual.currentPage).toBe(4);
    expect(sets.slice(-2)).toEqual([`translateX(${-PITCH}px)`, 'translateX(0px)']);
  });

  it('the arrow keys step it, sliding as a tap does, in both orientations', () => {
    const portrait = mountStrip({ page: 2 });
    dom.key('ArrowRight');
    expect(portrait.manual.currentPage).toBe(3);
    dom.key('ArrowLeft');
    dom.key('ArrowLeft');
    expect(portrait.manual.currentPage).toBe(1);
    expect(portrait.track.style.transform).toBe('translateX(0px)');
    mounted.pop()!.dispose();
    const landscape = mountStrip({ viewport: LANDSCAPE });
    dom.key('ArrowRight');
    expect(landscape.manual.currentPage).toBe(1);
    dom.key('ArrowLeft');
    expect(landscape.manual.currentPage).toBe(0);
  });

  it('Up and Down step it only when the band stands on the right edge', () => {
    const portrait = mountStrip();
    dom.key('ArrowDown');
    expect(portrait.manual.currentPage).toBe(0);
    mounted.pop()!.dispose();
    const landscape = mountStrip({ viewport: LANDSCAPE });
    dom.key('ArrowDown');
    dom.key('ArrowDown');
    dom.key('ArrowUp');
    expect(landscape.manual.currentPage).toBe(1);
    expect(landscape.track.style.transform).toBe('translateY(0px)');
  });

  it('a second finger during a drag slides the pages back and flips nothing', () => {
    const { manual, slots, track, changes } = mountStrip({ page: 3 });
    down(slots()[C(slots())], { pointerType: 'touch', pointerId: 1 });
    move(slots()[C(slots())], { pointerType: 'touch', pointerId: 1, x: 100 - 1.4 * PITCH });
    expect(track.dataset.dragging).toBe('true');
    down(slots()[C(slots(), -1)], { pointerType: 'touch', pointerId: 2, x: 200 });
    expect(track.style.transform).toBe('translateX(0px)');
    expect(track.dataset.dragging).toBeUndefined();
    up(slots()[C(slots())], { pointerType: 'touch', pointerId: 1, x: 100 - 1.4 * PITCH });
    up(slots()[C(slots(), -1)], { pointerType: 'touch', pointerId: 2, x: 200 });
    expect(manual.currentPage).toBe(3);
    expect(changes).toEqual([]);
  });

  it('a cancelled drag slides back and flips nothing; so does a lost capture', () => {
    const { manual, slots, track } = mountStrip({ page: 3 });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      pull(slots()[C(slots())], -1.4 * PITCH);
      slots()[C(slots())].fire(type, { pointerType: 'mouse' });
      expect(track.style.transform).toBe('translateX(0px)');
      expect(track.dataset.dragging).toBeUndefined();
      expect(manual.currentPage).toBe(3);
    }
  });

  it('a drag with the page open flips the open page', () => {
    const { manual, centre, slots } = mountStrip({ page: 2 });
    down(centre());
    up(centre());
    expect(manual.expanded).toBe(true);
    const at = pull(slots()[C(slots())], -PITCH);
    up(slots()[C(slots())], at);
    expect(manual.currentPage).toBe(3);
    expect(manual.expanded).toBe(true);
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

  it('a touch that moves past the tap distance before the delay is a drag, never a peek', () => {
    const { manual, centre } = mountStrip({ page: 3 });
    touchDown(centre());
    centre().fire('pointermove', { pointerType: 'touch', clientX: 100 - (GESTURE.tapMaxDistance + 1), clientY: 100 });
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
    move(centre(), { pointerType: 'touch', x: 100 - 1.4 * PITCH });
    touchUp(centre(), 100 - 1.4 * PITCH, 100);
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

  it('while peeking, a pull along the strip is not a drag or a flip: the release only closes', () => {
    const { manual, centre } = mountStrip({ page: 2 });
    touchDown(centre());
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    move(centre(), { pointerType: 'touch', x: 100 - 3 * PITCH });
    expect(centre().parent!.dataset.dragging).toBeUndefined();
    expect(centre().parent!.style.transform).toBe('translateX(0px)');
    touchUp(centre(), 100 - 3 * PITCH, 100);
    expect(manual.expanded).toBe(false);
    expect(manual.currentPage).toBe(2);
  });
});

// The 19 slots round page 0 of 10.
const FIRST_PAGE = [null, null, null, null, null, null, null, null, null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('holding a side page peeks it in place', () => {
  const held = () => {
    const strip = mountStrip();
    return { ...strip, side: strip.slots()[C(strip.slots(), 1)] };
  };

  it('opens that page without moving the band, and the release puts it back', () => {
    const { manual, slots, side, view, changes } = held();
    touchDown(side);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.expanded).toBe(true);
    expect((view.children[0].children[0].drawn as { index: number }).index).toBe(1);
    expect(manual.currentPage).toBe(0);
    expect(shown(slots())).toEqual(FIRST_PAGE);
    touchUp(side);
    expect(manual.expanded).toBe(false);
    expect(manual.currentPage).toBe(0);
    expect(shown(slots())).toEqual(FIRST_PAGE);
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
    touchDown(slots()[C(slots(), -3)]);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
    touchUp(slots()[C(slots(), -3)]);
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
    const { manual, slots, side, changes } = held();
    down(slots()[C(slots())]);
    up(slots()[C(slots())]);
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

describe('the wheel steps the band', () => {
  const wheel = (target: FakeElement, init: { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean; ms: number; preventDefault?: () => void }) =>
    target.fire('wheel', { deltaX: 0, deltaY: 0, timeStamp: 1000 + init.ms, ...init });
  const STEP = BOOKLET_UI.strip.wheel.stepMs;
  // WheelEvent.DOM_DELTA_LINE: the fake DOM has no WheelEvent to read it from.
  const LINES = 1;

  it('a notch down steps to the next page, a notch up to the one before, sliding as a key does', () => {
    const { manual, slots, track } = mountStrip({ page: 3 });
    wheel(slots()[C(slots())], { deltaY: 100, ms: 0 });
    expect(manual.currentPage).toBe(4);
    expect(track.style.transform).toBe('translateX(0px)');
    wheel(slots()[C(slots())], { deltaY: -100, ms: 3 * STEP });
    expect(manual.currentPage).toBe(3);
  });

  it('in landscape a vertical notch moves the vertical band, and a horizontal swipe does too', () => {
    const { manual, slots } = mountStrip({ viewport: LANDSCAPE, page: 3 });
    wheel(slots()[C(slots())], { deltaY: 100, ms: 0 });
    expect(manual.currentPage).toBe(4);
    wheel(slots()[C(slots())], { deltaX: 120, ms: 3 * STEP });
    expect(manual.currentPage).toBe(5);
  });

  it('in portrait a horizontal swipe steps too', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    wheel(slots()[C(slots())], { deltaX: -120, ms: 0 });
    expect(manual.currentPage).toBe(2);
  });

  it("a trackpad's small deltas step once past the threshold and then rest", () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const target = slots()[C(slots())];
    for (let i = 0; i < 4; i++) wheel(target, { deltaY: 15, ms: i * 10 });
    expect(manual.currentPage).toBe(4);
    // The rest after a step: more of the same fling does nothing.
    for (let i = 0; i < 6; i++) wheel(target, { deltaY: 15, ms: 40 + i * 10 });
    expect(manual.currentPage).toBe(4);
    // A delta after the rest starts gathering again, and a notch steps.
    wheel(target, { deltaY: 100, ms: 40 + STEP });
    expect(manual.currentPage).toBe(5);
  });

  it('a line-mode notch (Firefox) steps', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    wheel(slots()[C(slots())], { deltaY: 3, deltaMode: LINES, ms: 0 });
    expect(manual.currentPage).toBe(4);
  });

  it('leaves a ctrl wheel (a pinch or the browser zoom) alone', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const prevent = vi.fn();
    wheel(slots()[C(slots())], { deltaY: 100, ms: 0, ctrlKey: true, preventDefault: prevent });
    expect(manual.currentPage).toBe(3);
    expect(prevent).not.toHaveBeenCalled();
  });

  it('claims the wheel: preventDefault is called whether or not a page moves', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const prevent = vi.fn();
    wheel(slots()[C(slots())], { deltaY: 100, ms: 0, preventDefault: prevent });
    expect(manual.currentPage).toBe(4);
    wheel(slots()[C(slots())], { deltaY: 5, ms: 10, preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(2);
  });

  it('at the last page a notch down does nothing, and at the first a notch up does nothing', () => {
    const last = mountStrip({ page: COUNT - 1 });
    wheel(last.slots()[C(last.slots())], { deltaY: 100, ms: 0 });
    expect(last.manual.currentPage).toBe(COUNT - 1);
    const first = mountStrip();
    wheel(first.slots()[C(first.slots())], { deltaY: -100, ms: 0 });
    expect(first.manual.currentPage).toBe(0);
  });

  it('listens on the band alone, and dispose takes the listener off', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    expect(manual.thumb.listeners.get('wheel')).toHaveLength(1);
    expect(manual.element.listeners.get('wheel')).toBeUndefined();
    const target = slots()[C(slots())];
    manual.dispose();
    wheel(target, { deltaY: 100, ms: 0 });
    expect(manual.currentPage).toBe(3);
  });
});

describe('a second finger on the band cancels its gesture', () => {
  const finger = (target: FakeElement, pointerId: number, x: number) => down(target, { pointerType: 'touch', pointerId, x });
  const lift = (target: FakeElement, pointerId: number, x: number) => up(target, { pointerType: 'touch', pointerId, x });

  it('a pinch with both fingers on the band flips nothing and peeks nothing', () => {
    const { manual, slots, centre, changes } = mountStrip({ page: 3 });
    finger(centre(), 1, 100);
    finger(slots()[C(slots())], 2, 200);
    // The first finger spreads past the swipe distance and lifts.
    centre().fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 100 - 2 * BOOKLET_UI.swipeDistance, clientY: 100 });
    lift(centre(), 1, 100 - 2 * BOOKLET_UI.swipeDistance);
    lift(slots()[C(slots())], 2, 200);
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
    finger(slots()[C(slots())], 2, 200);
    expect(manual.expanded).toBe(false);
    lift(centre(), 1, 100);
    lift(slots()[C(slots())], 2, 200);
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
    finger(slots()[C(slots())], 2, 200);
    lift(centre(), 1, 100);
    lift(slots()[C(slots())], 2, 200);
    down(slots()[C(slots(), 1)], { pointerType: 'touch', pointerId: 3 });
    up(slots()[C(slots(), 1)], { pointerType: 'touch', pointerId: 3 });
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
    down(slots()[C(slots(), 1)]);
    up(slots()[C(slots(), 1)]);
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

  it('is centred in the view the band leaves down the right edge', () => {
    const rules = css();
    const landscape = rules.slice(rules.indexOf(".booklet-leaf[data-docked='strip'][data-axis='y'] {"));
    expect(landscape).toContain('left: calc((var(--strip-left, 0px) + 100vw - var(--strip-right, 0px)) / 2);');
    expect(landscape).toContain('top: 50%;');
    expect(landscape).toContain('bottom: auto;');
    expect(landscape).toContain(`width: min(calc(100vw - var(--strip-left, 0px) - var(--strip-right, 0px) - ${2 * page.gutter}px), ${BOOKLET.pageSize[0]}px, calc((100dvh - ${2 * page.gutter}px) * ${BOOKLET.pageSize[0]} / ${BOOKLET.pageSize[1]}));`);
  });

  it('opens at the bottom centre of its anchor in portrait and the centre of the view in landscape; docked, it sits on the slot', () => {
    const portrait = mountStrip({ viewport: PORTRAIT });
    down(portrait.centre());
    up(portrait.centre());
    expect(portrait.manual.element.style.transform).toBe('translate(-50%, 0)');
    mounted.pop()!.dispose();
    const landscape = mountStrip({ viewport: LANDSCAPE });
    landscape.centre().rect = { left: 700, top: 150, width: 72, height: 100 };
    landscape.manual.element.offsetWidth = 360;
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(landscape.manual.element.style.transform).toBe('translate(700px, 150px) scale(0.2)');
    down(landscape.centre());
    up(landscape.centre());
    expect(landscape.manual.element.style.transform).toBe('translate(-50%, -50%)');
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

describe('put away (setShown)', () => {
  it('closes an open strip, hides it, and answers no key', () => {
    const { manual, centre, changes } = mountStrip();
    down(centre());
    up(centre());
    expect(manual.expanded).toBe(true);
    manual.setShown(false);
    expect(manual.expanded).toBe(false);
    expect(manual.thumb.hidden).toBe(true);
    expect(manual.element.hidden).toBe(true);
    changes.length = 0;
    dom.key('ArrowRight');
    expect(manual.currentPage).toBe(0);
    expect(changes).toEqual([]);
  });

  it('closes an open strip even when canClose refuses', () => {
    const manual = createBookletSheet({ pages: { count: COUNT, canvas: canvasOf }, docked: 'strip', blocking: false, open: true, canClose: () => false });
    mounted.push(manual);
    manual.setShown(false);
    expect(manual.expanded).toBe(false);
  });

  it('comes back on the page it was on and turns on the key again', () => {
    const { manual } = mountStrip({ page: 3 });
    manual.setShown(false);
    manual.setShown(true);
    expect(manual.thumb.hidden).toBe(false);
    expect(manual.element.hidden).toBe(false);
    expect(manual.currentPage).toBe(3);
    dom.key('ArrowRight');
    expect(manual.currentPage).toBe(4);
  });

  it("a put-away sheet does not make another sheet's thumb inert", () => {
    const { manual, centre } = mountStrip();
    const catalog = createBookletSheet({ pages: { count: 4, canvas: () => ({}) as CanvasImageSource }, name: 'catalog', corner: 'topLeft', open: false });
    mounted.push(catalog);
    down(centre());
    up(centre());
    expect((catalog.thumb as unknown as FakeElement).inert).toBe(false);
    manual.setShown(false);
    catalog.setOpen(true);
    expect(catalog.expanded).toBe(true);
    expect((manual.thumb as unknown as FakeElement).inert).toBe(false);
  });

  it('is harmless twice', () => {
    const { manual } = mountStrip();
    manual.setShown(false);
    manual.setShown(false);
    manual.setShown(true);
    manual.setShown(true);
    expect(manual.thumb.hidden).toBe(false);
  });
});
