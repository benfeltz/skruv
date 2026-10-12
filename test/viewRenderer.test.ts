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
    // Two part types drawn, two of each; the fill and both line weights.
    expect(boxes).toHaveBeenCalledTimes(2);
    expect(edges).toHaveBeenCalledTimes(2);
    expect(materials).toHaveBeenCalledTimes(3);
  });
});
