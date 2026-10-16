import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { COLORS } from '../constants.js';
import { sceneryBox } from '../game/scenery.js';
import type { BoxFace } from '../game/scenery.js';
import type { WallName } from '../game/stageBoxes.js';

/** One inner face as a plane in box-local coordinates, its +z normal turned into the box. */
function faceGeometry({ centre, width, height, rotation }: BoxFace) {
  return new THREE.PlaneGeometry(width, height).rotateX(rotation[0]).rotateY(rotation[1]).translate(...centre);
}

/**
 * One wall's diorama box, behind the mouth on the wall's outer face: a closed shoebox whose inside is a dark paper
 * tone with the sky at its back and whose outside is the void's colour, so from anywhere but the room's side of its
 * mouth it vanishes. Built once; the loop only calls `update`.
 */
export function createScenery(name: WallName, { ink, skyMaterial }: { ink: LineMaterial; skyMaterial: THREE.MeshBasicMaterial }) {
  const box = sceneryBox(name);
  const { mouth, depth } = box;
  const group = new THREE.Group();
  group.name = `${name}Scenery`;
  group.position.set(...mouth.centre);
  group.rotation.y = mouth.yaw;

  const sides = box.faces.filter((face) => face.name !== 'back');
  const inside = new THREE.Mesh(
    mergeGeometries(sides.map(faceGeometry))!,
    new THREE.MeshBasicMaterial({ color: COLORS.sceneryBoxInside }),
  );
  inside.name = `${name}SceneryInside`;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(mouth.width, mouth.height), skyMaterial);
  panel.name = `${name}SceneryPanel`;
  panel.position.z = -box.panelDepth;
  // The same five faces seen from outside: back-faces only, in the void's colour, exact (no tone mapping).
  const skin = new THREE.Mesh(
    mergeGeometries(box.faces.map(faceGeometry))!,
    new THREE.MeshBasicMaterial({ color: COLORS.background, side: THREE.BackSide, toneMapped: false }),
  );
  skin.name = `${name}ScenerySkin`;

  // The box's back rectangle and the four edges running to it, in ink.
  const [hw, hh] = [mouth.width / 2, mouth.height / 2];
  const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const edges = corners.flatMap(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % corners.length]!;
    return [x, y, -depth, nx, ny, -depth, x, y, 0, x, y, -depth];
  });
  const edgeInk = new LineSegments2(new LineSegmentsGeometry().setPositions(edges), ink);
  edgeInk.name = `${name}SceneryInk`;

  group.add(inside, panel, skin, edgeInk);

  return {
    group,
    /** Per frame: `phase` of the day and `delta` seconds of game time. */
    update(phase: number, delta: number) {
      void phase;
      void delta;
    },
  };
}
