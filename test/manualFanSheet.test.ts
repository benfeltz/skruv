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
  it('is hidden with no world and with one', () => {
    expect(mount([]).element.hidden).toBe(true);
    expect(mount(['johnny']).element.hidden).toBe(true);
  });

  it('shows one labelled cover per kept world and none for the active one', () => {
    const { element, buttons } = mount(['johnny', 'blank', 'overkall']);
    expect(element.hidden).toBe(false);
    expect(buttons().map((b) => b.dataset.id)).toEqual(['johnny', 'blank']);
    expect(buttons().map((b) => b.attributes['aria-label'])).toEqual(['Switch to JOHNNY', 'Switch to BLANK']);
    expect(element.attributes['aria-label']).toBe('Switch item: 2 manuals');
  });

  it('draws each cover from that world\'s own cover', () => {
    const { buttons } = mount(['johnny', 'blank', 'overkall']);
    expect(buttons().map((b) => (b.children[0] as FakeElement).drawn)).toEqual([source('johnny'), source('blank')]);
  });

  it('folds covers into a tilted stack, one tab stop', () => {
    const { buttons } = mount(['a', 'b', 'c', 'd']);
    expect(buttons().map((b) => b.style.transform)).toEqual([
      `translateX(0px) rotate(${-FAN.tilt}deg)`,
      `translateX(${FAN.step}px) rotate(${FAN.tilt}deg)`,
      `translateX(${2 * FAN.step}px) rotate(${-FAN.tilt}deg)`,
    ]);
    expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it('shows the other cover after the picked world went active', () => {
    const { buttons, setRoom } = mount(['johnny', 'blank']);
    expect(buttons().map((b) => b.dataset.id)).toEqual(['johnny']);
    setRoom(['blank', 'johnny']);
    expect(buttons().map((b) => b.dataset.id)).toEqual(['blank']);
  });

  it('hides again when the room is cleared', () => {
    const { element, setRoom } = mount(['a', 'b']);
    setRoom([]);
    expect(element.hidden).toBe(true);
  });
});

describe('spreading and picking', () => {
  it('spreads on a tap on the folded stack and picks nothing', () => {
    const { fan, element, buttons, picks } = mount(['a', 'b', 'c']);
    tap(buttons()[1]);
    expect(fan.expanded).toBe(true);
    expect(element.attributes['aria-expanded']).toBe('true');
    expect(element.dataset.expanded).toBe('true');
    expect(picks).toEqual([]);
    expect(dom.focused).toBe(buttons()[0]);
    expect(buttons().map((b) => b.style.transform)).toEqual(['translateX(0px) rotate(0deg)', `translateX(${FAN.cover + FAN.gap}px) rotate(0deg)`]);
  });

  it('picks the tapped cover once and folds', () => {
    const { fan, element, buttons, picks } = mount(['a', 'b', 'c']);
    tap(buttons()[0]);
    tap(buttons()[1]);
    expect(picks).toEqual(['b']);
    expect(fan.expanded).toBe(false);
    expect(element.attributes['aria-expanded']).toBe('false');
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
    buttons()[0].fire('click', { detail: 0 });
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
  function measure(width: number) {
    dom.viewport.width = 390;
    dom.viewport.height = 760;
    const cluster = new FakeElement('div', dom as never);
    cluster.className = 'control-cluster';
    cluster.rect = { left: CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 44 };
    const thumb = new FakeElement('button', dom as never);
    thumb.className = 'booklet-thumb';
    thumb.dataset.corner = 'topLeft';
    thumb.rect = { left: 390 - 16 - width, top: 16, width, height: 100 };
    dom.body.append(cluster, thumb);
    return thumb;
  }

  it('follows the measured cluster and thumb, as wide as the stack folded', () => {
    measure(72);
    const { element } = mount(['a', 'b', 'c']);
    expect(element.style.left).toBe(`${CLUSTER.inset + 44 + FAN.inset}px`);
    expect(element.style.top).toBe(`${CLUSTER.inset}px`);
    expect(element.style.width).toBe(`${fanWidth(2, false, FAN)}px`);
  });

  it('is held to the room between them when the spread row is wider, and re-measures on resize', () => {
    const thumb = measure(72);
    const { fan, element, buttons } = mount(['a', 'b', 'c', 'd', 'e', 'f']);
    tap(buttons()[0]);
    const room = 390 - 16 - 72 - FAN.inset - (CLUSTER.inset + 44 + FAN.inset);
    expect(fanWidth(5, true, FAN)).toBeGreaterThan(room);
    expect(element.style.width).toBe(`${room}px`);
    thumb.rect = { ...thumb.rect, left: thumb.rect.left + 40 };
    dom.windowListeners.get('resize')?.forEach((fn) => fn({}));
    expect(element.style.width).toBe(`${room + 40}px`);
    expect(fan.expanded).toBe(true);
  });
});

describe('a turn end over end (a landscape phone, the notch changing sides)', () => {
  it('re-places the fan beside the moved cluster on the orientation change, with no resize', () => {
    dom.viewport.width = 932;
    dom.viewport.height = 376;
    const cluster = new FakeElement('div', dom as never);
    cluster.className = 'control-cluster';
    cluster.rect = { left: 59 + CLUSTER.inset, top: CLUSTER.inset, width: 44, height: 44 };
    dom.body.append(cluster);
    const { element } = mount(['a', 'b']);
    expect(element.style.left).toBe(`${59 + CLUSTER.inset + 44 + FAN.inset}px`);
    // The notch moves to the other side: the cluster follows it through CSS, the window's size unchanged.
    cluster.rect = { ...cluster.rect, left: CLUSTER.inset };
    dom.rotate();
    expect(element.style.left).toBe(`${CLUSTER.inset + 44 + FAN.inset}px`);
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
