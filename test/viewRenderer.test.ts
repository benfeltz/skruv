import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewRenderer } from '../src/scene/bookletPages.js';

// The outline renderer's GPU resources (1.9.1 review): every item swap builds a new
// booklet, so its view renderer must free the geometry and materials it built, or each swap
// leaks one item's worth. Headless: a renderer stub that draws nothing, a canvas stub that
// takes the pixels.

const renderer = {
  getRenderTarget: () => null,
  getClearAlpha: () => 1,
  getClearColor: (color: THREE.Color) => color,
  setRenderTarget() {},
  setClearColor() {},
  clear() {},
  render() {},
  readRenderTargetPixels() {},
} as unknown as THREE.WebGLRenderer;

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ putImageData() {} }) }) });
  vi.stubGlobal('ImageData', class { data: Uint8ClampedArray; constructor(w: number, h: number) { this.data = new Uint8ClampedArray(w * h * 4); } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createViewRenderer.dispose', () => {
  it('frees every geometry it built and its materials', () => {
    const boxes = vi.spyOn(THREE.BoxGeometry.prototype, 'dispose');
    const edges = vi.spyOn(LineSegmentsGeometry.prototype, 'dispose');
    const materials = vi.spyOn(THREE.Material.prototype, 'dispose');
    const views = createViewRenderer(renderer, () => [0.1, 0.2, 0.3]);
    const at = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };
    views.render([{ type: 'a', weight: 'bold', ...at }, { type: 'b', weight: 'faint', ...at }, { type: 'a', weight: 'bold', ...at }], 8, 8);
    expect(boxes).not.toHaveBeenCalled();
    views.dispose();
    // Two part types drawn, two of each; the fill, both line weights and the leader line.
    expect(boxes).toHaveBeenCalledTimes(2);
    expect(edges).toHaveBeenCalledTimes(2);
    expect(materials).toHaveBeenCalledTimes(4);
  });
});

describe('createViewRenderer.render — projector, frame override, extra lines', () => {
  const at = { rotation: [0, 0, 0, 1] as [number, number, number, number] };
  const parts = [
    { type: 'a', weight: 'bold' as const, position: [0, 0, 0] as [number, number, number], ...at },
    { type: 'a', weight: 'faint' as const, position: [1, 0, 0] as [number, number, number], ...at },
  ];

  it('projects the centre of the framed boxes to the centre of the canvas, and the rest inside it', () => {
    const views = createViewRenderer(renderer, () => [0.2, 0.2, 0.2]);
    const { project } = views.render(parts, 200, 100);
    const [cx, cy] = project([0.5, 0, 0]);
    expect(cx).toBeCloseTo(100, 0);
    expect(cy).toBeCloseTo(50, 0);
    for (const point of [[-0.1, -0.1, -0.1], [1.1, 0.1, 0.1]] as [number, number, number][]) {
      const [x, y] = project(point);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(200);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }
  });

  it('frames on the override box instead of the parts', () => {
    const views = createViewRenderer(renderer, () => [0.2, 0.2, 0.2]);
    const frame = { min: [0.9, -0.1, -0.1] as [number, number, number], max: [1.1, 0.1, 0.1] as [number, number, number] };
    const { project } = views.render(parts, 100, 100, undefined, { frame });
    const [x, y] = project([1, 0, 0]);
    expect(x).toBeCloseTo(50, 0);
    expect(y).toBeCloseTo(50, 0);
    // The part off to the left is outside the tight frame.
    expect(project([0, 0, 0])[0]).toBeLessThan(0);
  });

  it('draws extra lines and frees their geometry', () => {
    const edges = vi.spyOn(LineSegmentsGeometry.prototype, 'dispose');
    const views = createViewRenderer(renderer, () => [0.2, 0.2, 0.2]);
    views.render(parts, 8, 8, undefined, { lines: [[[0, 0, 0], [0, 0.1, 0]]] });
    expect(edges).toHaveBeenCalledTimes(1);
  });

  it('maps the projector to page pixels in draw', () => {
    const views = createViewRenderer(renderer, () => [0.2, 0.2, 0.2]);
    const ctx = { drawImage() {} } as unknown as CanvasRenderingContext2D;
    const project = views.draw(ctx, parts, [10, 20, 200, 100]);
    const [x, y] = project([0.5, 0, 0]);
    expect(x).toBeCloseTo(110, 0);
    expect(y).toBeCloseTo(70, 0);
  });
});
