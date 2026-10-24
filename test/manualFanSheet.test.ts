import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, BOOKLET_UI, CLUSTER, FAN, GESTURE } from '../src/constants.js';
import { rowLength, spineEdges } from '../src/game/manualFan.js';
import { createManualFan } from '../src/ui/manualFan.js';
import type { FanWorld } from '../src/ui/manualFan.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.9.3, option B (Ben, 2026-10-23): the manuals' pocket on the fake DOM — the spine, the spread
// row, a pick, the folds. How its swipe and look feel on a phone is the manual plan.

let dom: FakeDom;
const mounted: { dispose(): void }[] = [];
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  for (const fan of mounted.splice(0)) fan.dispose();
  vi.unstubAllGlobals();
});

const sources = new Map<string, object>();
const source = (id: string) => {
  if (!sources.has(id)) sources.set(id, { cover: id });
  return sources.get(id)!;
};
const world = (id: string): FanWorld => ({ id, cover: () => source(id) as unknown as CanvasImageSource });
const coverHeight = Math.round((FAN.cover * BOOKLET.pageSize[1]) / BOOKLET.pageSize[0]);

function mount(ids: string[]) {
  let room = ids;
  const picks: string[] = [];
  const clears: string[] = [];
  const holds: [string, boolean][] = [];
  const fan = createManualFan({
    worlds: () => room.map(world),
    nameOf: (id) => id.toUpperCase(),
    onPick: (id) => picks.push(id),
    onClear: (id) => clears.push(id),
    onHold: (id, on) => holds.push([id, on]),
  });
  mounted.push(fan);
  const element = fan.element as unknown as FakeElement;
  dom.body.append(element);
  fan.refresh();
  const [spine, row] = element.children;
  return {
    fan,
    element,
    spine,
    row,
    covers: () => row.children,
    edges: () => spine.children,
    picks,
    clears,
    holds,
    setRoom(next: string[]) {
      room = next;
      fan.refresh();
    },
  };
}

const tap = (target: FakeElement, init: { dx?: number; dt?: number } = {}) => {
  target.fire('pointerdown', { clientX: 100, clientY: 20, timeStamp: 0 });
  target.fire('pointerup', { clientX: 100 + (init.dx ?? 0), clientY: 20, timeStamp: init.dt ?? 50 });
};

describe('the spine, at rest', () => {
  it('is absent only in an empty room, and shows from the first world on', () => {
    expect(mount([]).element.hidden).toBe(true);
    const lone = mount(['johnny']);
    expect(lone.element.hidden).toBe(false);
    expect(lone.edges()).toHaveLength(1);
    expect(lone.fan.expanded).toBe(false);
    expect(lone.element.dataset.expanded).toBe('false');
  });

  it("shows one edge per world, in the room's order, the open manual's last, on top and gold", () => {
    const { edges, spine } = mount(['johnny', 'blank', 'overkall']);
    expect(edges().map((e) => e.dataset.open)).toEqual(['false', 'false', 'true']);
    // Offset across the spine (left, upright).
    expect(edges().map((e) => e.style.left)).toEqual(spineEdges(3, BOOKLET_UI.strip.pocket, FAN).map((at) => `${at}px`));
    expect(spine.attributes['aria-label']).toBe('3 manuals in the room');
    expect(spine.attributes['aria-expanded']).toBe('false');
  });

  it('lays the edges down the spine (top) when the band stands on the right', () => {
    dom.rootStyle.dataset.strip = 'right';
    const { edges } = mount(['a', 'b']);
    expect(edges().map((e) => e.style.top)).toEqual(spineEdges(2, BOOKLET_UI.strip.pocket, FAN).map((at) => `${at}px`));
    expect(edges().map((e) => e.style.left)).toEqual(['', '']);
  });

  it('keeps the band one shape: the pocket\'s CSS is the band\'s end, upright and in landscape', () => {
    mount(['a']);
    const css = dom.head.children.map((node) => node.textContent).join('');
    expect(css).toContain(`width: calc(${BOOKLET_UI.strip.pocket}px + env(safe-area-inset-right));`);
    expect(css).toContain(`height: calc(${BOOKLET_UI.strip.pocket}px + env(safe-area-inset-bottom));`);
    // No timers, no auto-hide: two states only.
    expect(css).not.toContain('animation');
  });
});

