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
  const fan = createManualFan({ worlds: () => room.map(world), nameOf: (id) => id.toUpperCase(), onPick: (id) => picks.push(id) });
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
    expect(covers().map((b) => b.attributes['aria-label'])).toEqual(['Switch to JOHNNY', 'Switch to BLANK', 'OVERKALL, open']);
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
