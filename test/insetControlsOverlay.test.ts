import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GESTURE, INSET } from '../src/constants.js';
import { arcLength } from '../src/game/turnRing.js';
import { ringGeometry } from '../src/game/insetControls.js';
import { createInsetControls } from '../src/ui/insetControls.js';

// The real inset controls (src/ui/insetControls.ts) on a minimal fake DOM (1.10.0.2 step 5): what they draw for the
// look they are given, and what the gestures made on them report. How they look and grab on a phone is manual.

type Listener = (event: object) => void;

class FakeElement {
  tag: string;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  textContent = '';
  declare id?: string; // set on the style element
  captured: number[] = [];

  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  fire(type: string, init: object = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, pointerId: 1, target: this, ...init });
  }
  all(className: string): FakeElement[] {
    return this.children.flatMap((child) => [...((child.attributes.class ?? '').split(' ').includes(className) ? [child] : []), ...child.all(className)]);
  }
}

let head: FakeElement;
let body: FakeElement;

beforeEach(() => {
  head = new FakeElement('head');
  body = new FakeElement('body');
  vi.stubGlobal('document', {
    head,
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
  });
});
afterEach(() => vi.unstubAllGlobals());

const { ring, arrow } = INSET.controls;

function mount() {
  const turns: number[] = [];
  const calls = { push: 0, pull: 0 };
  const controls = createInsetControls(body as unknown as HTMLElement, { onTurn: (r) => turns.push(r), onPush: () => calls.push++, onPull: () => calls.pull++ });
  const svg = body.children[0];
  const turn = svg.all('inset-controls__turn')[0];
  const push = svg.all('inset-controls__push')[0];
  const heads = turn.all('inset-controls__head');
  const total = () => turns.reduce((sum, r) => sum + r, 0);
  return { controls, svg, turn, push, heads, turns, calls, total };
}

const lookTurn = (over = {}) => ({ progress: 0, tighten: true, loosen: true, ...over });
const CENTRE: [number, number] = [200, 300];
// The inset's circle, which the ring encircles.
const FRAME = { centre: CENTRE, radius: 80 };
const RING = ringGeometry(FRAME);
const onRing = (degrees: number, r: number = RING.radius) => ({ clientX: CENTRE[0] + r * Math.cos((degrees * Math.PI) / 180), clientY: CENTRE[1] + r * Math.sin((degrees * Math.PI) / 180) });

function sweep(turn: FakeElement, from: number, to: number) {
  turn.fire('pointerdown', onRing(from));
  const step = Math.sign(to - from) * 10;
  for (let d = from + step; step > 0 ? d <= to : d >= to; d += step) turn.fire('pointermove', onRing(d));
  turn.fire('pointerup', onRing(to));
}