describe('the row, spread', () => {
  it("shows one labelled cover per world in the room's order, drawn from each world's own cover, the open one marked and nearest the pocket", () => {
    const { covers, spine } = mount(['johnny', 'blank', 'overkall']);
    spine.fire('click');
    expect(covers().map((b) => b.dataset.id)).toEqual(['johnny', 'blank', 'overkall']);
    expect(covers().map((b) => b.attributes['aria-label'])).toEqual(['Switch to JOHNNY', 'Switch to BLANK', 'OVERKALL, open — hold to clear']);
    expect(covers().map((b) => b.attributes['aria-current'])).toEqual([undefined, undefined, 'true']);
    expect(covers().map((b) => (b.children[0] as FakeElement).drawn)).toEqual([source('johnny'), source('blank'), source('overkall')]);
  });

  it('a tap on the spine spreads it, picks nothing, and focuses the open manual\'s cover; a second folds', () => {
    const { fan, element, spine, covers, picks } = mount(['a', 'b', 'c']);
    spine.fire('click');
    expect(fan.expanded).toBe(true);
    expect(spine.attributes['aria-expanded']).toBe('true');
    expect(element.dataset.expanded).toBe('true');
    expect(picks).toEqual([]);
    expect(dom.focused).toBe(covers()[2]);
    spine.fire('click');
    expect(fan.expanded).toBe(false);
  });

  it('follows the slot: the picked world goes last, nearest the pocket, its edge on top', () => {
    const { covers, edges, setRoom } = mount(['johnny', 'blank']);
    setRoom(['blank', 'johnny']);
    expect(covers().map((b) => b.dataset.id)).toEqual(['blank', 'johnny']);
    expect(covers().map((b) => b.attributes['aria-current'])).toEqual([undefined, 'true']);
    expect(edges().map((e) => e.dataset.open)).toEqual(['false', 'true']);
  });

  it("adds a new world's cover and edge, and drops a cleared one", () => {
    const { covers, edges, setRoom, element } = mount(['a', 'b']);
    setRoom(['a', 'b', 'c']);
    expect(covers().map((b) => b.dataset.id)).toEqual(['a', 'b', 'c']);
    expect(edges()).toHaveLength(3);
    setRoom([]);
    expect(covers()).toHaveLength(0);
    expect(edges()).toHaveLength(0);
    expect(element.hidden).toBe(true);
  });
});

describe('picking', () => {
  it('picks the tapped cover once and folds', () => {
    const { fan, spine, covers, picks } = mount(['a', 'b', 'c']);
    spine.fire('click');
    tap(covers()[1]);
    expect(picks).toEqual(['b']);
    expect(fan.expanded).toBe(false);
    expect(spine.attributes['aria-expanded']).toBe('false');
  });

  it("a tap on the open manual's own cover only folds", () => {
    const { fan, spine, covers, picks } = mount(['a', 'b', 'c']);
    spine.fire('click');
    tap(covers()[2]);
    expect(picks).toEqual([]);
    expect(fan.expanded).toBe(false);
  });

  it('picks nothing after a swipe or a long press, and stays spread', () => {
    const { fan, spine, covers, picks } = mount(['a', 'b', 'c']);
    spine.fire('click');
    tap(covers()[1], { dx: GESTURE.tapMaxDistance + 1 });
    tap(covers()[1], { dt: GESTURE.tapMaxMs + 1 });
    expect(picks).toEqual([]);
    expect(fan.expanded).toBe(true);
  });

  it('drops a press the browser cancelled for a scroll', () => {
    const { spine, covers, picks } = mount(['a', 'b']);
    spine.fire('click');
    covers()[0].fire('pointerdown', { clientX: 100, clientY: 20 });
    covers()[0].fire('pointercancel');
    covers()[0].fire('pointerup', { clientX: 100, clientY: 20, timeStamp: 10 });
    expect(picks).toEqual([]);
  });

  it('picks nothing while folded', () => {
    const { covers, picks } = mount(['a', 'b']);
    tap(covers()[0]);
    expect(picks).toEqual([]);
  });

  it('picks from the keyboard (a click with no pointer), and not twice for a pointer', () => {
    const { spine, covers, picks } = mount(['a', 'b', 'c']);
    spine.fire('click');
    covers()[1].fire('click', { detail: 0 });
    expect(picks).toEqual(['b']);
    spine.fire('click');
    // A pointer's own click follows its pointerup and is not a second tap.
    covers()[0].fire('click', { detail: 1 });
    expect(picks).toEqual(['b']);
  });
});

