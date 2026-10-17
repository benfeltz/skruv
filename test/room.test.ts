import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { COLORS, ROOM, STAGE } from '../src/constants.js';
import { sceneryMouth } from '../src/game/stageBoxes.js';
import { createRoom } from '../src/scene/room.js';

// A stand-in renderer: the room only asks it for the drawing buffer's size.
const renderer = (width = 800, height = 600) => ({ getSize: (target: THREE.Vector2) => target.set(width, height) }) as unknown as THREE.WebGLRenderer;
const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const bounds = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);

const uvsOf = (mesh: THREE.Mesh) => Array.from(mesh.geometry.getAttribute('uv').array);
const panelUvs = (room: ReturnType<typeof createRoom>) => uvsOf(room.backWall.getObjectByName('backSceneryPanel') as THREE.Mesh);
const backlightUvs = (room: ReturnType<typeof createRoom>) => uvsOf(room.backWall.getObjectByName('backSceneryBacklight') as THREE.Mesh);
const sceneryHalfWidth = () => sceneryMouth('back').width / 2;

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

  it('draws a wall\'s scenery in a handful of meshes, not one per cutout', () => {
    const meshes: THREE.Object3D[] = [];
    backWall.getObjectByName('backScenery')!.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as { isLineSegments2?: boolean }).isLineSegments2) meshes.push(o); });
    expect(meshes.length).toBeLessThanOrEqual(12);
  });

  it('holds a wall, its window trim, its ink and one scenery box in the wall\'s one group', () => {
    expect(names(leftWall)).toEqual(['leftScenery', 'leftWallInk', 'leftWallMesh', 'leftWindowTrim']);
    expect(names(backWall)).toEqual(['backScenery', 'backWallInk', 'backWallMesh', 'backWindowTrim']);
  });

  it('opens each box on its wall\'s outer face and reaches back behind it, never above the wall top', () => {
    for (const [wall, name, across, sign] of [[leftWall, 'left', 'x', -1], [backWall, 'back', 'z', -1]] as const) {
      const scenery = wall.getObjectByName(`${name}Scenery`)!;
      const box = bounds(scenery);
      expect(box.max.y).toBeLessThanOrEqual(STAGE.wallHeight + 1e-6);
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
      const edge = sign * (across === 'x' ? ROOM.width : ROOM.depth) / 2 - STAGE.wallThickness;
      expect(box.max[across]).toBeCloseTo(edge, 6);
      expect(box.min[across]).toBeCloseTo(edge - STAGE.scenery.depth, 6);
    }
  });

  it('paints each box\'s back panel with the one sky material, inside facing the room', () => {
    const normal = (object: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
    const panels = [leftWall.getObjectByName('leftSceneryPanel')!, backWall.getObjectByName('backSceneryPanel')!] as THREE.Mesh[];
    expect(new Set(panels.map((p) => p.material)).size).toBe(1);
    expect(panels[0]!.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(normal(panels[0]!).x).toBeCloseTo(1, 6);
    expect(normal(panels[1]!).z).toBeCloseTo(1, 6);
  });

  it('draws the box\'s outside in the void\'s colour, back faces only, so it vanishes from outside', () => {
    for (const [wall, name] of [[leftWall, 'left'], [backWall, 'back']] as const) {
      const skin = wall.getObjectByName(`${name}ScenerySkin`) as THREE.Mesh;
      const material = skin.material as THREE.MeshBasicMaterial;
      expect(material.side).toBe(THREE.BackSide);
      expect(material.color.getHex()).toBe(COLORS.background);
    }
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
    update(at(0, 2, -ROOM.depth), renderer(), 0);
    expect(backWall.visible).toBe(false);
    expect(leftWall.visible).toBe(true);
    update(at(0, 2, ROOM.depth), renderer(), 0);
    expect(backWall.visible).toBe(true);
  });

  it('hides the left wall from behind it, and both from behind the corner', () => {
    const { backWall, leftWall, update } = createRoom();
    update(at(-ROOM.width, 2, 0), renderer(), 0);
    expect(leftWall.visible).toBe(false);
    expect(backWall.visible).toBe(true);
    update(at(-ROOM.width, 2, -ROOM.depth), renderer(), 0);
    expect([backWall.visible, leftWall.visible]).toEqual([false, false]);
  });

  it('hides each wall\'s windows and scenery box with it, as one group', () => {
    const { leftWall, backWall, update } = createRoom();
    const parts = (wall: THREE.Group, name: string) => [wall.getObjectByName(`${name}WindowTrim`)!, wall.getObjectByName(`${name}Scenery`)!];
    const left = parts(leftWall, 'left');
    const back = parts(backWall, 'back');
    update(at(0, 2, 3), renderer(), 0);
    expect([...left, ...back].map(shown)).toEqual([true, true, true, true]);
    update(at(-ROOM.width, 2, 0), renderer(), 0);
    expect(left.map(shown)).toEqual([false, false]);
    expect(back.map(shown)).toEqual([true, true]);
    update(at(0, 2, -ROOM.depth), renderer(), 0);
    expect(back.map(shown)).toEqual([false, false]);
    expect(left.map(shown)).toEqual([true, true]);
  });

  it('hides a wall for an eye inside its thickness, not only behind it', () => {
    const { backWall, update } = createRoom();
    update(at(0, 2, -ROOM.depth / 2 - STAGE.wallThickness / 2), renderer(), 0);
    expect(backWall.visible).toBe(false);
  });

  it('never hides the slab or the lips', () => {
    const { pieces, update } = createRoom();
    update(at(-ROOM.width, 2, -ROOM.depth), renderer(), 0);
    for (const name of ['slab', 'frontLip', 'rightLip'] as const) expect(pieces.get(name)!.visible, name).toBe(true);
  });

  it('keeps the ink resolution at the canvas CSS size, whatever the pixel ratio', () => {
    const { pieces, update } = createRoom();
    update(at(0, 2, 3), renderer(1170, 2532), 0);
    const lines = pieces.get('slab')!.children[1] as unknown as { material: { resolution: THREE.Vector2 } };
    expect(lines.material.resolution.toArray()).toEqual([1170, 2532]);
  });

  it('builds no geometry per frame', () => {
    const { pieces, update } = createRoom();
    const geometries = () => [...pieces.values()].flatMap((piece) => piece.children.map((child) => (child as THREE.Mesh).geometry));
    const before = geometries();
    for (let i = 0; i < 5; i++) update(at(i, 2, 3), renderer(), 0);
    const after = geometries();
    expect(after).toHaveLength(before.length);
    after.forEach((geometry, i) => expect(geometry).toBe(before[i]));
  });
});

