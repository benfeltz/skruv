import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLORS, INSET } from '../src/constants.js';
import { createInsetOverlay } from '../src/ui/inset.js';

// The real ink ring and tail overlay (src/ui/inset.ts) on a minimal fake DOM, as test/turnRingOverlay.test.ts
// builds its own: what it draws for the frame it is shown. How it reads on a phone is the manual pass.

class FakeElement {
  tag: string;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  textContent = '';
  declare id?: string; // set on the style element

  constructor(tag: string) {
    this.tag = tag;
  }
  writes = 0;
  setAttribute(name: string, value: string) {
    this.writes++;
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
  first(className: string): FakeElement {
    const found = this.find(className);
    if (!found) throw new Error(`no .${className}`);
    return found;
  }
  find(className: string): FakeElement | null {
    for (const child of this.children) {
      if ((child.attributes.class ?? '').split(' ').includes(className)) return child;
      const deeper = child.find(className);
      if (deeper) return deeper;
    }
    return null;
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
  const overlay = createInsetOverlay(body as unknown as HTMLElement); // a fake: append only
  const svg = body.children[0];
  return { overlay, svg };
}

const frame = { centre: [200, 150] as [number, number], radius: 100 };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

describe('the inset overlay', () => {
  it('starts hidden, never takes a pointer, and keeps out of the accessibility tree', () => {
    const { svg } = mount();
    expect(svg.tag).toBe('svg');
    expect(svg.hasAttribute('hidden')).toBe(true);
    expect(svg.attributes['aria-hidden']).toBe('true');
    expect(head.children[0].textContent).toMatch(/\.inset \{[^}]*pointer-events: none/);
  });

  it('draws the ring at the frame, in the manual’s ink', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: null, active: true });
    expect(svg.hasAttribute('hidden')).toBe(false);
    const ring = svg.first('inset__ring');
    expect([ring.attributes.cx, ring.attributes.cy, ring.attributes.r]).toEqual(['200', '150', '100']);
    const style = head.children[0].textContent;
    expect(style).toContain(hex(COLORS.bookletInk));
    expect(style).toMatch(new RegExp(`stroke-width: ${INSET.ring.width}`));
  });

  it('follows the frame as it moves', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: null, active: true });
    overlay.show({ frame: { centre: [10, 20], radius: 70 }, anchor: null, active: true });
    const ring = svg.first('inset__ring');
    expect([ring.attributes.cx, ring.attributes.cy, ring.attributes.r]).toEqual(['10', '20', '70']);
  });

  it('is faint while offered and full ink once active', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: null, active: false });
    expect(svg.attributes['data-state']).toBe('offered');
    overlay.show({ frame, anchor: null, active: true });
    expect(svg.attributes['data-state']).toBe('active');
    const style = head.children[0].textContent;
    expect(style).toMatch(new RegExp(`\\[data-state='offered'\\] \\.inset__mark \\{[^}]*opacity: ${INSET.ring.offeredAlpha}`));
    expect(style).toMatch(new RegExp(`\\[data-state='active'\\] \\.inset__mark \\{[^}]*opacity: ${INSET.ring.activeAlpha}`));
    expect(style).toMatch(new RegExp(`transition: opacity ${INSET.fadeMs}ms`));
  });

  it('runs the tail from the rim to the anchor, ending in a dot', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: [200, 450], active: true });
    const tail = svg.first('inset__tail');
    expect(tail.hasAttribute('hidden')).toBe(false);
    const line = svg.first('inset__line');
    expect([line.attributes.x1, line.attributes.y1]).toEqual(['200', '250']);
    expect([line.attributes.x2, line.attributes.y2]).toEqual(['200', '450']);
    const dot = svg.first('inset__dot');
    expect([dot.attributes.cx, dot.attributes.cy, dot.attributes.r]).toEqual(['200', '450', String(INSET.tail.dot)]);
  });

  it('puts the tail’s start on the rim for a slanted anchor', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: [500, 450], active: true });
    const line = svg.first('inset__line');
    const rim = Math.hypot(Number(line.attributes.x1) - 200, Number(line.attributes.y1) - 150);
    expect(rim).toBeCloseTo(100);
  });

  it('hides the tail for an anchor inside the circle or none at all', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: [220, 160], active: true });
    expect(svg.first('inset__tail').hasAttribute('hidden')).toBe(true);
    overlay.show({ frame, anchor: [200, 450], active: true });
    overlay.show({ frame, anchor: null, active: true });
    expect(svg.first('inset__tail').hasAttribute('hidden')).toBe(true);
  });

  it('rewrites only what changed from one frame to the next', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: [200, 450], active: true });
    const ring = svg.first('inset__ring');
    const line = svg.first('inset__line');
    const [ringWrites, lineWrites] = [ring.writes, line.writes];
    overlay.show({ frame, anchor: [200, 450], active: true });
    expect([ring.writes, line.writes]).toEqual([ringWrites, lineWrites]);
    overlay.show({ frame, anchor: [200, 460], active: true });
    expect(ring.writes).toBe(ringWrites);
    expect(line.writes).toBeGreaterThan(lineWrites);
  });

  it('hide hides it', () => {
    const { overlay, svg } = mount();
    overlay.show({ frame, anchor: null, active: true });
    overlay.hide();
    expect(svg.hasAttribute('hidden')).toBe(true);
  });
});
