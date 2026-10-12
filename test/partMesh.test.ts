import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { COLORS, GESTURE } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { createPartMesh } from '../src/game/partMesh.js';
import { decalPlacements } from '../src/game/decals.js';
import { createGizmo } from '../src/scene/gizmo.js';
import type { Part } from '../src/game/partMesh.js';

// Geometry positions are float32: a micrometre is well under their rounding on a 0.2 m part.
const EPS = 1e-6;
const SHAPED = ['allenWrench', 'screwdriver', 'dowel', 'camLockBolt', 'camLock', 'shelfPin', 'backFitting'];

// The distinct vertex colours a mesh carries, as hex.
function tonesOf(mesh: THREE.Mesh) {
  const colors = mesh.geometry.attributes.color;
  const tones = new Set<number>();
  for (let i = 0; i < colors.count; i++) tones.add(new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i)).getHex());
  return tones;
}

describe('createPartMesh', () => {
  it.each(SHAPED)('draws %s inside its pack box, in vertex colours on one material', (name) => {
    const type = PART_TYPES[name];
    const mesh = createPartMesh(type);
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox!;
    type.size.forEach((s, i) => {
      expect(min.getComponent(i)).toBeGreaterThanOrEqual(-s / 2 - EPS);
      expect(max.getComponent(i)).toBeLessThanOrEqual(s / 2 + EPS);
    });
    expect(mesh.geometry).not.toBeInstanceOf(THREE.BoxGeometry);
    expect(mesh.material.vertexColors).toBe(true);
    expect(tonesOf(mesh)).toContain(new THREE.Color(COLORS[type.color as keyof typeof COLORS]).getHex());
  });

  it('paints the screwdriver a yellow handle on a metal shaft, and the cam lock a dark slot', () => {
    expect(tonesOf(createPartMesh(PART_TYPES.screwdriver))).toEqual(new Set([COLORS.partScrewdriver, COLORS.partMetal]));
    expect(tonesOf(createPartMesh(PART_TYPES.camLock))).toEqual(new Set([COLORS.partMetal, COLORS.partRecess]));
  });

  it('keeps panels and the box their pack box in the pack colour, decal on every socket as before', () => {
    for (const name of ['sidePanel', 'topBottomPanel', 'backPanel', 'boxLid']) {
      const type = PART_TYPES[name];
      const mesh = createPartMesh(type);
      expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
      expect((mesh.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: type.size[0], height: type.size[1], depth: type.size[2] });
      expect(mesh.material.color.getHex()).toBe(COLORS[type.color as keyof typeof COLORS]);
      expect([...mesh.userData.decals.keys()]).toEqual(decalPlacements(type.connectors).map((d) => d.index));
    }
  });
});

describe('gizmo on a shaped part', () => {
  it('sizes its turn from the pack box, not the mesh geometry', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const domElement = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) } as unknown as HTMLElement;
    const physics = { grab: vi.fn(), move: vi.fn(), release: vi.fn() };
    const gizmo = createGizmo({ camera, domElement, physics, isFree: () => true });
    // A fake body: the gizmo only hands it to physics.
    const part = { id: 'screwdriver-1', type: 'screwdriver', mesh: createPartMesh(PART_TYPES.screwdriver), body: {} } as unknown as Part;

    gizmo.show(part);
    // A quarter sweep about z, round the part's screen centre (500, 500).
    gizmo.start({ axis: 'z' }, { x: 600, y: 500 });
    gizmo.move({ x: 500, y: 400 });

    expect(physics.move).toHaveBeenCalledTimes(1);
    const [, position] = physics.move.mock.calls[0];
    expect(position.every(Number.isFinite)).toBe(true);
    // Laid on its side by the quarter turn, it clears the floor by its pack box's half-width.
    expect(position[1]).toBeCloseTo(PART_TYPES.screwdriver.size[0] / 2 + GESTURE.hoverLift, 6);
  });
});
