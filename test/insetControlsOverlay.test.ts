import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKLET, GESTURE, INSET } from '../src/constants.js';
import { arcLength } from '../src/game/turnRing.js';
import { bubbleOf, bubbleTail } from '../src/game/insetControls.js';
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

const { mark } = INSET.controls;

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
// The inset's circle, and the sub-bubble the controls attach to it.
const FRAME = { centre: [200, 300] as [number, number], radius: 80 };
const BUBBLE = bubbleOf(FRAME);
const CENTRE = BUBBLE.centre;
const onBubble = (degrees: number, r: number = BUBBLE.radius * mark.radius) => ({
  clientX: CENTRE[0] + r * Math.cos((degrees * Math.PI) / 180),
  clientY: CENTRE[1] + r * Math.sin((degrees * Math.PI) / 180),
});

function sweep(turn: FakeElement, from: number, to: number) {
  turn.fire('pointerdown', onBubble(from));
  const step = Math.sign(to - from) * 10;
  for (let d = from + step; step > 0 ? d <= to : d >= to; d += step) turn.fire('pointermove', onBubble(d));
  turn.fire('pointerup', onBubble(to));
}

describe('the inset controls overlay', () => {
  it('starts hidden, with neither control shown, and keeps out of the accessibility tree', () => {
    const { svg, turn, push } = mount();
    expect(svg.tag).toBe('svg');
    expect(svg.hasAttribute('hidden')).toBe(true);
    expect(svg.attributes['aria-hidden']).toBe('true');
    expect(turn.hasAttribute('hidden') && push.hasAttribute('hidden')).toBe(true);
  });

  it('is invisible to the pointer itself, and takes it on its two bubbles only', () => {
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

  it('draws its bubble as the manual does: a paper disc ringed in ink at the circle’s own line weight', () => {
    mount();
    const css = head.children[0].textContent;
    expect(css).toMatch(new RegExp(`\\.inset-controls__bubble \\{[^}]*fill: #ffffff[^}]*stroke: #1c1c1c[^}]*stroke-width: ${INSET.ring.width}`));
  });

  describe('the spinner', () => {
    it('is a bubble attached to the circle, the size of the manual’s tool bubble, the push bubble away', () => {
      const { controls, svg, turn, push } = mount();
      controls.showTurn(FRAME, lookTurn({ progress: 0.25 }));
      expect(svg.hasAttribute('hidden')).toBe(false);
      expect(turn.hasAttribute('hidden')).toBe(false);
      expect(push.hasAttribute('hidden')).toBe(true);
      expect(turn.attributes.transform).toBe(`translate(${CENTRE[0]} ${CENTRE[1]})`);
      expect(turn.all('inset-controls__bubble')[0].attributes.r).toBe(String(BUBBLE.radius));
      expect(BUBBLE.radius).toBeCloseTo(FRAME.radius * BOOKLET.inset.tool, 9);
    });

    it('holds a ring with the arc at the progress, in the bubble', () => {
      const { controls, turn } = mount();
      controls.showTurn(FRAME, lookTurn({ progress: 0.25 }));
      const ring = BUBBLE.radius * mark.radius;
      expect(turn.all('inset-controls__track')[0].attributes.r).toBe(String(ring));
      const arc = turn.all('inset-controls__arc')[0];
      expect(Number(arc.attributes['stroke-dasharray'].split(' ')[0])).toBeCloseTo(arcLength(0.25, ring), 6);
      expect(ring).toBeLessThan(BUBBLE.radius);
    });

    it('is not the old black dial: ink line art with open chevrons, the green only on the arc, paper behind', () => {
      mount();
      const css = head.children[0].textContent;
      expect(css).toMatch(/\.inset-controls__head,\s*\.inset-controls__arrow \{[^}]*fill: none[^}]*stroke: #1c1c1c/);
      expect(css).toMatch(/\.inset-controls__arc \{[^}]*stroke: #2e9e4f/);
      expect(css).not.toMatch(/\.inset-controls__head \{[^}]*fill: #1c1c1c/);
    });

    it('follows the circle and grows with it', () => {
      const { controls, turn } = mount();
      const big = { centre: [500, 400] as [number, number], radius: 120 };
      controls.showTurn(big, lookTurn());
      const b = bubbleOf(big);
      expect(turn.attributes.transform).toBe(`translate(${b.centre[0]} ${b.centre[1]})`);
      expect(turn.all('inset-controls__bubble')[0].attributes.r).toBe(String(b.radius));
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

    it('reports nothing once the finger has lifted, and nothing for a press with no sweep', () => {
      const { controls, turn, turns } = mount();
      controls.showTurn(FRAME, lookTurn());
      turn.fire('pointerdown', onBubble(0));
      turn.fire('pointerup', onBubble(0));
      turn.fire('pointermove', onBubble(40));
      expect(turns).toEqual([]);
    });

    it('sweeps about the bubble’s centre, wherever it was last shown', () => {
      const { controls, turn, total } = mount();
      const moved = { centre: [500, 500] as [number, number], radius: 80 };
      controls.showTurn(moved, lookTurn());
      const b = bubbleOf(moved);
      const r = b.radius * mark.radius;
      turn.fire('pointerdown', { clientX: b.centre[0] + r, clientY: b.centre[1] });
      turn.fire('pointermove', { clientX: b.centre[0], clientY: b.centre[1] + r });
      expect(total()).toBeCloseTo(Math.PI / 2, 5);
    });
  });

  describe('the push control', () => {
    it('is a bubble attached the same way, paper with a down arrow while seated, the spinner away', () => {
      const { controls, turn, push } = mount();
      controls.showPush(FRAME, { seated: false, head: 'in' }, null);
      expect(push.hasAttribute('hidden')).toBe(false);
      expect(turn.hasAttribute('hidden')).toBe(true);
      expect(push.attributes['data-seated']).toBe('false');
      expect(push.attributes.transform).toBe(`translate(${CENTRE[0]} ${CENTRE[1]})`);
      expect(push.all('inset-controls__bubble')[0].attributes.r).toBe(String(BUBBLE.radius));
      expect(push.all('inset-controls__arrow')).toHaveLength(1);
    });

    it('fills green in the bubble and flips its arrowhead once pressed home', () => {
      const { controls, push } = mount();
      controls.showPush(FRAME, { seated: true, head: 'out' }, null);
      expect(push.attributes['data-seated']).toBe('true');
      expect(push.attributes.transform).toContain('scale(1 -1)');
      expect(head.children[0].textContent).toMatch(/data-seated='true'\] \.inset-controls__bubble \{[^}]*fill: #2e9e4f/);
    });

    it('tails to the dowel it presses: a line from the bubble’s edge to the joint, a dot on the joint, under the grab', () => {
      const { controls, svg, push } = mount();
      const tail = svg.all('inset-controls__tail')[0];
      const joint: [number, number] = [60, 420];
      controls.showPush(FRAME, { seated: false, head: 'in' }, joint);
      const [line] = tail.all('inset-controls__line');
      const [dot] = tail.all('inset-controls__dot');
      expect(tail.hasAttribute('hidden')).toBe(false);
      expect([Number(line.attributes.x2), Number(line.attributes.y2)]).toEqual(joint);
      expect([Number(dot.attributes.cx), Number(dot.attributes.cy)]).toEqual(joint);
      expect(Math.hypot(Number(line.attributes.x1) - CENTRE[0], Number(line.attributes.y1) - CENTRE[1])).toBeCloseTo(BUBBLE.radius, 6);
      expect(svg.children.indexOf(tail)).toBeLessThan(svg.children.indexOf(push));
      expect(head.children[0].textContent).not.toMatch(/__tail \{[^}]*pointer-events: auto/);
    });

    it('has no tail with no joint on screen, or one under the bubble, and none on the spinner', () => {
      const { controls, svg } = mount();
      const tail = svg.all('inset-controls__tail')[0];
      controls.showPush(FRAME, { seated: false, head: 'in' }, null);
      expect(tail.hasAttribute('hidden')).toBe(true);
      controls.showPush(FRAME, { seated: false, head: 'in' }, CENTRE);
      expect(tail.hasAttribute('hidden')).toBe(true);
      controls.showPush(FRAME, { seated: false, head: 'in' }, [60, 420]);
      controls.showTurn(FRAME, lookTurn());
      expect(tail.hasAttribute('hidden')).toBe(true);
    });

    it('a tap calls onPush while the head is in, onPull once it is out', () => {
      const { controls, push, calls } = mount();
      controls.showPush(FRAME, { seated: false, head: 'in' }, null);
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointerup', { clientX: 200, clientY: 300 });
      expect(calls).toEqual({ push: 1, pull: 0 });
      controls.showPush(FRAME, { seated: true, head: 'out' }, null);
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointerup', { clientX: 201, clientY: 301 });
      expect(calls).toEqual({ push: 1, pull: 1 });
    });

    it('a press that moves past the tap distance calls nothing, and nor does a cancelled one', () => {
      const { controls, push, calls } = mount();
      controls.showPush(FRAME, { seated: false, head: 'in' }, null);
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointerup', { clientX: 200, clientY: 300 + GESTURE.tapMaxDistance + 5 });
      push.fire('pointerdown', { clientX: 200, clientY: 300 });
      push.fire('pointercancel', {});
      push.fire('pointerup', { clientX: 200, clientY: 300 });
      expect(calls).toEqual({ push: 0, pull: 0 });
    });

    it('a pointerup with no press before it calls nothing', () => {
      const { controls, push, calls } = mount();
      controls.showPush(FRAME, { seated: false, head: 'in' }, null);
      push.fire('pointerup', { clientX: 200, clientY: 300 });
      expect(calls.push).toBe(0);
    });
  });

  it('hide() hides the whole overlay', () => {
    const { controls, svg } = mount();
    controls.showTurn(FRAME, lookTurn());
    controls.hide();
    expect(svg.hasAttribute('hidden')).toBe(true);
  });
});

describe('bubbleTail', () => {
  const bubble = { centre: [100, 100] as [number, number], radius: 20 };
  it('runs from the bubble’s edge toward the joint, to the joint', () => {
    expect(bubbleTail(bubble, [100, 300])).toEqual({ from: [100, 120], to: [100, 300] });
  });
  it('is null for no joint or one within the bubble', () => {
    expect(bubbleTail(bubble, null)).toBeNull();
    expect(bubbleTail(bubble, [110, 100])).toBeNull();
  });
});
