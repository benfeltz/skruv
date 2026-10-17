import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
}

beforeEach(() => {
  const head = new FakeElement();
  vi.stubGlobal('document', {
    head,
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    getElementById: () => null,
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
  ...over,
});
const part = (id: string) => ({ id }) as Part;

function mount(rect = { left: 0, top: 0, width: 390, height: 844 }) {
  const camera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.01, 100);
  camera.position.set(0, 0.5, 0.6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const container = new FakeElement();
  const domElement = { getBoundingClientRect: () => rect } as unknown as HTMLElement;
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
  return { panel, renderer, renders, scene, frame, svg, container };
}

describe('the inset panel', () => {
  it('draws nothing while nothing is offered or engaged', () => {
    const { panel, renderer, renders, scene, svg } = mount();
    panel.hook.candidates(null, []);
    panel.update();
    panel.render(renderer, scene);
    expect(renders).toEqual([]);
    expect(svg.attributes.hidden).toBe('');
  });

  it('draws the extra pass and inks the ring once something is offered, faint', () => {
    const { panel, renderer, renders, scene, svg } = mount();
    panel.hook.candidates(subject({ joint: -1 }), []);
    panel.update();
    panel.render(renderer, scene);
    expect(renders).toHaveLength(2);
    expect(renders[0].scene).toBe(scene);
    expect(svg.attributes.hidden).toBeUndefined();
    expect(svg.attributes['data-state']).toBe('offered');
  });

  it('goes active, full ink, when the parts engage', () => {
    const { panel, svg } = mount();
    panel.hook.candidates(null, [subject()]);
    panel.update();
    expect(svg.attributes['data-state']).toBe('active');
  });

  it('keeps the circle clear of the safe-area inset', () => {
    const { panel, svg, frame } = mount();
    panel.hook.candidates(null, [subject()]);
    panel.update();
    const ring = svg.children[0].children[0];
    expect(Number(ring.attributes.cy) - Number(ring.attributes.r)).toBeGreaterThanOrEqual(47);
    expect(Number(ring.attributes.r)).toBeCloseTo(frame().radius);
  });

  it('a tap outside the circle dismisses it, which stops drawing; a tap inside does not', () => {
    const { panel, renderer, renders, scene, frame } = mount();
    panel.hook.candidates(null, [subject()]);
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
    panel.hook.candidates(null, [subject()]);
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
    panel.hook.candidates(null, [subject()]);
    panel.update();
    expect(panel.hook.tapOn(part('dowel-1'))).toBe(false);
  });

  it('hides when the engagement ends, and a repack hides it at once', () => {
    const { panel, svg } = mount();
    panel.hook.candidates(null, [subject()]);
    panel.update();
    panel.hook.candidates(null, []);
    panel.update();
    expect(svg.attributes.hidden).toBe('');
    panel.hook.candidates(null, [subject()]);
    panel.update();
    panel.reset();
    expect(svg.attributes.hidden).toBe('');
  });

  it('takes its overlay and probe off the page on dispose', () => {
    const { panel, container } = mount();
    expect(container.children.length).toBe(2);
    panel.dispose();
    expect(container.children.length).toBe(0);
  });
});
