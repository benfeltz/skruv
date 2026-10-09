import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIFT_LINE } from '../src/constants.js';
import { createLiftLine } from '../src/ui/liftLine.js';

// The real elevation line (src/ui/liftLine.ts) on a minimal fake DOM: what it reports for
// presses, and that every way a finger leaves it ends the press exactly once. How it feels
// on a phone is the manual plan.

type Listener = (event: object) => void;

class FakeElement {
  tag: string;
  children: FakeElement[] = [];
  className = '';
  hidden = false;
  textContent = '';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  captured: number[] = [];
  declare id?: string; // set on the style element

  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
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
  // The line spans y 100..500 on screen.
  getBoundingClientRect() {
    return { top: 100, height: 400, left: 0, width: LIFT_LINE.hitWidth };
  }
  fire(type: string, init: { pointerId?: number; clientY?: number } = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, pointerId: 1, clientY: 0, ...init });
  }
}

let head: FakeElement;

beforeEach(() => {
  head = new FakeElement('head');
  vi.stubGlobal('document', {
    head,
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
  });
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const log: (string | number | boolean)[][] = [];
  const line = createLiftLine({
    onPress: (fraction, onKnob) => log.push(['press', fraction, onKnob]),
    onMove: (fraction) => log.push(['move', fraction]),
    onRelease: () => log.push(['release']),
  });
  const element = line.element as unknown as FakeElement;
  const [, knob] = element.children;
  return { line, element, knob, log };
}

describe('the elevation line control (1.8.1 Step 4)', () => {
  it('reports a press on the knob as onKnob, and one elsewhere on the line as not', () => {
    const { line, element, log } = mount();
    line.show(0.5); // knob at y 300
    element.fire('pointerdown', { clientY: 300 + LIFT_LINE.knobRadius - 1 });
    element.fire('pointerup');
    element.fire('pointerdown', { clientY: 140 });
    element.fire('pointerup');
    expect(log[0]).toEqual(['press', 0.5 - (LIFT_LINE.knobRadius - 1) / 400, true]);
    expect(log[2]).toEqual(['press', 0.9, false]);
  });

  it('reports fractions top 1 to bottom 0, clamped past the ends', () => {
    const { line, element, log } = mount();
    line.show(0);
    element.fire('pointerdown', { clientY: 100 });
    element.fire('pointermove', { clientY: 500 });
    element.fire('pointermove', { clientY: 900 });
    expect(log).toEqual([['press', 1, false], ['move', 0], ['move', 0]]);
  });

  it('captures the pointer on press', () => {
    const { element } = mount();
    element.fire('pointerdown', { pointerId: 7 });
    expect(element.captured).toEqual([7]);
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('%s reports exactly one onRelease', (type) => {
    const { element, log } = mount();
    element.fire('pointerdown');
    element.fire(type);
    // Lost capture follows an up; neither repeats the release.
    element.fire('lostpointercapture');
    element.fire('pointerup');
    expect(log.filter(([name]) => name === 'release')).toHaveLength(1);
  });

  it('follows one finger: a second press, its moves and its release are ignored', () => {
    const { element, log } = mount();
    element.fire('pointerdown', { pointerId: 1, clientY: 300 });
    element.fire('pointerdown', { pointerId: 2, clientY: 200 });
    element.fire('pointermove', { pointerId: 2, clientY: 100 });
    element.fire('pointerup', { pointerId: 2 });
    expect(log).toEqual([['press', 0.5, false]]);
    element.fire('pointerup', { pointerId: 1 });
    expect(log.at(-1)).toEqual(['release']);
  });

  it('show(f) places the knob at f and shows the line; hide() hides it', () => {
    const { line, element, knob } = mount();
    expect(element.hidden).toBe(true);
    line.show(0.25);
    expect(knob.style.top).toBe('75%');
    expect(element.hidden).toBe(false);
    line.hide();
    expect(element.hidden).toBe(true);
  });

  it('turns off browser touch handling on the line', () => {
    mount();
    expect(head.children[0].textContent).toMatch(/\.lift-line \{[^}]*touch-action: none/);
  });
});