describe('the sky turns', () => {
  const skyMeshes = (room: ReturnType<typeof createRoom>) =>
    [room.leftWall.getObjectByName('leftSceneryPanel'), room.backWall.getObjectByName('backSceneryPanel')] as THREE.Mesh[];
  const skyColour = (room: ReturnType<typeof createRoom>) => (skyMeshes(room)[0]!.material as THREE.MeshBasicMaterial).color.clone();
  const saved = { ...STAGE.sky };
  afterEach(() => { STAGE.sky.phase = saved.phase; STAGE.sky.cycleMinutes = saved.cycleMinutes; });

  it('shares one material across every back panel', () => {
    const materials = new Set(skyMeshes(createRoom()).map((m) => m.material));
    expect(materials.size).toBe(1);
  });

  it('pierces the one sky material with the pinhole mask, a hole where a star shows', () => {
    const [panel] = skyMeshes(createRoom());
    const material = panel!.material as THREE.MeshBasicMaterial;
    expect(material.alphaMap).not.toBeNull();
    expect(material.alphaTest).toBe(STAGE.scenery.stars.alphaTest);
    // Mipmapped, so a pinhole fades with distance rather than flickering under the alpha test.
    expect(material.alphaMap!.generateMipmaps).toBe(true);
    expect(material.alphaMap!.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  it('lights the backlight to the stars at night and to nothing but the sky\'s own colour at noon', () => {
    const room = createRoom();
    const backlight = room.backWall.getObjectByName('backSceneryBacklight') as THREE.Mesh;
    const uniforms = (backlight.material as THREE.ShaderMaterial).uniforms as Record<string, { value: number & THREE.Color }>;
    // The knob starts on noon, where a room built at another hour is not scrubbed: move it off and back.
    STAGE.sky.phase = 0.4;
    room.update(at(0, 2, 3), renderer(), 0);
    STAGE.sky.phase = 0.5;
    room.update(at(0, 2, 3), renderer(), 0);
    expect(uniforms.uLevel!.value).toBe(0);
    expect(uniforms.uSkyColour!.value.equals(skyColour(room))).toBe(true);
    STAGE.sky.phase = 0;
    room.update(at(0, 2, 3), renderer(), 0);
    expect(uniforms.uLevel!.value).toBe(1);
    expect(uniforms.uStarColour!.value.getHex()).toBe(COLORS.starlight);
    STAGE.sky.phase = 0.75;
    room.update(at(0, 2, 3), renderer(), 0);
    expect(uniforms.uLevel!.value).toBe(0);
  });

  it('runs the twinkle on the room\'s clock, from the sky texture the pinholes are cut from', () => {
    const room = createRoom();
    const backlight = room.backWall.getObjectByName('backSceneryBacklight') as THREE.Mesh;
    const uniforms = (backlight.material as THREE.ShaderMaterial).uniforms as Record<string, { value: number | THREE.Texture }>;
    const panel = room.backWall.getObjectByName('backSceneryPanel') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(uniforms.uSky!.value).toBe(panel.material.alphaMap);
    expect(uniforms.uPeriod!.value).toBe(STAGE.scenery.stars.twinkle.period);
    expect(uniforms.uDepth!.value).toBe(STAGE.scenery.stars.twinkle.depth);
    const before = uniforms.uTime!.value as number;
    room.update(at(0, 2, 3), renderer(), 2.5);
    room.update(at(0, 2, 3), renderer(), 1);
    expect((uniforms.uTime!.value as number) - before).toBeCloseTo(3.5, 9);
    // The backlight shares the panel's coordinates, so a hole finds its own star's twinkle behind it.
    expect(backlightUvs(room)).toEqual(panelUvs(room));
  });

  it('dims and cools the box\'s paper and clouds with the night, keeps the ink black and the moon bright', () => {
    const room = createRoom();
    const run = (phase: number) => {
      STAGE.sky.phase = phase;
      room.update(at(0, 2, 3), renderer(), 0);
    };
    const wall = room.backWall;
    const paper = (wall.getObjectByName('backSceneryPaper') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const cloud = ((wall.getObjectByName('backSceneryCloud0') as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const ink = (wall.getObjectByName('backSceneryInk') as unknown as { material: { color: THREE.Color } }).material.color;
    const inkNoon = ink.getHex();
    const disc = ((wall.getObjectByName('backSceneryBody') as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    run(0.4);
    run(0.5);
    expect(paper.color.toArray()).toEqual([1, 1, 1]);
    expect(cloud.color.getHex()).toBe(COLORS.sceneryPaper);
    const lum = (c: THREE.Color) => c.r + c.g + c.b;
    const noonCloud = lum(cloud.color);
    run(0);
    // A quarter-bright, cool tint on the paper (vertex colours carry the tones), and on the clouds.
    expect(paper.color.b).toBeCloseTo(STAGE.scenery.nightLevel, 2);
    expect(paper.color.b).toBeGreaterThan(paper.color.r);
    expect(lum(cloud.color)).toBeLessThan(noonCloud / 2);
    expect(cloud.color.b).toBeGreaterThan(cloud.color.r * 1.2);
    // The ink stays black, and the moon is its own light: untinted, in the moon's own tone.
    expect(ink.getHex()).toBe(inkNoon);
    expect(ink.getHex()).toBe(COLORS.ink);
    expect(disc.color.getHex()).toBe(COLORS.sceneryFaint);
  });

  it('leaves the room\'s own materials and lights alone through the whole day', () => {
    const room = createRoom();
    const owned = () => {
      const colours: string[] = [];
      room.group.traverse((o) => {
        expect(o).not.toBeInstanceOf(THREE.Light);
        const material = (o as THREE.Mesh).material as (THREE.Material & { color?: THREE.Color }) | undefined;
        if (material?.color && !/Scenery/.test(o.name) && !/Scenery/.test(o.parent?.name ?? '')) colours.push(`${o.name}:${material.color.getHex()}`);
      });
      return colours;
    };
    const before = owned();
    for (const phase of [0.4, 0, 0.25, 0.75]) {
      STAGE.sky.phase = phase;
      room.update(at(0, 2, 3), renderer(), 0);
    }
    expect(owned()).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it('shows one disc: the sun by day and the moon, smaller and fainter, by night, wholly inside its box', () => {
    const room = createRoom();
    const body = room.backWall.getObjectByName('backSceneryBody')!;
    const tone = () => ((body.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
    const at_ = (phase: number) => {
      STAGE.sky.phase = phase;
      room.update(at(0, 2, 3), renderer(), 0);
    };
    at_(0.4);
    at_(0.5);
    expect([body.visible, tone(), body.scale.x]).toEqual([true, COLORS.sceneryPaper, 1]);
    at_(0);
    expect(body.visible).toBe(true);
    expect(tone()).toBe(COLORS.sceneryFaint);
    expect(body.scale.x).toBeCloseTo(STAGE.scenery.moon.radius / STAGE.scenery.sun.radius, 9);
    at_(0.25);
    expect(body.visible).toBe(false);
    for (const phase of [0.3, 0.5, 0.7, 0.05, 0.95]) {
      at_(phase);
      const disc = bounds(body);
      const box = bounds(room.backWall.getObjectByName('backScenery')!);
      expect(disc.min.x).toBeGreaterThanOrEqual(box.min.x - 1e-6);
      expect(disc.max.x).toBeLessThanOrEqual(box.max.x + 1e-6);
      expect(disc.max.y).toBeLessThanOrEqual(box.max.y + 1e-6);
    }
  });

  it('clips every drifting cloud layer to its box\'s sides, fill and ink', () => {
    const room = createRoom();
    for (const layer of [0, 1]) {
      const cloud = room.backWall.getObjectByName(`backSceneryCloud${layer}`)!;
      const planes = (cloud.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.clippingPlanes;
      expect(planes).toHaveLength(2);
      expect((cloud.children[1] as unknown as { material: THREE.Material }).material.clippingPlanes).toHaveLength(2);
    }
  });

  it('drifts the layers at their own rates', () => {
    const room = createRoom();
    const layers = [0, 1].map((i) => room.backWall.getObjectByName(`backSceneryCloud${i}`)!);
    room.update(at(0, 2, 3), renderer(), 10);
    const [a, b] = layers.map((l) => l.position.x) as [number, number];
    expect(a).toBeCloseTo(10 * STAGE.scenery.clouds.layers[0]!.drift, 6);
    expect(b).toBeCloseTo(10 * STAGE.scenery.clouds.layers[1]!.drift, 6);
    expect(b).toBeGreaterThan(a);
  });

  it('keeps the cloud\'s clip planes on the box\'s sides wherever the room stands', () => {
    const room = createRoom();
    room.group.position.set(5, 1, -2);
    room.group.rotation.y = 0.7;
    room.update(at(0, 2, 3), renderer(), 1);
    const cloud = room.backWall.getObjectByName('backSceneryCloud0')!;
    const scenery = room.backWall.getObjectByName('backScenery')!;
    const planes = (cloud.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.clippingPlanes!;
    room.group.updateMatrixWorld(true);
    const edges = [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0)].map((v) => v.multiplyScalar(sceneryHalfWidth()).applyMatrix4(scenery.matrixWorld));
    // Each side's own edge lies on its plane, and the box's middle is inside both.
    edges.forEach((edge, i) => expect(planes[i]!.distanceToPoint(edge)).toBeCloseTo(0, 6));
    expect(planes.every((p) => p.distanceToPoint(scenery.getWorldPosition(new THREE.Vector3())) > 0)).toBe(true);
  });

  it('merges the box\'s inside, the hills into one paper mesh, all inside the box', () => {
    const { backWall, leftWall } = createRoom();
    for (const wall of [backWall, leftWall]) {
      wall.updateMatrixWorld(true);
      const name = wall === backWall ? 'back' : 'left';
      const box = bounds(wall.getObjectByName(`${name}Scenery`)!);
      const parts = [`${name}SceneryPaper`].map((n) => wall.getObjectByName(n)!);
      for (const part of parts) {
        const b = bounds(part);
        expect(b.min.distanceTo(b.max)).toBeGreaterThan(0);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(b.min[axis]).toBeGreaterThanOrEqual(box.min[axis] - 1e-6);
          expect(b.max[axis]).toBeLessThanOrEqual(box.max[axis] + 1e-6);
        }
      }
    }
  });

  it('moves the colour when game time passes', () => {
    const room = createRoom();
    STAGE.sky.phase = 0.3;
    room.update(at(0, 2, 3), renderer(), 0);
    const before = skyColour(room);
    room.update(at(0, 2, 3), renderer(), 20);
    expect(skyColour(room).equals(before)).toBe(false);
  });

  it('jumps to a scrubbed phase, then keeps advancing from it', () => {
    const room = createRoom();
    STAGE.sky.phase = 0.4;
    room.update(at(0, 2, 3), renderer(), 0);
    STAGE.sky.phase = 0.5;
    room.update(at(0, 2, 3), renderer(), 0);
    const noon = skyColour(room);
    expect(noon.getHex()).toBe(COLORS.sky);
    STAGE.sky.phase = 0;
    room.update(at(0, 2, 3), renderer(), 0);
    const midnight = skyColour(room);
    expect(midnight.equals(noon)).toBe(false);
    room.update(at(0, 2, 3), renderer(), 30);
    expect(skyColour(room).equals(midnight)).toBe(false);
  });

  it('changes the sky material and nothing else the room owns, and the room owns no light', () => {
    const room = createRoom();
    const sky = skyMeshes(room)[0]!.material;
    const others = () => {
      const colours: [string, number][] = [];
      room.group.traverse((o) => {
        expect(o).not.toBeInstanceOf(THREE.Light);
        const material = (o as THREE.Mesh).material as THREE.Material & { color?: THREE.Color } | undefined;
        // The backlight behind a back panel and the sun-or-moon disc follow the sky too; everything else holds still.
        const follows = /Scenery(Backlight|Paper)$/.test(o.name) || /Scenery(Body|Cloud\d)$/.test(o.parent?.name ?? '');
        if (material?.color && material !== sky && !follows) colours.push([o.name, material.color.getHex()]);
      });
      return colours;
    };
    const before = others();
    expect(before.length).toBeGreaterThan(0);
    STAGE.sky.phase = 0;
    room.update(at(0, 2, 3), renderer(), 10);
    expect(others()).toEqual(before);
  });

  it('mirrors the live phase into the knob, so scrubbing to where the sky is changes nothing', () => {
    const room = createRoom();
    STAGE.sky.phase = 0.2;
    room.update(at(0, 2, 3), renderer(), 0);
    room.update(at(0, 2, 3), renderer(), 36);
    expect(STAGE.sky.phase).toBeCloseTo(0.25, 9);
    const here = skyColour(room);
    STAGE.sky.phase = 0.25 + 0; // the sky's own phase: not a scrub
    room.update(at(0, 2, 3), renderer(), 0);
    expect(skyColour(room).equals(here)).toBe(true);
  });
});
