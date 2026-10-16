import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { COLORS, STAGE } from '../constants.js';
import { advance, phaseFromClock, skyColourAt } from '../game/skyCycle.js';
import type { Rgb } from '../game/skyCycle.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sizeAndCentre, skyRects, stageBoxes, wallBox, wallPieces, windowBoxes, windowOpeningBoxes } from '../game/stageBoxes.js';
import type { StageBox, StageBoxName, WallName } from '../game/stageBoxes.js';
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
  // One unlit material for every sky plane: the cycle writes its colour once a frame.
  const skyMaterial = new THREE.MeshBasicMaterial({ color: COLORS.sky });

  const boxGeometry = (box: StageBox<string>) => {
    const { size, centre } = sizeAndCentre(box);
    return new THREE.BoxGeometry(...size).translate(...centre);
  };
  const edgesOf = (geometry: THREE.BufferGeometry) => new THREE.EdgesGeometry(geometry);

  // One group per box: the mesh and its ink travel together, so hiding it hides both.
  const pieces = new Map<StageBoxName, THREE.Group>();
  for (const box of stageBoxes()) {
    if (box.name.includes('Wall')) continue;
    const geometry = boxGeometry(box);
    const mesh = new THREE.Mesh(geometry, box.name === 'slab' ? floor : wall);
    mesh.receiveShadow = true;
    const edges = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(edgesOf(geometry)), ink);
    const piece = new THREE.Group();
    piece.name = box.name;
    piece.add(mesh, edges);
    pieces.set(box.name, piece);
    group.add(piece);
  }

  // Each wall is one group — its pieces merged into one mesh, the trim into another, one ink
  // for the whole, and a sky behind each window — so the cutaway hides them together and a
  // wall costs a handful of draws. The ink is the wall's outline plus the openings' edges and
  // the trim's own edges, not each piece's: no seams where the pieces meet.
  const buildWall = (name: WallName) => {
    const side = new THREE.Group();
    side.name = `${name}Wall`;
    const wallMesh = new THREE.Mesh(mergeGeometries(wallPieces(name).map(boxGeometry))!, wall);
    wallMesh.name = `${name}WallMesh`;
    const trimGeometry = mergeGeometries(windowBoxes(name).map(boxGeometry))!;
    const trimMesh = new THREE.Mesh(trimGeometry, trim);
    trimMesh.name = `${name}WindowTrim`;
    for (const mesh of [wallMesh, trimMesh]) mesh.receiveShadow = true;
    const inkGeometry = mergeGeometries([
      edgesOf(boxGeometry(wallBox(name))),
      ...windowOpeningBoxes(name).map((box) => edgesOf(boxGeometry(box))),
      edgesOf(trimGeometry),
    ])!;
    const wallInk = new LineSegments2(new LineSegmentsGeometry().setPositions(inkGeometry.getAttribute('position').array as Float32Array), ink);
    wallInk.name = `${name}WallInk`;
    side.add(wallMesh, trimMesh, wallInk);
    // The skies: flat unlit planes outside the openings facing the room, no ink.
    skyRects(name).forEach((sky, i) => {
      const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(sky.width, sky.height), skyMaterial);
      skyMesh.name = `${name}Sky${i}`;
      skyMesh.rotation.y = sky.yaw;
      skyMesh.position.set(...sky.centre);
      side.add(skyMesh);
    });
    group.add(side);
    return side;
  };
  const backWall = buildWall('back');
  const leftWall = buildWall('left');

  // Reused every frame: the eye as a tuple and the canvas size, so the loop allocates nothing.
  const eyeAt: Vec3 = [0, 0, 0];
  const size = new THREE.Vector2();
  // The sky's phase lives here; the scrub is seen once, when the knob moves it off what was last applied.
  let phase = phaseFromClock(new Date());
  let scrubbed = STAGE.sky.phase;
  const skyRgb: Rgb = [0, 0, 0];
  return {
    group,
    pieces,
    leftWall,
    backWall,
    /**
     * Per frame: hide the walls the eye is behind; keep the ink's resolution at the canvas's
     * CSS size, so `STAGE.inkWidth` is the same on screen at any pixel ratio; turn the sky
     * on by `delta` seconds of game time.
     */
    update(eye: THREE.Vector3, renderer: THREE.WebGLRenderer, delta: number) {
      eye.toArray(eyeAt);
      backWall.visible = !wallHidden(eyeAt, STAGE_WALLS.back);
      leftWall.visible = !wallHidden(eyeAt, STAGE_WALLS.left);
      renderer.getSize(size);
      if (!size.equals(ink.resolution)) ink.resolution.copy(size);
      if (STAGE.sky.phase !== scrubbed) {
        scrubbed = STAGE.sky.phase;
        phase = scrubbed;
      }
      phase = advance(phase, delta, STAGE.sky.cycleMinutes);
      skyColourAt(phase, skyRgb);
      skyMaterial.color.setRGB(skyRgb[0], skyRgb[1], skyRgb[2], THREE.SRGBColorSpace);
    },
  };
}
