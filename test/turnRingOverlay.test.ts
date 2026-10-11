import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_RING } from '../src/constants.js';
import { createTurnRing } from '../src/ui/turnRing.js';
import type { Dial } from '../src/ui/turnRing.js';

// The real turn-ring overlay (src/ui/turnRing.ts) on a minimal fake DOM (1.8.2.2 step 4):
// what it draws for the dials it is shown. How it looks and reads on a phone is the manual plan.

class FakeElement {
  tag: string;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  textContent = '';
  declare id?: string; // set on the style element

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
  // Every descendant with `className` among its classes.
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

function mount() {
  const ring = createTurnRing(body as unknown as HTMLElement); // a fake: append only
  const svg = body.children[0];
  const shown = () => svg.all('turn-ring__dial').filter((dial) => !dial.hasAttribute('hidden'));
  const dashOf = (dial: FakeElement) => Number(dial.all('turn-ring__arc')[0].attributes['stroke-dasharray'].split(' ')[0]);
  return { ring, svg, shown, dashOf };
}

const dial = (over: Partial<Dial> = {}): Dial => ({ centre: [100, 200], progress: 0, clockwise: true, flashing: false, ...over });
const full = 2 * Math.PI * TURN_RING.radius;

describe('the turn-ring overlay', () => {
  it('starts hidden, never takes a pointer, and keeps out of the accessibility tree', () => {
    const { svg } = mount();
    expect(svg.tag).toBe('svg');
    expect(svg.hasAttribute('hidden')).toBe(true);
    expect(svg.attributes['aria-hidden']).toBe('true');
    expect(head.children[0].textContent).toMatch(/\.turn-ring \{[^}]*pointer-events: none/);
  });

  it('draws one ring per dial, each round its centre, with two arrowheads', () => {
    const { ring, svg, shown } = mount();
    ring.show([dial({ centre: [100, 200] }), dial({ centre: [400, 500] })]);
    expect(svg.hasAttribute('hidden')).toBe(false);
    const dials = shown();
    expect(dials).toHaveLength(2);
    expect(dials.map((d) => d.attributes.transform)).toEqual(['translate(100 200)', 'translate(400 500)']);
    for (const d of dials) {
      expect(d.all('turn-ring__track')[0].attributes.r).toBe(String(TURN_RING.radius));
      expect(d.all('turn-ring__arrow')).toHaveLength(2);
    }
  });

  it('fills the arc with progress', () => {
    const { ring, shown, dashOf } = mount();
    ring.show([dial({ progress: 0 }), dial({ progress: 0.5 }), dial({ progress: 1 })]);
    const [empty, half, whole] = shown().map(dashOf);
    expect(empty).toBe(0);
    expect(half).toBeCloseTo(full / 2, 6);
    expect(whole).toBeCloseTo(full, 6);
  });

  it('mirrors the arc and arrows for an anticlockwise dial', () => {
    const { ring, shown } = mount();
    ring.show([dial({ clockwise: true }), dial({ clockwise: false })]);
    const [cw, ccw] = shown();
    expect(cw.all('turn-ring__arrows')[0].attributes.transform).toBe('');
    expect(ccw.all('turn-ring__arrows')[0].attributes.transform).toBe('scale(-1 1)');
    expect(ccw.all('turn-ring__arc')[0].attributes.transform).toBe('scale(-1 1) rotate(-90)');
  });

  it('marks a flashing dial', () => {
    const { ring, shown } = mount();
    ring.show([dial({ flashing: true, progress: 1 })]);
    expect(shown()[0].attributes['data-flashing']).toBe('true');
  });

  it('reuses its dials: fewer dials hide the rest, and no new elements are built', () => {
    const { ring, svg, shown } = mount();
    ring.show([dial(), dial()]);
    ring.show([dial()]);
    expect(shown()).toHaveLength(1);
    expect(svg.all('turn-ring__dial')).toHaveLength(2);
  });

  it('follows the radius knob live', () => {
    const { ring, shown, dashOf } = mount();
    ring.show([dial({ progress: 1 })]);
    const before = TURN_RING.radius;
    TURN_RING.radius = before * 2;
    try {
      ring.show([dial({ progress: 1 })]);
      const [d] = shown();
      expect(d.all('turn-ring__track')[0].attributes.r).toBe(String(before * 2));
      expect(dashOf(d)).toBeCloseTo(2 * full, 6);
    } finally {
      TURN_RING.radius = before;
    }
  });

  it('hide hides them all, as does showing none', () => {
    const { ring, svg } = mount();
    ring.show([dial(), dial()]);
    ring.hide();
    expect(svg.hasAttribute('hidden')).toBe(true);
    ring.show([dial()]);
    ring.show([]);
    expect(svg.hasAttribute('hidden')).toBe(true);
  });
});
