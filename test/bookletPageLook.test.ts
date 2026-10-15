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
    expect(sheet.element.children.slice(0, 2)).toEqual([close, view]);
    // ...and the live region that names the page: nothing visible beyond the page itself.
    expect(sheet.element.children).toHaveLength(3);
    expect(close.className).toBe('booklet-close');
    expect(JSON.stringify(sheet.element.children.map((c) => c.className))).not.toMatch(/handle|controls/);
  });

  it('lays a clear button over each printed corner arrow, in page fractions', () => {
    const { prev, next } = mount();
    const share = ([x, y, w, h]: readonly number[]) => ({ left: `${(100 * x) / pageW}%`, top: `${(100 * y) / pageH}%`, width: `${(100 * w) / pageW}%`, height: `${(100 * h) / pageH}%` });
    expect(prev.style).toMatchObject(share(CATALOG.page.prevHit));
    expect(next.style).toMatchObject(share(CATALOG.page.nextHit));
    expect(prev.attributes['aria-label']).toBe(CATALOG.words.prev);
    expect(next.attributes['aria-label']).toBe(CATALOG.words.next);
  });

  it('says which page it is in a live region, the number being printed rather than text', () => {
    const { sheet } = mount();
    const status = sheet.element.children[2];
    expect(status.attributes['aria-live']).toBe('polite');
    expect(status.textContent).toBe(`Page 1 of ${COUNT}`);
    dom.key('ArrowRight');
    expect(status.textContent).toBe(`Page 2 of ${COUNT}`);
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
  it('marks the arrow that has nowhere to go inert, and keeps its button in place', () => {
    const { sheet, prev, next } = mount();
    const inert = () => [prev.attributes['aria-disabled'], next.attributes['aria-disabled']];
    expect(inert()).toEqual(['true', 'false']);
    next.fire('click');
    expect(inert()).toEqual(['false', 'false']);
    for (let i = 0; i < COUNT; i++) next.fire('click');
    expect(sheet.currentPage).toBe(COUNT - 1);
    expect(inert()).toEqual(['false', 'true']);
    // Present, not hidden or disabled: it keeps focus and the corner.
    expect([prev.hidden, next.hidden, prev.disabled, next.disabled]).toEqual([false, false, false, false]);
    prev.fire('click');
    expect(sheet.currentPage).toBe(COUNT - 2);
  });

  it('never puts the catalog down by a tap in the corner of an arrow that has nowhere to go', () => {
    const { sheet, prev, next } = mount();
    // ‹ on the cover; then › on the last page, tapped over and over.
    press(prev);
    expect(sheet.expanded).toBe(true);
    for (let i = 0; i < COUNT; i++) next.fire('click');
    for (let i = 0; i < 3; i++) press(next);
    expect(sheet.expanded).toBe(true);
    expect(sheet.currentPage).toBe(COUNT - 1);
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

  it('opens onto › and keeps focus there, inert at the last page, never dropping it to the body', () => {
    const { sheet, next } = mount({ open: false });
    sheet.thumb.fire('click');
    expect(dom.focused).toBe(next);
    for (let i = 0; i < COUNT; i++) next.fire('click');
    expect(next.hidden).toBe(false);
    sheet.setOpen(false);
    sheet.thumb.fire('click');
    expect(dom.focused).toBe(next);
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
  // The page's layout box centred (before any transform), and a thumb rect at the corner.
  const lay = (sheet: FakeSheet, box: { width: number; left: number; top: number }, thumb: { left: number; top: number; width: number }) => {
    sheet.element.offsetWidth = box.width;
    sheet.element.offsetLeft = box.left;
    sheet.element.offsetTop = box.top;
    sheet.thumb.rect = { ...thumb, height: 0 };
  };

  it('sits centred at full size open, and closed lies on the thumb as it is measured', () => {
    const { sheet } = mount({ open: false });
    lay(sheet, { width: 360, left: 200, top: 300 }, { left: 16, top: 20, width: BOOKLET_UI.thumbWidth });
    sheet.thumb.fire('click');
    expect(sheet.element.style.transform).toBe('translate(-50%, -50%)');
    sheet.setOpen(false);
    expect(sheet.element.style.transform).toBe(`translate(${16 - 200}px, ${20 - 300}px) scale(${BOOKLET_UI.thumbWidth / 360})`);
  });

  it('follows a hover-enlarged thumb, not the docked width', () => {
    const { sheet } = mount({ open: false });
    lay(sheet, { width: 360, left: 200, top: 300 }, { left: 16, top: 20, width: 180 });
    sheet.thumb.fire('click');
    sheet.setOpen(false);
    expect(sheet.element.style.transform).toBe(`translate(${16 - 200}px, ${20 - 300}px) scale(0.5)`);
  });

  it('docks the page, measured, before the first open — even one built before it was mounted', () => {
    const { sheet } = mount({ open: false });
    // Built unmounted: no box yet, so scale 1.
    expect(sheet.element.style.transform).toMatch(/scale\(1\)$/);
    const writes: string[] = [];
    sheet.element.style = new Proxy(sheet.element.style, {
      set(target, key, value: string) {
        if (key === 'transform') writes.push(value);
        target[key as string] = value;
        return true;
      },
    });
    lay(sheet, { width: 400, left: 160, top: 100 }, { left: 16, top: 16, width: BOOKLET_UI.thumbWidth });
    sheet.thumb.fire('click');
    // The docked pose, from the box it has now, then the open pose to grow to.
    expect(writes).toEqual([`translate(${16 - 160}px, ${16 - 100}px) scale(${BOOKLET_UI.thumbWidth / 400})`, 'translate(-50%, -50%)']);
  });

  it('re-settles the docked page when the window resizes', () => {
    const { sheet } = mount({ open: false });
    lay(sheet, { width: 500, left: 50, top: 60 }, { left: 16, top: 16, width: BOOKLET_UI.thumbWidth });
    dom.windowListeners.get('resize')!.forEach((fn) => fn({}));
    expect(sheet.element.style.transform).toBe(`translate(${16 - 50}px, ${16 - 60}px) scale(${BOOKLET_UI.thumbWidth / 500})`);
  });
});
