import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSET } from '../src/constants.js';
import { insetFrame } from '../src/game/insetView.js';
import { createInsetPanel } from '../src/scene/insetPanel.js';
import type { InsetSubject } from '../src/game/insetModel.js';
import type { Part } from '../src/game/partMesh.js';

// The panel that composes the inset (1.10.0.1 step 6): the router's candidates in, the model's
// state out as a drawn circle, and the two taps. Real model, view maths and render pass over a
// spy renderer and a minimal fake DOM; where the circle lands is test/insetView.test.ts's.

class FakeElement {
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  textContent = '';
  parent: FakeElement | null = null;
  listeners = new Map<string, ((event: object) => void)[]>();
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) node.parent = this;
    this.children.push(...nodes);
  }
  addEventListener(type: string, fn: (event: object) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  setPointerCapture() {}
  fire(type: string, init: object = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, pointerId: 1, target: this, ...init });
  }
  // Every descendant with `className` among its classes.
  all(className: string): FakeElement[] {
    return this.children.flatMap((child) => [...((child.attributes.class ?? '').split(' ').includes(className) ? [child] : []), ...child.all(className)]);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
}

const resizeListeners = new Set<() => void>();
// The control cluster's box, as document.querySelector finds it: null for none on screen.
let clusterBox: { left: number; top: number; right: number; bottom: number } | null = null;
beforeEach(() => {
  clusterBox = null;
  resizeListeners.clear();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => type === 'resize' && resizeListeners.add(fn),
    removeEventListener: (type: string, fn: () => void) => type === 'resize' && resizeListeners.delete(fn),
  });
  const head = new FakeElement();
  vi.stubGlobal('document', {
    head,
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    getElementById: () => null,
    querySelector: () => (clusterBox ? { getBoundingClientRect: () => clusterBox } : null),
  });
  vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '47px', paddingRight: '0px' }));
});
afterEach(() => vi.unstubAllGlobals());

const subject = (over: Partial<InsetSubject> = {}): InsetSubject => ({
  joint: 4,
  kind: 'dowel',
  hardware: 'dowel-1',
  host: 'sidePanel-1',
  tool: null,
  centre: [0, 0, 0],
  axis: [0, -1, 0],
  progress: 0,
  tighten: false,
  loosen: false,
  pressed: false,
  ...over,
});
const part = (id: string) => ({ id }) as Part;

function mount(initial = { left: 0, top: 0, width: 390, height: 844 }) {
  let rect = initial;
  let reads = 0;
  const camera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.01, 100);
  camera.position.set(0, 0.5, 0.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const container = new FakeElement();
  const domElement = {
    getBoundingClientRect: () => {
      reads++;
      return rect;
    },
  } as unknown as HTMLElement;
  const panel = createInsetPanel({ domElement, camera, container: container as unknown as HTMLElement, lines: { resolution: new THREE.Vector2(rect.width, rect.height) } });
  const renders: { scene: unknown; target: unknown }[] = [];
  const state = { current: null as unknown };
  const renderer = {
    autoClear: true,
    getPixelRatio: () => 2,
    getRenderTarget: () => state.current,
    setRenderTarget: (t: unknown) => (state.current = t),
    getSize: (v: THREE.Vector2) => v.set(rect.width, rect.height),
    render: (scene: unknown) => renders.push({ scene, target: state.current }),
  } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const frame = () => insetFrame({ width: rect.width, height: rect.height }, { top: 47, right: 0 });
  const svg = container.children[0];
  // After the ring's overlay and the safe-area probe.
  const controls = container.children[2];
  const turn = () => controls.all('inset-controls__turn')[0];
  const push = () => controls.all('inset-controls__push')[0];
  const resize = (next: typeof rect) => {
    rect = next;
    for (const fn of resizeListeners) fn();
  };
  return { panel, renderer, renders, scene, frame, svg, controls, turn, push, container, resize, reads: () => reads };
}

