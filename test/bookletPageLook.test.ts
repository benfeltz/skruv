import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, BOOKLET_UI, CATALOG, GESTURE } from '../src/constants.js';
import { createBookletSheet } from '../src/ui/booklet.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.1.5: the booklet sheet's page look — the catalog's: the page alone, its arrows laid
// over the printed corners. Driven on the same minimal fake DOM as the sheet look's tests
// (test/bookletSplash.test.ts), which stay as they were. How it grows and feels is a phone check.

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

const COUNT = 4;
const [pageW, pageH] = BOOKLET.pageSize;
type FakeSheet = Omit<ReturnType<typeof createBookletSheet>, 'scrim' | 'thumb' | 'element'> & { scrim: FakeElement; thumb: FakeElement; element: FakeElement };

function mount(options: { open?: boolean; canClose?: () => boolean; corner?: 'topLeft' | 'bottomLeft' } = {}) {
  const sheet = createBookletSheet({
    pages: { count: COUNT, canvas: () => ({}) as CanvasImageSource },
    look: 'page',
    corner: 'topLeft',
    ...options,
  }) as unknown as FakeSheet;
  mounted.push(sheet);
  dom.body.append(sheet.scrim, sheet.thumb, sheet.element);
  const [close, view] = sheet.element.children;
  const frame = view.children[0];
  const [canvas, prev, next] = frame.children;
  return { sheet, close, view, frame, canvas, prev, next };
}

const press = (target: FakeElement, { dx = 0, dy = 0, ms = 0, pointerId = 1 } = {}) => {
  target.fire('pointerdown', { pointerId, clientX: 100, clientY: 100, timeStamp: 1000 });
  target.fire('pointerup', { pointerId, clientX: 100 + dx, clientY: 100 + dy, timeStamp: 1000 + ms });
};
const tapRoom = (scrim: FakeElement) => {
  scrim.fire('pointerdown', { pointerId: 1 });
  scrim.fire('pointerup', { pointerId: 1 });
};

describe('the page look: the page alone', () => {
  it('builds no handle and no control bar — a page and a close the eye never sees', () => {
    const { sheet, close, view } = mount();
    expect(sheet.element.className).toBe('booklet-leaf');
    expect(sheet.element.children).toEqual([close, view]);
    expect(close.className).toBe('booklet-close');
    expect(JSON.stringify(sheet.element.children.map((c) => c.className))).not.toMatch(/handle|controls/);
  });

  it('lays a clear button over each printed corner arrow, in page fractions', () => {
    const { prev, next } = mount();
    const share = ([x, y, w, h]: readonly number[]) => ({ left: `${(100 * x) / pageW}%`, top: `${(100 * y) / pageH}%`, width: `${(100 * w) / pageW}%`, height: `${(100 * h) / pageH}%` });
    expect(prev.style).toMatchObject(share(CATALOG.page.prev));
    expect(next.style).toMatchObject(share(CATALOG.page.next));
    expect(prev.attributes['aria-label']).toBe(CATALOG.words.prev);
    expect(next.attributes['aria-label']).toBe(CATALOG.words.next);
  });

  it('does not dim the room: its scrim carries no colour of its own', () => {
    const { sheet } = mount();
    expect(sheet.scrim.style).toEqual({});
  });

  it('docks its thumb in the corner it is told, and leaves the thumb shown while the page is open', () => {
    const { sheet } = mount({ corner: 'topLeft' });
    expect(sheet.thumb.dataset.corner).toBe('topLeft');
    expect(sheet.expanded).toBe(true);
    expect(sheet.thumb.hidden).toBe(false);
  });
});

