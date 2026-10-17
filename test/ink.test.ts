import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COLORS, INK } from '../src/constants.js';
import { createInk, hullGeometry, inkEdges, inkHull } from '../src/scene/ink.js';

const box = () => new THREE.BoxGeometry(0.1, 0.02, 0.2);
const round = () => new THREE.CylinderGeometry(0.003, 0.003, 0.03, 12);
const bounds = (g: THREE.BufferGeometry) => new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);

describe('the ink', () => {
  it('makes both materials from the one colour and the constants', () => {
    const ink = createInk();
    expect(ink.lines.color.getHex()).toBe(COLORS.ink);
    expect(ink.hull.color.getHex()).toBe(COLORS.ink);
    expect(ink.lines.linewidth).toBe(INK.lineWidth);
    expect(ink.hull.side).toBe(THREE.BackSide);
  });

  it('draws a panel\'s twelve edges and only the rims of a faceted round', () => {
    const { lines } = createInk();
    expect(inkEdges(box(), lines).geometry.instanceCount).toBe(12);
    expect(inkEdges(round(), lines).geometry.instanceCount).toBe(24);
  });

  it('names its outlines', () => {
    const ink = createInk();
    expect(inkEdges(box(), ink.lines).name).toBe('inkEdges');
    const hull = inkHull(box(), ink.hull);
    expect(hull.name).toBe('inkHull');
    expect(hull.material).toBe(ink.hull);
    expect(hull.castShadow).toBe(false);
  });

  it('welds a box hull to eight vertices and grows every side by the full width, thin panel or not', () => {
    for (const geometry of [box(), new THREE.BoxGeometry(0.4, 0.018, 0.6)]) {
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3));
      const hull = hullGeometry(geometry, INK.hullWidth);
      expect(hull.getAttribute('position').count).toBe(8);
      expect(hull.getAttribute('color')).toBeUndefined();
      const grown = bounds(hull).getSize(new THREE.Vector3());
      const was = bounds(geometry).getSize(new THREE.Vector3());
      for (const axis of ['x', 'y', 'z'] as const) expect((grown[axis] - was[axis]) / 2).toBeCloseTo(INK.hullWidth, 6);
    }
  });

  it('puts a round\'s hull a width outside its radius, give or take its facet', () => {
    const half = bounds(hullGeometry(round(), INK.hullWidth)).getSize(new THREE.Vector3()).x / 2;
    expect(half).toBeGreaterThan(0.003 + INK.hullWidth * 0.9);
    expect(half).toBeLessThanOrEqual(0.003 + INK.hullWidth * INK.hullMiter);
  });
});
