import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { COLORS, STAGE } from '../constants.js';
import { LEFT_WALL_PIECES, sizeAndCentre, skyRect, stageBoxes, windowBoxes } from '../game/stageBoxes.js';
import type { StageBox, StageBoxName } from '../game/stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { STAGE_WALLS, wallHidden } from './stageCutaway.js';

/**
 * The diorama: a base slab whose top is the floor, a back wall and a left wall with a window in it, and a low lip on
 * the front and right edges, every edge in ink. Built once; `update` only flips a wall's
 * visibility (its ink lines go with it) and keeps the line resolution current.
 */
export function createRoom() {
  const group = new THREE.Group();
  group.name = 'room';

  const ink = new LineMaterial({ color: COLORS.stageInk, linewidth: STAGE.inkWidth });
  const floor = new THREE.MeshStandardMaterial({ color: COLORS.floor });
  const wall = new THREE.MeshStandardMaterial({ color: COLORS.wall });
  const trim = new THREE.MeshStandardMaterial({ color: COLORS.trim });
  const materials: Record<StageBoxName, THREE.Material> = {
    slab: floor,
    backWall: wall,
    leftWallBelow: wall,
    leftWallAbove: wall,
    leftWallFront: wall,
    leftWallBack: wall,
    frontLip: wall,
    rightLip: wall,
  };

  // One group per box: the mesh and its ink travel together, so hiding it hides both.
  const inked = (box: StageBox<string>, material: THREE.Material) => {
    const { size, centre } = sizeAndCentre(box);
    const geometry = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    const edges = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geometry)), ink);
    const piece = new THREE.Group();
    piece.name = box.name;
    piece.position.set(...centre);
    piece.add(mesh, edges);
    return piece;
  };

  // The left wall is one group — its four pieces, the window's trim and the sky — so the
  // cutaway hides them together.
  const leftWall = new THREE.Group();
  leftWall.name = 'leftWall';
  const pieces = new Map<StageBoxName, THREE.Group>();
  for (const box of stageBoxes()) {
    const piece = inked(box, materials[box.name]);
    pieces.set(box.name, piece);
    ((LEFT_WALL_PIECES as readonly string[]).includes(box.name) ? leftWall : group).add(piece);
  }
  for (const box of windowBoxes()) leftWall.add(inked(box, trim));

  // The sky: a flat unlit plane outside the opening facing the room (+x), no ink.
  const sky = skyRect();
  const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(sky.width, sky.height), new THREE.MeshBasicMaterial({ color: COLORS.sky }));
  skyMesh.name = 'sky';
  skyMesh.rotation.y = Math.PI / 2;
  skyMesh.position.set(...sky.centre);
  leftWall.add(skyMesh);
  group.add(leftWall);

  const backWall = pieces.get('backWall')!;
  // Reused every frame: the eye as a tuple and the canvas size, so the loop allocates nothing.
  const eyeAt: Vec3 = [0, 0, 0];
  const size = new THREE.Vector2();
  return {
    group,
    pieces,
    leftWall,
    /**
     * Per frame: hide the walls the eye is behind; keep the ink's resolution at the canvas's
     * CSS size, so `STAGE.inkWidth` is the same on screen at any pixel ratio.
     */
    update(eye: THREE.Vector3, renderer: THREE.WebGLRenderer) {
      eye.toArray(eyeAt);
      backWall.visible = !wallHidden(eyeAt, STAGE_WALLS.back);
      leftWall.visible = !wallHidden(eyeAt, STAGE_WALLS.left);
      renderer.getSize(size);
      if (!size.equals(ink.resolution)) ink.resolution.copy(size);
    },
  };
}
