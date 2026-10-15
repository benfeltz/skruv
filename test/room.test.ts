import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROOM, STAGE } from '../src/constants.js';
import { createRoom } from '../src/scene/room.js';

// A stand-in renderer: the room only asks it for the drawing buffer's size.
const renderer = (width = 800, height = 600) => ({ getSize: (target: THREE.Vector2) => target.set(width, height) }) as unknown as THREE.WebGLRenderer;
const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const bounds = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);

describe('the room as built', () => {
  const { group, pieces } = createRoom();
  group.updateMatrixWorld(true);
  const box = (name: string) => bounds(pieces.get(name as 'slab')!);

  it('has the slab, two walls and two lips', () => {
    expect([...pieces.keys()].sort()).toEqual(['backWall', 'frontLip', 'leftWall', 'rightLip', 'slab']);
  });

  it('tops the slab at y 0, the floor', () => {
    expect(box('slab').max.y).toBeCloseTo(0, 6);
    expect(box('slab').min.y).toBeCloseTo(-STAGE.slabThickness, 6);
  });

  it('stands the walls\' inner faces on the back and left edges', () => {
    expect(box('backWall').max.z).toBeCloseTo(-ROOM.depth / 2, 6);
    expect(box('leftWall').max.x).toBeCloseTo(-ROOM.width / 2, 6);
    expect(box('backWall').max.y).toBeCloseTo(STAGE.wallHeight, 6);
  });

  it('stands the lips on the front and right edges', () => {
    expect(box('frontLip').min.z).toBeCloseTo(ROOM.depth / 2, 6);
    expect(box('rightLip').min.x).toBeCloseTo(ROOM.width / 2, 6);
    expect(box('frontLip').max.y).toBeCloseTo(STAGE.lipHeight, 6);
  });

  it('keeps all but the slab outside the floor\'s footprint', () => {
    for (const name of ['backWall', 'leftWall', 'frontLip', 'rightLip']) {
      const b = box(name);
      const e = 1e-6;
      const inside = b.min.x < ROOM.width / 2 - e && b.max.x > -ROOM.width / 2 + e && b.min.z < ROOM.depth / 2 - e && b.max.z > -ROOM.depth / 2 + e;
      expect(inside, name).toBe(false);
    }
  });

  it('draws every piece with its ink: a mesh and its edge lines in one group', () => {
    for (const piece of pieces.values()) expect(piece.children).toHaveLength(2);
  });
});

describe('the room per frame', () => {
  it('hides the back wall, ink and all, from behind it, and shows it again in front', () => {
    const { pieces, update } = createRoom();
    update(at(0, 2, -ROOM.depth), renderer());
    expect(pieces.get('backWall')!.visible).toBe(false);
    expect(pieces.get('leftWall')!.visible).toBe(true);
    update(at(0, 2, ROOM.depth), renderer());
    expect(pieces.get('backWall')!.visible).toBe(true);
  });

  it('hides the left wall from behind it, and both from behind the corner', () => {
    const { pieces, update } = createRoom();
    update(at(-ROOM.width, 2, 0), renderer());
    expect(pieces.get('leftWall')!.visible).toBe(false);
    expect(pieces.get('backWall')!.visible).toBe(true);
    update(at(-ROOM.width, 2, -ROOM.depth), renderer());
    expect([pieces.get('backWall')!.visible, pieces.get('leftWall')!.visible]).toEqual([false, false]);
  });

  it('hides a wall for an eye inside its thickness, not only behind it', () => {
    const { pieces, update } = createRoom();
    update(at(0, 2, -ROOM.depth / 2 - STAGE.wallThickness / 2), renderer());
    expect(pieces.get('backWall')!.visible).toBe(false);
  });

  it('never hides the slab or the lips', () => {
    const { pieces, update } = createRoom();
    update(at(-ROOM.width, 2, -ROOM.depth), renderer());
    for (const name of ['slab', 'frontLip', 'rightLip'] as const) expect(pieces.get(name)!.visible, name).toBe(true);
  });

  it('keeps the ink resolution at the canvas CSS size, whatever the pixel ratio', () => {
    const { pieces, update } = createRoom();
    update(at(0, 2, 3), renderer(1170, 2532));
    const lines = pieces.get('slab')!.children[1] as unknown as { material: { resolution: THREE.Vector2 } };
    expect(lines.material.resolution.toArray()).toEqual([1170, 2532]);
  });

  it('builds no geometry per frame', () => {
    const { pieces, update } = createRoom();
    const geometries = () => [...pieces.values()].flatMap((piece) => piece.children.map((child) => (child as THREE.Mesh).geometry));
    const before = geometries();
    for (let i = 0; i < 5; i++) update(at(i, 2, 3), renderer());
    const after = geometries();
    expect(after).toHaveLength(before.length);
    after.forEach((geometry, i) => expect(geometry).toBe(before[i]));
  });
});
