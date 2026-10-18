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
// The slots a band builds: those its long side shows, the hidden ones a drag needs, and those the
// track's rest shift (no empty slot beside the pages at either end) brings in.
const built = (extent: number, sizes: { slot: number; gap: number }) =>
  slotCount(extent, sizes, 12, 1) + 2 * centreSlot(visibleCount(extent, sizes, 12));
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
  const [lane] = manual.thumb.children;
  const [track] = lane.children;
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
const move = (target: FakeElement, init: { pointerType?: string; x?: number; y?: number; pointerId?: number } = {}) =>
  target.fire('pointermove', { pointerType: init.pointerType ?? 'mouse', clientX: init.x ?? 100, clientY: init.y ?? 100, pointerId: init.pointerId ?? 1 });
const touchDown = (target: FakeElement, x = 100, y = 100) => down(target, { pointerType: 'touch', x, y });
const touchUp = (target: FakeElement, x = 100, y = 100) => up(target, { pointerType: 'touch', x, y });

describe('what the strip shows', () => {
  it('is three pages and the hidden ones past each end on a phone held upright, the current one in the centre slot, empty past the cover', () => {
    const { slots } = mountStrip({ viewport: PORTRAIT });
    // Three shown, the hidden ones a drag of a page's reach fills the band with, and one more each end for the rest shift.
    expect(slots()).toHaveLength(9);
    expect(shown(slots())).toEqual([null, null, null, null, 0, 1, 2, 3, 4]);
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
    expect(shown(slots())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(manual.currentPage).toBe(4);
    const last = mountStrip({ page: COUNT - 1 });
    expect(shown(last.slots())).toEqual([COUNT - 5, COUNT - 4, COUNT - 3, COUNT - 2, COUNT - 1, null, null, null, null]);
  });

  it('marks the centre slot as the current one, the others not', () => {
    const { slots } = mountStrip();
    expect(slots().map((slot) => slot.dataset.centre)).toEqual(['false', 'false', 'false', 'false', 'true', 'false', 'false', 'false', 'false']);
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
    expect(slots()).toHaveLength(9);
    expect(shown(slots())).toEqual([null, 0, 1, 2, 3, 4, 5, 6, 7]);
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

  it('puts the band on the right with no notch: flush, the view inset by exactly the band, the backdrop black, no notch column', () => {
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    expect(dom.rootStyle.props).toEqual({
      '--strip-bottom': '0px',
      '--strip-left': '0px',
      '--strip-right': `${bandRight}px`,
      '--backdrop': '#000',
    });
    expect(manual.thumb.dataset.band).toBe('right');
    expect(dom.rootStyle.dataset.strip).toBe('right');
  });

  it("puts the band on the side without the notch, flush: a notch on the left means the band on the right, the left margin the notch's real inset and its middle named", () => {
    dom.safe.left = 59;
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    expect(manual.thumb.dataset.band).toBe('right');
    expect(dom.rootStyle.props['--strip-left']).toBe('env(safe-area-inset-left)');
    expect(dom.rootStyle.props['--strip-right']).toBe(`${bandRight}px`);
    expect(dom.rootStyle.props['--rail-x']).toBe('calc(env(safe-area-inset-left) / 2)');
    expect(dom.rootStyle.props['--backdrop']).toBe('#000');
  });

  it("a notch on the right means the band on the left, flush, and the right margin the notch's real inset", () => {
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    turn(LANDSCAPE, { left: 0, right: 59 });
    expect(manual.thumb.dataset.band).toBe('left');
    expect(dom.rootStyle.dataset.strip).toBe('left');
    expect(dom.rootStyle.props['--strip-left']).toBe(`${bandRight}px`);
    expect(dom.rootStyle.props['--strip-right']).toBe('env(safe-area-inset-right)');
    expect(dom.rootStyle.props['--rail-x']).toBe('calc(100vw - env(safe-area-inset-right) / 2)');
  });

  it('with the same inset on both sides, as phones report in landscape, the rotation says where the notch is: the band flush on the other side, no margin shown there', () => {
    dom.safe.left = 47;
    dom.safe.right = 47;
    dom.angle = 270;
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    // Notch on the right: the band on the left with no inset padding, the black margin on the right only.
    expect(manual.thumb.dataset.band).toBe('left');
    expect(dom.rootStyle.props['--strip-left']).toBe(`${bandRight}px`);
    expect(dom.rootStyle.props['--strip-right']).toBe('env(safe-area-inset-right)');
    dom.angle = 90;
    dom.rotate();
    expect(manual.thumb.dataset.band).toBe('right');
    expect(dom.rootStyle.props['--strip-left']).toBe('env(safe-area-inset-left)');
    expect(dom.rootStyle.props['--strip-right']).toBe(`${bandRight}px`);
  });

  // Ben's phone, 2026-10-18: Chrome on iOS reports no insets (its own margin keeps the page out of
  // the notch), so the band follows the rotation alone and draws no margin or column of its own.
  it('with no insets but a landscape rotation, as in Chrome on iOS, the band goes opposite the notch and no margin is drawn', () => {
    dom.angle = 270;
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    expect(manual.thumb.dataset.band).toBe('left');
    expect(dom.rootStyle.props['--strip-left']).toBe(`${bandRight}px`);
    expect(dom.rootStyle.props['--strip-right']).toBe('0px');
    expect(dom.rootStyle.props['--rail-x']).toBeUndefined();
    dom.angle = 90;
    dom.rotate();
    expect(manual.thumb.dataset.band).toBe('right');
    expect(dom.rootStyle.props['--strip-left']).toBe('0px');
    expect(dom.rootStyle.props['--rail-x']).toBeUndefined();
  });

  // Ben's phone, 2026-10-18: turned end over end, iOS sent the turn before its rotation changed,
  // and the band stayed on the notch. The turn is read again once it has settled.
  it('reads a turn again once it has settled, when the rotation changes after the turn event', () => {
    dom.safe.left = 59;
    dom.safe.right = 59;
    dom.angle = 90;
    const { manual } = mountStrip({ viewport: LANDSCAPE });
    expect(manual.thumb.dataset.band).toBe('right');
    // The event first, the rotation after it.
    dom.rotate();
    dom.angle = 270;
    expect(manual.thumb.dataset.band).toBe('right');
    vi.advanceTimersByTime(BOOKLET_UI.turnSettleMs);
    expect(manual.thumb.dataset.band).toBe('left');
  });

  it('turning back upright gives the whole width back: no backdrop, no notch column', () => {
    mountStrip({ viewport: LANDSCAPE });
    turn(LANDSCAPE, { left: 59, right: 0 });
    turn(PORTRAIT, { left: 0, right: 0 });
    expect(dom.rootStyle.props['--backdrop']).toBeUndefined();
    expect(dom.rootStyle.props['--rail-x']).toBeUndefined();
    expect(dom.rootStyle.props['--strip-left']).toBe('0px');
    expect(dom.rootStyle.dataset.strip).toBe('bottom');
  });

  it('is edge to edge: the whole bottom upright, the whole height of the side without the notch in landscape, each from the page ratio', () => {
    mountStrip();
    const css = rules();
    const portrait = css.slice(css.indexOf(".booklet-strip[data-band='bottom'] {"), css.indexOf('/* Down an edge'));
    const right = css.slice(css.indexOf(".booklet-strip[data-band='right'] {\n"), css.indexOf("\n    .booklet-strip[data-band='left'] {\n"));
    const left = css.slice(css.indexOf("\n    .booklet-strip[data-band='left'] {\n"), css.indexOf('/* Where the pages run'));
    expect(pageHeight).toBe(100);
    expect(portrait).toContain('left: 0;');
    expect(portrait).toContain('right: 0;');
    expect(portrait).toContain('bottom: 0;');
    expect(portrait).toContain(`height: calc(${pageHeight + 2 * page.gutter}px + env(safe-area-inset-bottom));`);
    expect(css).toContain(".booklet-strip[data-band='right'], .booklet-strip[data-band='left'] {\n      top: 0;\n      bottom: 0;");
    expect(right).toContain('right: 0;');
    // Flush against its edge: no safe-area padding on that side.
    expect(right).toContain(`width: ${bandRight}px;`);
    expect(right).toContain('padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0;');
    expect(left).toContain('left: 0;');
    expect(left).toContain(`width: ${bandRight}px;`);
    expect(left).toContain('padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0;');
  });

  it('is paper with an ink rule on its view side, its slots cut at its edges, and nothing softer', () => {
    mountStrip();
    const css = rules();
    const band = css.slice(css.indexOf('.booklet-strip {'), css.indexOf(".booklet-strip[data-band='bottom'] {"));
    expect(band).toContain('overflow: hidden;');
    expect(band).toContain(`background: ${hex(COLORS.bookletPaper)};`);
    expect(css).toContain(`box-shadow: inset 0 ${strip.rule}px 0 ${hex(COLORS.bookletInk)};`);
    expect(css).toContain(`box-shadow: inset ${strip.rule}px 0 0 ${hex(COLORS.bookletInk)};`);
    expect(css).toContain(`box-shadow: inset -${strip.rule}px 0 0 ${hex(COLORS.bookletInk)};`);
    expect(band).not.toContain('border-radius');
    expect(strip.rule).toBe(INSET.ring.width);
  });

  it("puts the catalog's thumb at the top of the screen in the room beside the band, a gutter clear of it, and leaves the band's lane the whole height", () => {
    mountStrip();
    const css = rules();
    const beside = bandRight + page.gutter;
    expect(css).toContain(`html[data-strip='right'] .booklet-thumb[data-corner='topLeft'] {\n      left: auto;\n      right: ${beside}px;`);
    expect(css).toContain(`html[data-strip='left'] .booklet-thumb[data-corner='topLeft'] {\n      left: ${beside}px;\n      right: auto;`);
    // Ben, 2026-10-18: the upper right from the first load on (the menu and the lift line have the left,
    // for the left thumb), so nothing swaps sides when a model is picked.
    expect(css).toContain(`.booklet-thumb[data-corner='topLeft'] {\n      top: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-top));\n      bottom: auto;\n      left: auto;\n      right: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-right));`);
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
    touchDown(slots()[6]);
    touchUp(slots()[6]);
    expect(manual.currentPage).toBe(6);
    down(slots()[3]);
    up(slots()[3]);
    expect(manual.currentPage).toBe(5);
  });

  it('a tap on an empty slot does nothing', () => {
    const { manual, slots } = mountStrip();
    down(slots()[1]);
    up(slots()[1]);
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

describe('the band scrolls as a carousel', () => {
  const pull = (target: FakeElement, along: number, axis: 'x' | 'y' = 'x') => {
    const at = axis === 'x' ? { x: 100 + along, y: 100 } : { x: 100, y: 100 + along };
    down(target);
    move(target, at);
    return at;
  };

  it('follows the pointer while it moves, and snaps to the nearest page on release', () => {
    const { manual, slots, track, changes } = mountStrip({ page: 3 });
    const at = pull(slots()[4], -0.7 * PITCH);
    expect(track.style.transform).toBe(`translateX(${-0.7 * PITCH}px)`);
    expect(track.dataset.dragging).toBe('true');
    up(slots()[4], at);
    expect(manual.currentPage).toBe(4);
    expect(manual.expanded).toBe(false);
    expect(changes).toEqual([{ page: 4, expanded: false }]);
    // The new page is painted at once; the pages then slide the rest of the way home.
    expect(shown(slots())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(track.style.transform).toBe('translateX(0px)');
    expect(track.dataset.dragging).toBeUndefined();
  });

  it('slides from where the pages were let go, as far as the snap leaves them', () => {
    const { slots, track } = mountStrip({ page: 3 });
    const sets: string[] = [];
    let current = '';
    Object.defineProperty(track.style, 'transform', { get: () => current, set: (value: string) => sets.push((current = value)), configurable: true });
    const at = pull(slots()[4], -0.7 * PITCH);
    up(slots()[4], at);
    // The release: the track is put where the pages were let go (a pull of 56 short of the page's 80, so 24 past), then let go to 0.
    expect(sets.slice(-2)).toEqual([`translateX(${-0.7 * PITCH + PITCH}px)`, 'translateX(0px)']);
  });

  it('a short pull snaps back to the same page', () => {
    const { manual, slots, track, changes } = mountStrip({ page: 3 });
    const at = pull(slots()[4], -0.3 * PITCH);
    up(slots()[4], at);
    expect(manual.currentPage).toBe(3);
    expect(changes).toEqual([]);
    expect(track.style.transform).toBe('translateX(0px)');
  });

  it('pulls toward earlier pages the other way', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const at = pull(slots()[2], 0.6 * PITCH);
    up(slots()[2], at);
    expect(manual.currentPage).toBe(2);
  });

  it('stops at the ends: pulling past the last page is clamped, and a release there stays', () => {
    const { manual, slots, track } = mountStrip({ page: COUNT - 1 });
    const at = pull(slots()[2], -5 * PITCH);
    // The last page rests a slot toward the end (no empty slot after it), and the pull goes no further.
    expect(track.style.transform).toBe(`translateX(${PITCH}px)`);
    up(slots()[2], at);
    expect(manual.currentPage).toBe(COUNT - 1);
    const first = mountStrip();
    const back = pull(first.slots()[4], 5 * PITCH);
    // The first page rests a slot toward the start.
    expect(first.track.style.transform).toBe(`translateX(${-PITCH}px)`);
    up(first.slots()[4], back);
    expect(first.manual.currentPage).toBe(0);
  });

  it("goes no further than the slots built for it: a long pull stops a page's reach off, so the band never shows empty paper", () => {
    const { manual, slots, track } = mountStrip({ page: 4 });
    const at = pull(slots()[4], -5 * PITCH);
    expect(track.style.transform).toBe(`translateX(${-BOOKLET_UI.strip.reach * PITCH}px)`);
    up(slots()[4], at);
    expect(manual.currentPage).toBe(5);
    const back = pull(slots()[4], 5 * PITCH);
    expect(track.style.transform).toBe(`translateX(${BOOKLET_UI.strip.reach * PITCH}px)`);
    up(slots()[4], back);
    expect(manual.currentPage).toBe(4);
  });

  it('works with a mouse as with a finger', () => {
    const { manual, slots } = mountStrip({ page: 3 });
    const at = pull(slots()[3], -PITCH);
    up(slots()[3], at);
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
    down(slots()[5]);
    up(slots()[5]);
    expect(manual.currentPage).toBe(5);
    expect(sets.slice(-2)).toEqual([`translateX(${PITCH}px)`, 'translateX(0px)']);
    down(slots()[3]);
    up(slots()[3]);
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
    down(slots()[4], { pointerType: 'touch', pointerId: 1 });
    move(slots()[4], { pointerType: 'touch', pointerId: 1, x: 100 - 1.4 * PITCH });
    expect(track.dataset.dragging).toBe('true');
    down(slots()[3], { pointerType: 'touch', pointerId: 2, x: 200 });
    expect(track.style.transform).toBe('translateX(0px)');
    expect(track.dataset.dragging).toBeUndefined();
    up(slots()[4], { pointerType: 'touch', pointerId: 1, x: 100 - 1.4 * PITCH });
    up(slots()[3], { pointerType: 'touch', pointerId: 2, x: 200 });
    expect(manual.currentPage).toBe(3);
    expect(changes).toEqual([]);
  });

  it('a cancelled drag slides back and flips nothing; so does a lost capture', () => {
    const { manual, slots, track } = mountStrip({ page: 3 });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      pull(slots()[4], -1.4 * PITCH);
      slots()[4].fire(type, { pointerType: 'mouse' });
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
    const at = pull(slots()[4], -PITCH);
    up(slots()[4], at);
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

describe('holding a side page peeks it in place', () => {
  const held = () => {
    const strip = mountStrip();
    return { ...strip, side: strip.slots()[5] };
  };

  it('opens that page without moving the band, and the release puts it back', () => {
    const { manual, slots, side, view, changes } = held();
    touchDown(side);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs);
    expect(manual.expanded).toBe(true);
    expect((view.children[0].children[0].drawn as { index: number }).index).toBe(1);
    expect(manual.currentPage).toBe(0);
    expect(shown(slots())).toEqual([null, null, null, null, 0, 1, 2, 3, 4]);
    touchUp(side);
    expect(manual.expanded).toBe(false);
    expect(manual.currentPage).toBe(0);
    expect(shown(slots())).toEqual([null, null, null, null, 0, 1, 2, 3, 4]);
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
    touchDown(slots()[1]);
    vi.advanceTimersByTime(BOOKLET_UI.strip.peekDelayMs * 2);
    expect(manual.expanded).toBe(false);
    touchUp(slots()[1]);
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
    down(manual.thumb.children[0].children[0].children[4]);
    up(manual.thumb.children[0].children[0].children[4]);
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
    finger(slots()[4], 2, 200);
    // The first finger spreads past the swipe distance and lifts.
    centre().fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 100 - 2 * BOOKLET_UI.swipeDistance, clientY: 100 });
    lift(centre(), 1, 100 - 2 * BOOKLET_UI.swipeDistance);
    lift(slots()[4], 2, 200);
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
    finger(slots()[4], 2, 200);
    expect(manual.expanded).toBe(false);
    lift(centre(), 1, 100);
    lift(slots()[4], 2, 200);
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
    finger(slots()[4], 2, 200);
    lift(centre(), 1, 100);
    lift(slots()[4], 2, 200);
    down(slots()[5], { pointerType: 'touch', pointerId: 3 });
    up(slots()[5], { pointerType: 'touch', pointerId: 3 });
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
    down(slots()[5]);
    up(slots()[5]);
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