describe('folding', () => {
  it('folds on Escape while spread, focus back on the spine', () => {
    const { fan, spine, covers } = mount(['a', 'b']);
    spine.fire('click');
    covers()[1].focus();
    vi.stubGlobal('document', { ...document, activeElement: covers()[1] });
    dom.key('Escape');
    expect(fan.expanded).toBe(false);
    expect(dom.focused).toBe(spine);
  });

  it('folds on a pointer down outside, not inside', () => {
    const { fan, spine, covers } = mount(['a', 'b', 'c']);
    spine.fire('click');
    covers()[1].fire('pointerdown');
    expect(fan.expanded).toBe(true);
    dom.body.fire('pointerdown');
    expect(fan.expanded).toBe(false);
  });

  // Ben's spec (2026-10-23): "Tap the gold cover, the room, or Escape: the row folds, nothing else."
  // The fake DOM has no capture phase, so this pins what the document's capture listener does to the
  // press and to the click after it; in a browser that runs before the canvas and the strip hear either.
  it('consumes the outside press that folds it, and swallows the click it ends in, once', () => {
    const { fan, spine } = mount(['a', 'b']);
    spine.fire('click');
    const press = { prevented: 0, stopped: 0 };
    const outside = (type: string, count = press) => dom.documentListeners.get(type)?.forEach((fn) => fn({ target: dom.body, preventDefault: () => count.prevented++, stopPropagation: () => count.stopped++ }));
    outside('pointerdown');
    expect(fan.expanded).toBe(false);
    expect(press).toEqual({ prevented: 1, stopped: 1 });
    const click = { prevented: 0, stopped: 0 };
    outside('click', click);
    expect(click).toEqual({ prevented: 1, stopped: 1 });
    // The next tap on the room is the room's again.
    const later = { prevented: 0, stopped: 0 };
    outside('pointerdown', later);
    outside('click', later);
    expect(later).toEqual({ prevented: 0, stopped: 0 });
  });

  it('disarms the swallow when the folding press never ends in a click (a drag)', () => {
    const { spine } = mount(['a', 'b']);
    spine.fire('click');
    const fire = (type: string, count: { n: number }) => dom.documentListeners.get(type)?.forEach((fn) => fn({ target: dom.body, preventDefault: () => count.n++, stopPropagation: () => undefined }));
    fire('pointerdown', { n: 0 });
    const next = { n: 0 };
    fire('pointerdown', next);
    fire('click', next);
    expect(next.n).toBe(0);
  });

  it('lets a press on the row or the spine through: they are its own', () => {
    const { fan, spine, covers } = mount(['a', 'b']);
    spine.fire('click');
    const count = { n: 0 };
    dom.documentListeners.get('pointerdown')?.forEach((fn) => fn({ target: covers()[0], preventDefault: () => count.n++, stopPropagation: () => count.n++ }));
    expect(count.n).toBe(0);
    expect(fan.expanded).toBe(true);
  });

  it('fold() puts it away, and does nothing folded', () => {
    const { fan, spine } = mount(['a', 'b']);
    spine.fire('click');
    fan.fold();
    expect(fan.expanded).toBe(false);
    fan.fold();
    expect(fan.expanded).toBe(false);
  });
});