describe('the inset controls overlay', () => {
  it('starts hidden, with neither control shown, and keeps out of the accessibility tree', () => {
    const { svg, turn, push } = mount();
    expect(svg.tag).toBe('svg');
    expect(svg.hasAttribute('hidden')).toBe(true);
    expect(svg.attributes['aria-hidden']).toBe('true');
    expect(turn.hasAttribute('hidden') && push.hasAttribute('hidden')).toBe(true);
  });

  it('is invisible to the pointer itself, and takes it on its two controls only', () => {
    mount();
    const css = head.children[0].textContent;
    expect(css).toMatch(/\.inset-controls \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.inset-controls__control \{[^}]*pointer-events: auto/);
  });

  it('goes inert while a press is on the canvas, so nothing under the finger takes its moves', () => {
    const { controls, svg } = mount();
    controls.setInert(true);
    expect(svg.attributes['data-inert']).toBe('true');
    expect(head.children[0].textContent).toMatch(/\[data-inert='true'\] \.inset-controls__control \{[^}]*pointer-events: none/);
    controls.setInert(false);
    expect(svg.attributes['data-inert']).toBe('false');
  });

  describe('the turn ring', () => {
    it('encircles the circle: centred on it, its line just outside the rim, the arc at the progress, the arrow away', () => {
      const { controls, svg, turn, push } = mount();
      controls.showTurn(FRAME, lookTurn({ progress: 0.25 }));
      expect(svg.hasAttribute('hidden')).toBe(false);
      expect(turn.hasAttribute('hidden')).toBe(false);
      expect(push.hasAttribute('hidden')).toBe(true);
      expect(turn.attributes.transform).toBe('translate(200 300)');
      const radius = FRAME.radius + ring.gap;
      expect(turn.all('inset-controls__track')[0].attributes.r).toBe(String(radius));
      const arc = turn.all('inset-controls__arc')[0];
      expect(arc.attributes.r).toBe(String(radius));
      expect(Number(arc.attributes['stroke-dasharray'].split(' ')[0])).toBeCloseTo(arcLength(0.25, radius), 6);
    });

    it('draws in the manual’s style: ink line art with open chevrons for arrowheads, the green only on the arc', () => {
      mount();
      const css = head.children[0].textContent;
      expect(css).toMatch(/\.inset-controls__head \{[^}]*fill: none[^}]*stroke: #1c1c1c/);
      expect(css).toMatch(/\.inset-controls__track \{[^}]*stroke: #1c1c1c/);
      expect(css).toMatch(/\.inset-controls__arc \{[^}]*stroke: #2e9e4f/);
    });

    it('grows with the circle and follows it', () => {
      const { controls, turn } = mount();
      controls.showTurn({ centre: [500, 400], radius: 120 }, lookTurn());
      expect(turn.attributes.transform).toBe('translate(500 400)');
      expect(turn.all('inset-controls__track')[0].attributes.r).toBe(String(120 + ring.gap));
    });

    it('grabs on a transparent stroke over the band outside the rim, so the circle inside is untouched', () => {
      const { controls, turn } = mount();
      controls.showTurn(FRAME, lookTurn());
      const grab = turn.all('inset-controls__grab')[0];
      const mid = (RING.inner + RING.outer) / 2;
      expect(Number(grab.attributes.r)).toBeCloseTo(mid, 6);
      expect(Number(grab.attributes['stroke-width'])).toBeCloseTo(RING.outer - RING.inner, 6);
      expect(Number(grab.attributes.r) - Number(grab.attributes['stroke-width']) / 2).toBeGreaterThanOrEqual(FRAME.radius);
      expect(head.children[0].textContent).toMatch(/\.inset-controls__grab \{[^}]*fill: none[^}]*stroke: transparent/);
    });

    it('hides each arrowhead whose way is at its stop', () => {
      const { controls, heads } = mount();
      const [tighten, loosen] = heads;
      controls.showTurn(FRAME, lookTurn());
      expect([tighten.hasAttribute('hidden'), loosen.hasAttribute('hidden')]).toEqual([false, false]);
      controls.showTurn(FRAME, lookTurn({ progress: 1, tighten: false }));
      expect([tighten.hasAttribute('hidden'), loosen.hasAttribute('hidden')]).toEqual([true, false]);
      controls.showTurn(FRAME, lookTurn({ loosen: false }));
      expect([tighten.hasAttribute('hidden'), loosen.hasAttribute('hidden')]).toEqual([false, true]);
    });

    it('a clockwise quarter turn reports positive radians summing to about a quarter turn', () => {
      const { controls, turn, turns, total } = mount();
      controls.showTurn(FRAME, lookTurn());
      sweep(turn, 0, 90);
      expect(turns.every((r) => r > 0)).toBe(true);
      expect(total()).toBeCloseTo(Math.PI / 2, 1);
      expect(turn.captured).toEqual([1]);
    });

    it('anticlockwise reports negative radians', () => {
      const { controls, turn, turns, total } = mount();
      controls.showTurn(FRAME, lookTurn());
      sweep(turn, 0, -90);
      expect(turns.every((r) => r < 0)).toBe(true);
      expect(total()).toBeCloseTo(-Math.PI / 2, 1);
    });

    it('turns only from a press on the band: one inside the circle, or past the band, does nothing', () => {
      const { controls, turn, turns } = mount();
      controls.showTurn(FRAME, lookTurn());
      for (const start of [onRing(0, 0), onRing(0, FRAME.radius - 2), onRing(0, RING.outer + 4)]) {
        turn.fire('pointerdown', start);
        turn.fire('pointermove', onRing(40));
        turn.fire('pointermove', onRing(80));
        turn.fire('pointerup', onRing(80));
      }
      expect(turns).toEqual([]);
      expect(turn.captured).toEqual([]);
      sweep(turn, 0, 30);
      expect(turns.length).toBeGreaterThan(0);
    });

    it('reports nothing once the finger has lifted, and nothing for a press with no sweep', () => {
      const { controls, turn, turns } = mount();
      controls.showTurn(FRAME, lookTurn());
      turn.fire('pointerdown', onRing(0));
      turn.fire('pointerup', onRing(0));
      turn.fire('pointermove', onRing(40));
      expect(turns).toEqual([]);
    });

    it('sweeps about the circle’s centre, wherever it was last shown', () => {
      const { controls, turn, total } = mount();
      const moved = { centre: [500, 500] as [number, number], radius: 80 };
      controls.showTurn(moved, lookTurn());
      const r = ringGeometry(moved).radius;
      turn.fire('pointerdown', { clientX: 500 + r, clientY: 500 });
      turn.fire('pointermove', { clientX: 500, clientY: 500 + r });
      expect(total()).toBeCloseTo(Math.PI / 2, 5);
    });
  });

  describe('the push arrow', () => {
    it('shows black with its head in while seated, the ring away', () => {
      const { controls, turn, push } = mount();
      controls.showPush(CENTRE, { seated: false, head: 'in' });
      expect(push.hasAttribute('hidden')).toBe(false);
      expect(turn.hasAttribute('hidden')).toBe(true);
      expect(push.attributes['data-seated']).toBe('false');
      expect(push.attributes.transform).toBe('translate(200 300)');
    });

    it('shows green with its head flipped once pressed home', () => {
      const { controls, push } = mount();
      controls.showPush(CENTRE, { seated: true, head: 'out' });
      expect(push.attributes['data-seated']).toBe('true');
      expect(push.attributes.transform).toContain('scale(1 -1)');
      expect(head.children[0].textContent).toMatch(/data-seated='true'\] \.inset-controls__shaft/);
    });

    it('a tap calls onPush while the head is in, onPull once it is out', () => {
      const { controls, push, calls } = mount();
      controls.showPush(CENTRE, { seated: false, head: 'in' });
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointerup', { clientX: 200, clientY: 300 });
      expect(calls).toEqual({ push: 1, pull: 0 });
      controls.showPush(CENTRE, { seated: true, head: 'out' });
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointerup', { clientX: 201, clientY: 301 });
      expect(calls).toEqual({ push: 1, pull: 1 });
    });

    it('a press that moves past the tap distance calls nothing, and nor does a cancelled one', () => {
      const { controls, push, calls } = mount();
      controls.showPush(CENTRE, { seated: false, head: 'in' });
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointerup', { clientX: 200, clientY: 300 + GESTURE.tapMaxDistance + 5 });
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointercancel', {});
      push.fire('pointerup', { clientX: 200, clientY: 300 });
      expect(calls).toEqual({ push: 0, pull: 0 });
    });

    it('a pointerup with no press before it calls nothing', () => {
      const { controls, push, calls } = mount();
      controls.showPush(CENTRE, { seated: false, head: 'in' });
      push.fire('pointerup', { clientX: 200, clientY: 300 });
      expect(calls.push).toBe(0);
    });

    it('draws a hit box wider than the arrow itself, from constants', () => {
      const { push } = mount();
      const grab = push.all('inset-controls__hit')[0];
      expect(Number(grab.attributes.width)).toBe(Math.max(arrow.width, arrow.head) + 2 * arrow.band);
    });
  });

  it('hide() hides the whole overlay', () => {
    const { controls, svg } = mount();
    controls.showTurn(FRAME, lookTurn());
    controls.hide();
    expect(svg.hasAttribute('hidden')).toBe(true);
  });
});