describe('the page look: the arrows', () => {
  it('shows only › on the cover, both in the middle, only ‹ on the last page', () => {
    const { sheet, prev, next } = mount();
    expect([prev.hidden, next.hidden]).toEqual([true, false]);
    next.fire('click');
    expect([prev.hidden, next.hidden]).toEqual([false, false]);
    next.fire('click');
    next.fire('click');
    expect(sheet.currentPage).toBe(3);
    expect([prev.hidden, next.hidden]).toEqual([false, true]);
    // Hidden is also deaf: a click that reaches a hidden arrow flips nothing past the end.
    expect([prev.disabled, next.disabled]).toEqual([false, true]);
    prev.fire('click');
    expect(sheet.currentPage).toBe(2);
  });

  it('turns by swipe and by the arrow keys, as the sheet does', () => {
    const { sheet, view } = mount();
    press(view, { dx: -BOOKLET_UI.swipeDistance, ms: 100 });
    expect(sheet.currentPage).toBe(1);
    dom.key('ArrowRight');
    expect(sheet.currentPage).toBe(2);
    dom.key('ArrowLeft');
    dom.key('ArrowLeft');
    dom.key('ArrowLeft');
    expect(sheet.currentPage).toBe(0);
    expect(sheet.expanded).toBe(true);
  });

  it('opens onto › on the cover, and on ‹ when the page has no next', () => {
    const { sheet, next, prev } = mount({ open: false });
    sheet.thumb.fire('click');
    expect(dom.focused).toBe(next);
    sheet.setOpen(false);
    for (let i = 0; i < COUNT - 1; i++) next.fire('click');
    sheet.thumb.fire('click');
    expect(dom.focused).toBe(prev);
  });
});

describe('the page look: putting it down', () => {
  it.each<[string, (parts: ReturnType<typeof mount>) => void]>([
    ['a tap on the room', ({ sheet }) => tapRoom(sheet.scrim)],
    ['a tap on the page', ({ view }) => press(view)],
    ['Escape', () => dom.key('Escape')],
    ['a swipe down', ({ view }) => press(view, { dy: BOOKLET_UI.swipeDistance })],
    ['the unseen close button', ({ close }) => close.fire('click')],
  ])('closes on %s, and the thumb is there to reopen it', (_, close) => {
    const parts = mount();
    close(parts);
    expect(parts.sheet.expanded).toBe(false);
    expect(parts.sheet.element.dataset.open).toBe('false');
    expect(parts.sheet.thumb.hidden).toBe(false);
    vi.runAllTimers();
    parts.sheet.thumb.fire('click');
    expect(parts.sheet.expanded).toBe(true);
  });

  it('keeps an arrow its own job: a press on it is no page tap', () => {
    const { sheet, next } = mount();
    press(next);
    next.fire('click');
    expect(sheet.expanded).toBe(true);
    expect(sheet.currentPage).toBe(1);
  });

  it('is not put down while canClose says no — by any way', () => {
    const { sheet, view, close } = mount({ canClose: () => false });
    tapRoom(sheet.scrim);
    press(view);
    close.fire('click');
    dom.key('Escape');
    press(view, { dy: BOOKLET_UI.swipeDistance });
    expect(sheet.expanded).toBe(true);
  });

  it('closes on the tap thresholds exactly as the sheet look does', () => {
    const edge = mount();
    press(edge.view, { dx: GESTURE.tapMaxDistance, ms: GESTURE.tapMaxMs });
    expect(edge.sheet.expanded).toBe(false);
    edge.sheet.dispose();
    const far = mount();
    press(far.view, { dx: GESTURE.tapMaxDistance + 1 });
    expect(far.sheet.expanded).toBe(true);
  });

  it('is one of one open: another sheet open keeps this one docked', () => {
    const first = mount();
    const second = mount();
    expect(first.sheet.expanded).toBe(true);
    expect(second.sheet.expanded).toBe(false);
  });
});

describe('the page look: the grow', () => {
  it('sits centred at full size open, and shrinks onto its thumb corner closed', () => {
    const { sheet } = mount({ open: false });
    sheet.element.offsetWidth = 360;
    sheet.thumb.fire('click');
    expect(sheet.element.style.transform).toBe('translate(-50%, -50%)');
    sheet.setOpen(false);
    const scale = BOOKLET_UI.thumbWidth / 360;
    expect(sheet.element.style.transform).toBe(
      `translate(calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-left) - 50vw), calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-top) - 50vh)) scale(${scale})`,
    );
  });
});
