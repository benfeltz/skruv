import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUSTER, FAN, GESTURE } from '../src/constants.js';
import { fanWidth } from '../src/game/manualFan.js';
import { createManualFan } from '../src/ui/manualFan.js';
import type { FanWorld } from '../src/ui/manualFan.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.9.3: the manual fan on the fake DOM — hidden, folded, spread, a pick, the folds. How its swipe
// and look feel on a phone is the manual plan.

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

function mount(ids: string[]) {
  let room = ids;
  const picks: string[] = [];
  const fan = createManualFan({ worlds: () => room.map(world), nameOf: (id) => id.toUpperCase(), onPick: (id) => picks.push(id) });
  mounted.push(fan);
  const element = fan.element as unknown as FakeElement;
  dom.body.append(element);
  fan.refresh();
  const buttons = () => element.children[0].children;
  return {
    fan,
    element,
    buttons,
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

describe('what the fan shows', () => {
  it('is hidden with no world, and shows one cover for one', () => {
    expect(mount([]).element.hidden).toBe(true);
    const lone = mount(['johnny']);
    expect(lone.element.hidden).toBe(false);
    expect(lone.buttons().map((b) => b.dataset.id)).toEqual(['johnny']);
    expect(lone.buttons()[0].style.transform).toBe('translateX(0px) rotate(0deg)');
  });

  it('shows one labelled cover per world, the active one marked, the group counting them all', () => {
    const { element, buttons } = mount(['johnny', 'blank', 'overkall']);
    expect(buttons().map((b) => b.dataset.id)).toEqual(['johnny', 'blank', 'overkall']);
    expect(buttons().map((b) => b.attributes['aria-label'])).toEqual(['Switch to JOHNNY', 'Switch to BLANK', 'OVERKALL, open']);
    expect(buttons().map((b) => b.attributes['aria-current'])).toEqual([undefined, undefined, 'true']);
    expect(element.attributes['aria-label']).toBe('Switch item: 3 manuals');
  });

  it('draws each cover from that world\'s own cover', () => {
    const { buttons } = mount(['johnny', 'blank', 'overkall']);
    expect(buttons().map((b) => (b.children[0] as FakeElement).drawn)).toEqual([source('johnny'), source('blank'), source('overkall')]);
  });

  it('folds covers into a tilted stack with the active one on top, one tab stop', () => {
    const { buttons } = mount(['a', 'b', 'c']);
    expect(buttons().map((b) => b.style.transform)).toEqual([
      `translateX(0px) rotate(${-FAN.tilt}deg)`,
      `translateX(${FAN.step}px) rotate(${FAN.tilt}deg)`,
      `translateX(${2 * FAN.step}px) rotate(${-FAN.tilt}deg)`,
    ]);
    expect(buttons().map((b) => b.style.zIndex)).toEqual(['0', '1', '3']);
    expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('does not re-arrange the covers when another world goes active: only the one on top changes', () => {
    const { buttons, setRoom } = mount(['johnny', 'blank']);
    expect(buttons().map((b) => b.style.zIndex)).toEqual(['0', '2']);
    // The slot puts the picked world last.
    setRoom(['blank', 'johnny']);
    expect(buttons().map((b) => b.dataset.id)).toEqual(['johnny', 'blank']);
    expect(buttons().map((b) => b.style.zIndex)).toEqual(['2', '1']);
    expect(buttons().map((b) => b.attributes['aria-current'])).toEqual(['true', undefined]);
  });

  it('adds a new world\'s cover at the end, and drops a cleared one', () => {
    const { buttons, setRoom, element } = mount(['a', 'b']);
    setRoom(['a', 'b', 'c']);
    expect(buttons().map((b) => b.dataset.id)).toEqual(['a', 'b', 'c']);
    setRoom([]);
    expect(buttons()).toHaveLength(0);
    expect(element.hidden).toBe(true);
  });
});

describe('spreading and picking', () => {
  it('spreads on a tap on the folded stack, picks nothing, and focuses the open manual\'s cover', () => {
    const { fan, element, buttons, picks } = mount(['a', 'b', 'c']);
    tap(buttons()[1]);
    expect(fan.expanded).toBe(true);
    expect(element.attributes['aria-expanded']).toBe('true');
    expect(element.dataset.expanded).toBe('true');
    expect(picks).toEqual([]);
    expect(dom.focused).toBe(buttons()[2]);
    const pitch = FAN.cover + FAN.gap;
    expect(buttons().map((b) => b.style.transform)).toEqual(['translateX(0px) rotate(0deg)', `translateX(${pitch}px) rotate(0deg)`, `translateX(${2 * pitch}px) rotate(0deg)`]);
  });

  it('picks the tapped cover once and folds', () => {
    const { fan, element, buttons, picks } = mount(['a', 'b', 'c']);
    tap(buttons()[0]);
    tap(buttons()[1]);
    expect(picks).toEqual(['b']);
    expect(fan.expanded).toBe(false);
    expect(element.attributes['aria-expanded']).toBe('false');
  });

  it('a tap on the open manual\'s own cover only folds', () => {
    const { fan, buttons, picks } = mount(['a', 'b', 'c']);
    tap(buttons()[0]);
    tap(buttons()[2]);
    expect(picks).toEqual([]);
    expect(fan.expanded).toBe(false);
  });

  it('picks nothing after a swipe, and stays spread', () => {
    const { fan, buttons, picks } = mount(['a', 'b', 'c']);
    tap(buttons()[0]);
    tap(buttons()[1], { dx: GESTURE.tapMaxDistance + 1 });
    expect(picks).toEqual([]);
    expect(fan.expanded).toBe(true);
  });

  it('does not spread on a swipe or a long press', () => {
    const { fan, buttons } = mount(['a', 'b']);
    tap(buttons()[0], { dx: GESTURE.tapMaxDistance + 1 });
    tap(buttons()[0], { dt: GESTURE.tapMaxMs + 1 });
    expect(fan.expanded).toBe(false);
  });

  it('drops a press the browser cancelled for a scroll', () => {
    const { fan, buttons } = mount(['a', 'b']);
    buttons()[0].fire('pointerdown', { clientX: 100, clientY: 20 });
    buttons()[0].fire('pointercancel');
    buttons()[0].fire('pointerup', { clientX: 100, clientY: 20, timeStamp: 10 });
    expect(fan.expanded).toBe(false);
  });

  it('spreads and picks from the keyboard (a click with no pointer)', () => {
    const { fan, buttons, picks } = mount(['a', 'b', 'c']);
    buttons()[2].fire('click', { detail: 0 });
    expect(fan.expanded).toBe(true);
    buttons()[1].fire('click', { detail: 0 });
    expect(picks).toEqual(['b']);
    // A pointer's own click follows its pointerup and is not a second tap.
    buttons()[0].fire('click', { detail: 1 });
    expect(picks).toEqual(['b']);
  });
});

describe('folding', () => {
  it('folds on Escape while spread', () => {
    const { fan, buttons } = mount(['a', 'b']);
    tap(buttons()[0]);
    dom.key('Escape');
    expect(fan.expanded).toBe(false);
  });

  it('folds on a pointer down outside, not inside', () => {
    const { fan, buttons } = mount(['a', 'b', 'c']);
    tap(buttons()[0]);
    buttons()[1].fire('pointerdown');
    expect(fan.expanded).toBe(true);
    dom.body.fire('pointerdown');
    expect(fan.expanded).toBe(false);
  });

  it('fold() puts it away, and does nothing folded', () => {
    const { fan, buttons } = mount(['a', 'b']);
    tap(buttons()[0]);
    fan.fold();
    expect(fan.expanded).toBe(false);
    fan.fold();
    expect(fan.expanded).toBe(false);
  });
});

describe('where it lies', () => {
  // Portrait 390 wide: the menu upper left, the catalog's thumb beside it, the band along the bottom.
  function measure(width = 72) {
    dom.viewport.width = 390;
    dom.viewport.height = 760;
    const cluster = new FakeElement('div', dom as never);
    cluster.className = 'control-cluster';
    cluster.rect = { left: CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 44 };
    const thumb = new FakeElement('button', dom as never);
    thumb.className = 'booklet-thumb';
    thumb.dataset.corner = 'topLeft';
    thumb.rect = { left: CLUSTER.inset + 44 + CLUSTER.gap, top: 16, width, height: 100 };
    const strip = new FakeElement('div', dom as never);
    strip.className = 'booklet-strip';
    strip.rect = { left: 0, top: 636, width: 390, height: 124 };
    dom.body.append(cluster, thumb, strip);
    return { cluster, thumb, strip };
  }
  const edge = 390 - CLUSTER.inset;

  it('lies against the manual\'s side (the right edge upright), as wide as the stack folded', () => {
    measure();
    const { element } = mount(['a', 'b', 'c']);
    const width = fanWidth(3, false, FAN);
    expect(element.style.width).toBe(`${width}px`);
    expect(element.style.left).toBe(`${edge - width}px`);
    expect(element.style.top).toBe(`${CLUSTER.inset}px`);
  });

  it('spreads leftward, held between the catalog\'s thumb and the edge when the row is wider, and re-measures on resize', () => {
    const { thumb } = measure();
    const { element, buttons } = mount(['a', 'b', 'c', 'd', 'e', 'f']);
    tap(buttons()[0]);
    const start = thumb.rect.left + thumb.rect.width + FAN.inset;
    const room = edge - start;
    expect(fanWidth(6, true, FAN)).toBeGreaterThan(room);
    expect(element.style.width).toBe(`${room}px`);
    expect(element.style.left).toBe(`${start}px`);
    thumb.rect = { ...thumb.rect, left: thumb.rect.left + 40 };
    dom.windowListeners.get('resize')?.forEach((fn) => fn({}));
    expect(element.style.width).toBe(`${room - 40}px`);
  });

  it('stops short of a band that runs down the right edge, and follows it on a turn end over end with no resize', () => {
    dom.viewport.width = 932;
    dom.viewport.height = 376;
    const cluster = new FakeElement('div', dom as never);
    cluster.className = 'control-cluster';
    cluster.rect = { left: 59 + CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 100 };
    const strip = new FakeElement('div', dom as never);
    strip.className = 'booklet-strip';
    strip.rect = { left: 932 - 59 - 124, top: 0, width: 124, height: 376 };
    dom.body.append(cluster, strip);
    const { element } = mount(['a', 'b']);
    const width = fanWidth(2, false, FAN);
    expect(element.style.left).toBe(`${strip.rect.left - FAN.inset - width}px`);
    // The notch moves to the other side: the band follows it through CSS, the window's size unchanged.
    strip.rect = { ...strip.rect, left: 932 - 124 };
    dom.rotate();
    expect(element.style.left).toBe(`${strip.rect.left - FAN.inset - width}px`);
  });
});

describe('dispose', () => {
  it('removes the element and the window and document listeners', () => {
    const { fan, element, buttons } = mount(['a', 'b']);
    tap(buttons()[0]);
    fan.dispose();
    expect(element.parent).toBeNull();
    for (const type of ['keydown', 'resize']) expect(dom.windowListeners.get(type)).toEqual([]);
    expect(dom.documentListeners.get('pointerdown')).toEqual([]);
    expect(dom.orientationListeners?.get('change')).toEqual([]);
  });
});