describe('the inset panel', () => {
  it('draws nothing while nothing is offered or engaged', () => {
    const { panel, renderer, renders, scene, svg } = mount();
    panel.hook.candidates(null, [], []);
    panel.update();
    panel.render(renderer, scene);
    expect(renders).toEqual([]);
    expect(svg.attributes.hidden).toBe('');
  });

  it('draws the extra pass and inks the ring once something is offered, faint', () => {
    const { panel, renderer, renders, scene, svg } = mount();
    panel.hook.candidates(subject({ joint: -1 }), [], []);
    panel.update();
    panel.render(renderer, scene);
    expect(renders).toHaveLength(2);
    expect(renders[0].scene).toBe(scene);
    expect(svg.attributes.hidden).toBeUndefined();
    expect(svg.attributes['data-state']).toBe('offered');
  });

  it('goes active, full ink, when the parts engage', () => {
    const { panel, svg } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    expect(svg.attributes['data-state']).toBe('active');
  });

  it('keeps the circle clear of the safe-area inset', () => {
    const { panel, svg, frame } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    const ring = svg.children[0].children[0];
    expect(Number(ring.attributes.cy) - Number(ring.attributes.r)).toBeGreaterThanOrEqual(47);
    expect(Number(ring.attributes.r)).toBeCloseTo(frame().radius);
  });

  it('a tap outside the circle dismisses it, which stops drawing; a tap inside does not', () => {
    const { panel, renderer, renders, scene, frame } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    const { centre } = frame();
    expect(panel.hook.tapOutside(centre)).toBe(false);
    expect(panel.hook.tapOutside([10, 800])).toBe(true);
    panel.update();
    panel.render(renderer, scene);
    expect(renders).toEqual([]);
  });

  it('while dismissed, a tap on an engaged part reopens it and is consumed; one on another part is not', () => {
    const { panel, renderer, renders, scene, svg } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    panel.hook.tapOutside([10, 800]);
    panel.update();
    expect(panel.hook.tapOn(part('lid'))).toBe(false);
    expect(panel.hook.tapOn(part('dowel-1'))).toBe(true);
    panel.update();
    panel.render(renderer, scene);
    expect(renders).toHaveLength(2);
    expect(svg.attributes['data-state']).toBe('active');
  });

  it('while showing, the engaged part’s tap is not the inset’s', () => {
    const { panel } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    expect(panel.hook.tapOn(part('dowel-1'))).toBe(false);
  });

  it('hides when the engagement ends, and a repack hides it at once', () => {
    const { panel, svg } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    panel.hook.candidates(null, [], []);
    panel.update();
    expect(svg.attributes.hidden).toBe('');
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    panel.reset();
    expect(svg.attributes.hidden).toBe('');
  });

  it('reads layout only when the window is resized, not every frame', () => {
    const { panel, svg, reads, resize } = mount();
    panel.hook.candidates(null, [subject()], []);
    for (let i = 0; i < 5; i++) panel.update();
    expect(reads()).toBe(1);
    resize({ left: 0, top: 0, width: 844, height: 390 });
    panel.update();
    panel.update();
    expect(reads()).toBe(2);
    // Landscape now: the circle moved to the right.
    const ring = svg.children[0].children[0];
    expect(Number(ring.attributes.cx)).toBeGreaterThan(422);
  });

  it('takes its overlay, probe and controls off the page on dispose', () => {
    const { panel, container } = mount();
    expect(container.children.length).toBe(3);
    panel.dispose();
    expect(container.children.length).toBe(0);
    expect(resizeListeners.size).toBe(0);
  });
});

