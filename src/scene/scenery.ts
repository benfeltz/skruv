import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { COLORS, STAGE } from '../constants.js';
import { sceneryBox, starlightAt, starMask } from '../game/scenery.js';
import type { BoxFace } from '../game/scenery.js';
import type { WallName } from '../game/stageBoxes.js';

/** One inner face as a plane in box-local coordinates, its +z normal turned into the box. */
function faceGeometry({ centre, width, height, rotation }: BoxFace) {
  return new THREE.PlaneGeometry(width, height).rotateX(rotation[0]).rotateY(rotation[1]).translate(...centre);
}

const CHANNELS = 4;

/**
 * Pierces the sky material with the pinhole mask, once: the mask is the alpha (a hole discards), so the backlight
 * behind the back panel shows through. A no-op when the material already has it, so every box shares the one sky.
 */
function pierceSky(skyMaterial: THREE.MeshBasicMaterial) {
  if (skyMaterial.alphaMap) return;
  const { texels, alphaTest } = STAGE.scenery.stars;
  const mask = starMask();
  // The alpha map reads the green channel, so the mask goes in all four.
  const data = new Uint8Array(mask.length * CHANNELS);
  mask.forEach((v, i) => data.fill(v, i * CHANNELS, (i + 1) * CHANNELS));
  const texture = new THREE.DataTexture(data, texels, texels, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  skyMaterial.alphaMap = texture;
  skyMaterial.alphaTest = alphaTest;
  skyMaterial.needsUpdate = true;
}

/** The panel's UVs in tiles of the mask, so a pinhole is the same size on every wall, the wall's own offset along. */
function tileUvs(geometry: THREE.PlaneGeometry, width: number, height: number, offset: number) {
  const { tile } = STAGE.scenery.stars;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (position.getX(i) + width / 2) / tile + offset, (position.getY(i) + height / 2) / tile);
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
  pierceSky(skyMaterial);
  const panelGeometry = new THREE.PlaneGeometry(mouth.width, mouth.height);
  tileUvs(panelGeometry, mouth.width, mouth.height, STAGE.scenery.stars.offset[name]);
  const panel = new THREE.Mesh(panelGeometry, skyMaterial);
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

  // The light behind the back panel: the sky's own colour by day, so the pinholes vanish, starlight by night.
  const backlight = new THREE.Mesh(new THREE.PlaneGeometry(mouth.width, mouth.height), new THREE.MeshBasicMaterial());
  backlight.name = `${name}SceneryBacklight`;
  backlight.position.z = -depth;
  const starlight = new THREE.Color(COLORS.starlight);

  group.add(inside, backlight, panel, skin, edgeInk);

  let lit = NaN;
  return {
    group,
    /** Per frame: `phase` of the day and `delta` seconds of game time, after the sky material is painted for `phase`. */
    update(phase: number, delta: number) {
      void delta;
      if (phase === lit) return;
      lit = phase;
      (backlight.material as THREE.MeshBasicMaterial).color.copy(skyMaterial.color).lerp(starlight, starlightAt(phase));
    },
  };
}
