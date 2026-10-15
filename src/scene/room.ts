import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { COLORS, STAGE } from '../constants.js';
import { sizeAndCentre, stageBoxes } from '../game/stageBoxes.js';
import type { StageBoxName } from '../game/stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { STAGE_WALLS, wallHidden } from './stageCutaway.js';

/**
 * The diorama: a base slab whose top is the floor, a back and a left wall, and a low lip on
 * the front and right edges, every edge in ink. Built once; `update` only flips a wall's
 * visibility (its ink lines go with it) and keeps the line resolution current.
 */
export function createRoom() {
  const group = new THREE.Group();
  group.name = 'room';

  const ink = new LineMaterial({ color: COLORS.stageInk, linewidth: STAGE.inkWidth });
  const floor = new THREE.MeshStandardMaterial({ color: COLORS.floor });
  const wall = new THREE.MeshStandardMaterial({ color: COLORS.wall });
  const materials: Record<StageBoxName, THREE.Material> = { slab: floor, backWall: wall, leftWall: wall, frontLip: wall, rightLip: wall };

  // One group per box: the mesh and its ink travel together, so hiding it hides both.
  const pieces = new Map<StageBoxName, THREE.Group>();
  for (const box of stageBoxes()) {
    const { size, centre } = sizeAndCentre(box);
    const geometry = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, materials[box.name]);
    mesh.receiveShadow = true;
    const edges = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geometry)), ink);
    const piece = new THREE.Group();
    piece.name = box.name;
    piece.position.set(...centre);
    piece.add(mesh, edges);
    pieces.set(box.name, piece);
    group.add(piece);
  }

  const backWall = pieces.get('backWall')!;
  const leftWall = pieces.get('leftWall')!;
  // Reused every frame: the eye as a tuple and the canvas size, so the loop allocates nothing.
  const eyeAt: Vec3 = [0, 0, 0];
  const size = new THREE.Vector2();
  return {
    group,
    pieces,
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
