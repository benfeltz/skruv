import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROOM, STAGE } from '../src/constants.js';
import { createRoom } from '../src/scene/room.js';

// A stand-in renderer: the room only asks it for the drawing buffer's size.
const renderer = (width = 800, height = 600) => ({ getSize: (target: THREE.Vector2) => target.set(width, height) }) as unknown as THREE.WebGLRenderer;
const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const bounds = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);

describe('the room as built', () => {
  const { group, pieces, leftWall, backWall } = createRoom();
  group.updateMatrixWorld(true);
  const box = (name: string) => bounds(pieces.get(name as 'slab')!);
  const names = (object: THREE.Object3D) => object.children.map((c) => c.name).sort();

  it('has the slab and two lips as boxes, and each wall as one group', () => {
    expect([...pieces.keys()].sort()).toEqual(['frontLip', 'rightLip', 'slab']);
    expect(group.children).toContain(leftWall);
    expect(group.children).toContain(backWall);
  });

  it('holds a wall, its window trim, its ink and a sky per window in the wall\'s one group', () => {
    expect(names(leftWall)).toEqual(['leftSky0', 'leftWallInk', 'leftWallMesh', 'leftWindowTrim']);
    expect(names(backWall)).toEqual(['backSky0', 'backSky1', 'backWallInk', 'backWallMesh', 'backWindowTrim']);
  });

  it('draws each sky unlit, outside its wall, without ink and not above the wall top', () => {
    const skies = [leftWall.getObjectByName('leftSky0')!, backWall.getObjectByName('backSky0')!, backWall.getObjectByName('backSky1')!] as THREE.Mesh[];
    for (const sky of skies) {
      expect(sky.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(sky.children).toHaveLength(0);
      expect(bounds(sky).max.y).toBeLessThanOrEqual(STAGE.wallHeight + 1e-6);
    }
    expect(skies[0].position.x).toBeLessThan(-ROOM.width / 2 - STAGE.wallThickness);
    expect(skies[1].position.z).toBeLessThan(-ROOM.depth / 2 - STAGE.wallThickness);
  });

  it('turns each sky to face the room', () => {
    const normal = (object: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal(leftWall.getObjectByName('leftSky0')!).x).toBeCloseTo(1, 6);
    expect(normal(backWall.getObjectByName('backSky0')!).z).toBeCloseTo(1, 6);
  });

  it('draws one ink per wall: its outline, the openings and the trim, not each piece', () => {
    for (const [wall, name, trimBoxes, pieceCount] of [[leftWall, 'leftWallInk', 10, 4], [backWall, 'backWallInk', 20, 5]] as const) {
      const ink = wall.getObjectByName(name) as unknown as { geometry: { instanceCount: number } };
      expect(ink.geometry.instanceCount, name).toBeLessThan(12 * (pieceCount + trimBoxes + 1));
      expect(ink.geometry.instanceCount, name).toBeGreaterThanOrEqual(24);
    }
  });

  it('tops the slab at y 0, the floor', () => {
    expect(box('slab').max.y).toBeCloseTo(0, 6);
    expect(box('slab').min.y).toBeCloseTo(-STAGE.slabThickness, 6);
  });

  it('stands the walls\' inner faces on the back and left edges', () => {
    const left = bounds(leftWall.getObjectByName('leftWallMesh')!);
    const back = bounds(backWall.getObjectByName('backWallMesh')!);
    expect(back.max.z).toBeCloseTo(-ROOM.depth / 2, 6);
    expect(left.max.x).toBeCloseTo(-ROOM.width / 2, 6);
    expect(left.max.y).toBeCloseTo(STAGE.wallHeight, 6);
    expect(back.max.y).toBeCloseTo(STAGE.wallHeight, 6);
  });

  it('stands the lips on the front and right edges', () => {
    expect(box('frontLip').min.z).toBeCloseTo(ROOM.depth / 2, 6);
    expect(box('rightLip').min.x).toBeCloseTo(ROOM.width / 2, 6);
    expect(box('frontLip').max.y).toBeCloseTo(STAGE.lipHeight, 6);
  });

  it('keeps all but the slab and the window trim outside the floor\'s footprint', () => {
    const e = 1e-6;
    const insideFootprint = (b: THREE.Box3) =>
      b.min.x < ROOM.width / 2 - e && b.max.x > -ROOM.width / 2 + e && b.min.z < ROOM.depth / 2 - e && b.max.z > -ROOM.depth / 2 + e;
    for (const name of ['frontLip', 'rightLip']) expect(insideFootprint(box(name)), name).toBe(false);
    expect(insideFootprint(bounds(leftWall.getObjectByName('leftWallMesh')!))).toBe(false);
    expect(insideFootprint(bounds(backWall.getObjectByName('backWallMesh')!))).toBe(false);
  });

  it('draws every box with its ink: a mesh and its edge lines in one group', () => {
    for (const piece of pieces.values()) expect(piece.children).toHaveLength(2);
  });
});

describe('the room per frame', () => {
  const shown = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };

  it('hides the back wall, ink and all, from behind it, and shows it again in front', () => {
    const { backWall, leftWall, update } = createRoom();
    update(at(0, 2, -ROOM.depth), renderer());
    expect(backWall.visible).toBe(false);
    expect(leftWall.visible).toBe(true);
    update(at(0, 2, ROOM.depth), renderer());
    expect(backWall.visible).toBe(true);
  });

  it('hides the left wall from behind it, and both from behind the corner', () => {
    const { backWall, leftWall, update } = createRoom();
    update(at(-ROOM.width, 2, 0), renderer());
    expect(leftWall.visible).toBe(false);
    expect(backWall.visible).toBe(true);
    update(at(-ROOM.width, 2, -ROOM.depth), renderer());
    expect([backWall.visible, leftWall.visible]).toEqual([false, false]);
  });

  it('hides each wall\'s windows and skies with it, as one group', () => {
    const { leftWall, backWall, update } = createRoom();
    const parts = (wall: THREE.Group, name: string, skies: number) => [
      wall.getObjectByName(`${name}WindowTrim`)!,
      ...Array.from({ length: skies }, (_, i) => wall.getObjectByName(`${name}Sky${i}`)!),
    ];
    const left = parts(leftWall, 'left', 1);
    const back = parts(backWall, 'back', 2);
    update(at(0, 2, 3), renderer());
    expect([...left, ...back].map(shown)).toEqual([true, true, true, true, true]);
    update(at(-ROOM.width, 2, 0), renderer());
    expect(left.map(shown)).toEqual([false, false]);
    expect(back.map(shown)).toEqual([true, true, true]);
    update(at(0, 2, -ROOM.depth), renderer());
    expect(back.map(shown)).toEqual([false, false, false]);
    expect(left.map(shown)).toEqual([true, true]);
  });

  it('hides a wall for an eye inside its thickness, not only behind it', () => {
    const { backWall, update } = createRoom();
    update(at(0, 2, -ROOM.depth / 2 - STAGE.wallThickness / 2), renderer());
    expect(backWall.visible).toBe(false);
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