describe('where the row lies', () => {
  function cluster(rect: FakeElement['rect']) {
    const element = new FakeElement('div', dom as never);
    element.className = 'control-cluster';
    element.rect = rect;
    dom.body.append(element);
    return element;
  }

  it('upright: right above the pocket, against the right edge, as long as its covers', () => {
    dom.viewport.width = 390;
    dom.viewport.height = 760;
    cluster({ left: CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 44 });
    const { spine, row } = mount(['a', 'b', 'c']);
    spine.rect = { left: 390 - 26, top: 760 - 142, width: 26, height: 142 };
    spine.fire('click');
    const width = rowLength(3, FAN);
    expect(row.style.width).toBe(`${width}px`);
    expect(row.style.left).toBe(`${390 - CLUSTER.inset - width}px`);
    expect(Number(row.style.top.replace('px', '')) + coverHeight).toBe(spine.rect.top - FAN.inset);
  });

  it('is held between the cluster and the edge when the row is longer, and re-measures on resize', () => {
    dom.viewport.width = 390;
    dom.viewport.height = 760;
    const menu = cluster({ left: CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 44 });
    const { spine, row } = mount(['a', 'b', 'c', 'd', 'e', 'f']);
    spine.rect = { left: 390 - 26, top: 760 - 142, width: 26, height: 142 };
    spine.fire('click');
    const start = CLUSTER.inset + 44 + FAN.inset;
    const room = 390 - CLUSTER.inset - start;
    expect(rowLength(6, FAN)).toBeGreaterThan(room);
    expect(row.style.width).toBe(`${room}px`);
    expect(row.style.left).toBe(`${start}px`);
    menu.rect = { ...menu.rect, width: 44 + 52 };
    dom.windowListeners.get('resize')?.forEach((fn) => fn({}));
    expect(row.style.width).toBe(`${room - 52}px`);
  });

  it('in landscape runs leftward from the band at the foot, and follows it on a turn end over end with no resize', () => {
    dom.viewport.width = 932;
    dom.viewport.height = 376;
    dom.rootStyle.dataset.strip = 'right';
    cluster({ left: 59 + CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 100 });
    const { spine, row } = mount(['a', 'b']);
    spine.rect = { left: 932 - 59 - 114, top: 376 - 26, width: 114, height: 26 };
    spine.fire('click');
    const width = rowLength(2, FAN);
    expect(row.style.left).toBe(`${spine.rect.left - FAN.inset - width}px`);
    expect(Number(row.style.top.replace('px', '')) + coverHeight).toBe(376 - CLUSTER.inset);
    // The notch moves to the other side: the band follows it through CSS, the window's size unchanged.
    spine.rect = { ...spine.rect, left: 932 - 114 };
    dom.rotate();
    expect(row.style.left).toBe(`${spine.rect.left - FAN.inset - width}px`);
  });
});

describe('dispose', () => {
  it('removes the element and the window and document listeners', () => {
    const { fan, element, spine } = mount(['a', 'b']);
    spine.fire('click');
    fan.dispose();
    expect(element.parent).toBeNull();
    for (const type of ['keydown', 'resize']) expect(dom.windowListeners.get(type)).toEqual([]);
    expect(dom.documentListeners.get('pointerdown')).toEqual([]);
    expect(dom.orientationListeners?.get('change')).toEqual([]);
  });
});