describe('the inset panel’s controls (1.10.0.2)', () => {
  const tool = (over: Partial<InsetSubject> = {}) => subject({ kind: 'tool', tool: 'key-1', hardware: 'key-1', host: 'bolt-1', ...over });
  // Where a control's group sits, from its transform.
  const at = (group: FakeElement): [number, number] => {
    const [x, y] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(group.attributes.transform)!.slice(1).map(Number);
    return [x, y];
  };
  const reach = (half = Math.max(INSET.controls.ring.radius, INSET.controls.arrow.length / 2, INSET.controls.arrow.head)) => INSET.controls.gap + half;

  it('shows the turn ring beside the circle for an active tool, never inside it', () => {
    const { panel, controls, turn, push, frame } = mount();
    panel.hook.candidates(null, [tool({ progress: 0.5, tighten: true, loosen: true })], []);
    panel.update();
    expect(controls.attributes.hidden).toBeUndefined();
    expect(turn().attributes.hidden).toBeUndefined();
    expect(push().attributes.hidden).toBe('');
    const { centre, radius } = frame();
    const [x, y] = at(turn());
    expect(y).toBe(centre[1]);
    expect(Math.abs(x - centre[0])).toBeGreaterThanOrEqual(radius + reach());
  });

  it('shows the push arrow for a dowel, black while seated, green once it is pressed home and stays', () => {
    const { panel, controls, push } = mount();
    panel.hook.candidates(null, [subject()], []);
    panel.update();
    expect(push().attributes['data-seated']).toBe('false');
    panel.hook.candidates(null, [], [subject({ pressed: true, progress: 1 })]);
    panel.update();
    expect(controls.attributes.hidden).toBeUndefined();
    expect(push().attributes['data-seated']).toBe('true');
  });

  it('shows no control while the seat is only offered, nor once dismissed, nor while hidden', () => {
    const { panel, controls } = mount();
    panel.hook.candidates(subject({ joint: -1 }), [], []);
    panel.update();
    expect(controls.attributes.hidden).toBe('');
    panel.hook.candidates(null, [tool()], []);
    panel.update();
    expect(controls.attributes.hidden).toBeUndefined();
    panel.hook.tapOutside([5, 700]);
    panel.update();
    expect(controls.attributes.hidden).toBe('');
    panel.hook.candidates(null, [], []);
    panel.update();
    expect(controls.attributes.hidden).toBe('');
  });

  it('moves to the next slot when the control cluster covers the first', () => {
    const first = mount();
    first.panel.hook.candidates(null, [tool()], []);
    first.panel.update();
    const [x, y] = at(first.turn());
    first.panel.dispose();
    clusterBox = { left: x - 10, top: y - 10, right: x + 10, bottom: y + 10 };
    const { panel, turn, frame } = mount();
    panel.hook.candidates(null, [tool()], []);
    panel.update();
    const moved = at(turn());
    expect(Math.sign(moved[0] - frame().centre[0])).toBe(-Math.sign(x - frame().centre[0]));
  });

  it('drives the connected router: a sweep of the ring turns the tool, taps press and pull the dowel', () => {
    const { panel, turn, push } = mount();
    const calls: unknown[][] = [];
    panel.connect({ turnGrip: (...args) => !!calls.push(['turn', ...args]), pressJoint: (...args) => !!calls.push(['press', ...args]), pullJoint: (...args) => !!calls.push(['pull', ...args]) });
    panel.hook.candidates(null, [tool({ joint: 7 })], []);
    panel.update();
    const [cx, cy] = at(turn());
    const r = INSET.controls.ring.radius;
    turn().fire('pointerdown', { clientX: cx + r, clientY: cy });
    turn().fire('pointermove', { clientX: cx, clientY: cy + r });
    expect(calls).toEqual([['turn', 'key-1', expect.closeTo(Math.PI / 2, 5)]]);
    calls.length = 0;
    panel.hook.candidates(null, [subject({ joint: 9 })], []);
    panel.update();
    push().fire('pointerdown', { clientX: 1, clientY: 1 });
    push().fire('pointerup', { clientX: 1, clientY: 1 });
    panel.hook.candidates(null, [], [subject({ joint: 9, pressed: true, progress: 1 })]);
    panel.update();
    push().fire('pointerdown', { clientX: 1, clientY: 1 });
    push().fire('pointerup', { clientX: 1, clientY: 1 });
    expect(calls).toEqual([['press', 9], ['pull', 9]]);
  });

  it('does nothing from a control before the router is connected', () => {
    const { panel, turn } = mount();
    panel.hook.candidates(null, [tool()], []);
    panel.update();
    const [cx, cy] = at(turn());
    expect(() => {
      turn().fire('pointerdown', { clientX: cx + INSET.controls.ring.radius, clientY: cy });
      turn().fire('pointermove', { clientX: cx, clientY: cy + INSET.controls.ring.radius });
    }).not.toThrow();
  });

  it('removes the controls with the panel', () => {
    const { panel, container } = mount();
    expect(container.children).toHaveLength(3);
    panel.dispose();
    expect(container.children).toHaveLength(0);
  });
});