// 1.9.9.6 (Ben, 2026-10-23): a hold on the open cover clears the open item. One press, three outcomes:
// a tap folds, a cancel leaves the row spread, the full hold clears.
describe('the clear hold on the open cover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const press = (target: FakeElement, init: { x?: number; t?: number } = {}) => target.fire('pointerdown', { clientX: init.x ?? 100, clientY: 20, timeStamp: init.t ?? 0 });
  const lift = (target: FakeElement, init: { x?: number; t?: number } = {}) => target.fire('pointerup', { clientX: init.x ?? 100, clientY: 20, timeStamp: init.t ?? 50 });
  const badge = (cover: FakeElement) => cover.children.find((node) => node.className === 'manual-fan-badge');
  const key = (target: FakeElement, type: 'keydown' | 'keyup', init: { key?: string; t?: number; repeat?: boolean } = {}) => {
    let prevented = false;
    target.fire(type, { key: init.key ?? 'Enter', timeStamp: init.t ?? 0, repeat: init.repeat ?? false, preventDefault: () => (prevented = true) } as never);
    return prevented;
  };

  it('marks only the open cover with the X badge and the hold in its label, and moves the badge with the room', () => {
    const { covers, setRoom } = mount(['a', 'b']);
    expect(badge(covers()[1])).toBeDefined();
    expect(badge(covers()[1])!.attributes['aria-hidden']).toBe('true');
    expect(badge(covers()[0])).toBeUndefined();
    expect(covers()[1].attributes['aria-label']).toBe('B, open — hold to clear');
    setRoom(['b', 'a']);
    expect(covers().map((b) => b.dataset.id)).toEqual(['b', 'a']);
    expect(badge(covers()[0])).toBeUndefined();
    expect(badge(covers()[1])).toBeDefined();
  });

  it('a tap on the open cover folds and clears nothing; the hold began and ended', () => {
    const { fan, spine, covers, clears, holds } = mount(['a', 'b']);
    spine.fire('click');
    press(covers()[1]);
    expect(covers()[1].dataset.holding).toBe('true');
    lift(covers()[1], { t: 50 });
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual([]);
    expect(fan.expanded).toBe(false);
    expect(holds).toEqual([
      ['b', true],
      ['b', false],
    ]);
  });

  it('a release after the tap time is a cancel: nothing cleared, the row still spread, the border back', () => {
    const { fan, spine, covers, clears, holds, picks } = mount(['a', 'b']);
    spine.fire('click');
    press(covers()[1]);
    vi.advanceTimersByTime(GESTURE.tapMaxMs + 1);
    lift(covers()[1], { t: GESTURE.tapMaxMs + 1 });
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual([]);
    expect(picks).toEqual([]);
    expect(fan.expanded).toBe(true);
    expect(covers()[1].dataset.holding).toBe('false');
    expect(holds.at(-1)).toEqual(['b', false]);
  });

  it('the full hold clears the open item once and folds; the release after it does nothing more', () => {
    const { fan, spine, covers, clears, holds, picks } = mount(['a', 'b']);
    spine.fire('click');
    const open = covers()[1];
    press(open);
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual(['b']);
    expect(fan.expanded).toBe(false);
    expect(holds).toEqual([
      ['b', true],
      ['b', false],
    ]);
    lift(open, { t: FAN.clearHoldMs + 10 });
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual(['b']);
    expect(picks).toEqual([]);
  });

  it('a hold on a kept cover never clears and never dims', () => {
    const { spine, covers, clears, holds } = mount(['a', 'b']);
    spine.fire('click');
    press(covers()[0]);
    vi.advanceTimersByTime(FAN.clearHoldMs * 2);
    lift(covers()[0], { t: FAN.clearHoldMs * 2 });
    expect(clears).toEqual([]);
    expect(holds).toEqual([]);
    expect(covers()[0].dataset.holding).toBeUndefined();
  });

  it('holds nothing while folded', () => {
    const { covers, clears, holds } = mount(['a', 'b']);
    press(covers()[1]);
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual([]);
    expect(holds).toEqual([]);
  });

  it('a move past the tap distance during the hold is a swipe: it stops, nothing clears, the row stays spread', () => {
    const { fan, spine, covers, clears, holds } = mount(['a', 'b']);
    spine.fire('click');
    press(covers()[1]);
    covers()[1].fire('pointermove', { clientX: 100 + GESTURE.tapMaxDistance + 1, clientY: 20 });
    expect(holds.at(-1)).toEqual(['b', false]);
    vi.advanceTimersByTime(FAN.clearHoldMs);
    lift(covers()[1], { x: 100 + GESTURE.tapMaxDistance + 1, t: FAN.clearHoldMs });
    expect(clears).toEqual([]);
    expect(fan.expanded).toBe(true);
  });

  it('a browser-cancelled press stops the hold', () => {
    const { spine, covers, clears, holds } = mount(['a', 'b']);
    spine.fire('click');
    press(covers()[1]);
    covers()[1].fire('pointercancel');
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual([]);
    expect(holds.at(-1)).toEqual(['b', false]);
  });

  it('fold() and Escape during a hold stop it and undim', () => {
    for (const how of ['fold', 'escape'] as const) {
      const { fan, spine, covers, clears, holds } = mount(['a', 'b']);
      spine.fire('click');
      press(covers()[1]);
      if (how === 'fold') fan.fold();
      else dom.key('Escape');
      expect(holds.at(-1)).toEqual(['b', false]);
      vi.advanceTimersByTime(FAN.clearHoldMs);
      expect(clears).toEqual([]);
    }
  });

  it('dispose during a hold stops it', () => {
    const { fan, spine, covers, clears, holds } = mount(['a', 'b']);
    spine.fire('click');
    press(covers()[1]);
    fan.dispose();
    vi.advanceTimersByTime(FAN.clearHoldMs);
    expect(clears).toEqual([]);
    expect(holds.at(-1)).toEqual(['b', false]);
  });

  it("turns the border red only after the tap time, snaps it back, and still runs no animation", () => {
    mount(['a']);
    const css = dom.head.children.map((node) => node.textContent).join('');
    expect(css).toContain(`border-color ${FAN.clearHoldMs}ms linear ${GESTURE.tapMaxMs}ms`);
    expect(css).toContain(`stroke-dashoffset ${FAN.clearHoldMs}ms linear ${GESTURE.tapMaxMs}ms`);
    expect(css).toContain(`width: ${FAN.badge}px;`);
    expect(css).not.toContain('animation');
  });

  describe('from the keyboard', () => {
    it('Enter held for the hold clears once; its keydown is prevented, so the browser makes no click of it', () => {
      const { fan, spine, covers, clears } = mount(['a', 'b']);
      spine.fire('click');
      expect(key(covers()[1], 'keydown')).toBe(true);
      // The key repeats while held: no second hold.
      key(covers()[1], 'keydown', { repeat: true, t: 500 });
      vi.advanceTimersByTime(FAN.clearHoldMs);
      expect(clears).toEqual(['b']);
      expect(fan.expanded).toBe(false);
    });

    it('a key held to half and let go is a cancel: nothing cleared, still spread; its click does not fold', () => {
      const { fan, spine, covers, clears } = mount(['a', 'b']);
      spine.fire('click');
      key(covers()[1], 'keydown', { key: ' ' });
      vi.advanceTimersByTime(FAN.clearHoldMs / 2);
      key(covers()[1], 'keyup', { key: ' ', t: FAN.clearHoldMs / 2 });
      covers()[1].fire('click', { detail: 0 });
      vi.advanceTimersByTime(FAN.clearHoldMs);
      expect(clears).toEqual([]);
      expect(fan.expanded).toBe(true);
    });

    it('a quick key press on the open cover folds, as a tap does', () => {
      const { fan, spine, covers, clears } = mount(['a', 'b']);
      spine.fire('click');
      key(covers()[1], 'keydown');
      key(covers()[1], 'keyup', { t: 80 });
      expect(fan.expanded).toBe(false);
      expect(clears).toEqual([]);
    });

    it('leaves a kept cover\'s keys to the browser: no hold, and its click picks', () => {
      const { spine, covers, picks, holds } = mount(['a', 'b']);
      spine.fire('click');
      expect(key(covers()[0], 'keydown')).toBe(false);
      covers()[0].fire('click', { detail: 0 });
      expect(holds).toEqual([]);
      expect(picks).toEqual(['a']);
    });
  });
});
