import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { COLORS, STAGE } from '../constants.js';
import {
  bodyAt,
  celestial,
  closedSegments,
  cloudPolygon,
  cloudX,
  discPolygon,
  hillPolyline,
  hillSkyline,
  openSegments,
  sceneryBox,
  starlightAt,
  starMask,
  treePolygons,
} from '../game/scenery.js';
import type { BoxFace, Point } from '../game/scenery.js';
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
  // Mipmapped, so a hole shrinks steadily with distance instead of flickering across the alpha test; a hole too small
  // for the screen averages away to paper in the same way every frame.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
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

/** Flat x, y segment endpoints on the plane z, as x, y, z triples. */
function onPlane(flat: readonly number[], z: number): number[] {
  return Array.from({ length: (flat.length / 2) | 0 }, (_, i) => [flat[2 * i]!, flat[2 * i + 1]!, z]).flat();
}

/** The ink of a closed polygon on the plane z. */
const inkPositions = (polygon: readonly Point[], z: number) => onPlane(closedSegments(polygon), z);

/** A polygon as a flat triangulated shape, one `color` for every vertex, standing `z` out. */
function paper(polygon: readonly Point[], color: number, z: number) {
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x, y)))).translate(0, 0, z);
  return withColor(geometry, color);
}

/** The geometry with every vertex coloured, so cutouts of different tones merge into one mesh. */
function withColor(geometry: THREE.BufferGeometry, color: number) {
  const rgb = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [rgb.r, rgb.g, rgb.b]).flat(), 3));
  return geometry;
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

  // The light behind the back panel: the sky's own colour by day, so the pinholes vanish, starlight by night.
  const backlight = new THREE.Mesh(new THREE.PlaneGeometry(mouth.width, mouth.height), new THREE.MeshBasicMaterial());
  backlight.name = `${name}SceneryBacklight`;
  backlight.position.z = -depth;
  const starlight = new THREE.Color(COLORS.starlight);

  group.add(backlight, panel, skin);

  // The paper theatre: the box's inside and the static cutouts at their depths merge into one vertex-coloured mesh,
  // and their outlines (the box's edges, the hills' skylines, the trees) into one ink draw; only the sun or moon
  // and the cloud move, each its own fill and ink.
  const { scenery } = STAGE;
  const { inkLift } = scenery;
  const staticInk = [...edges];
  const cutouts = box.faces
    .filter((face) => face.name !== 'back')
    .map((face) => withColor(faceGeometry(face), COLORS.sceneryBoxInside));
  scenery.hills.forEach((hill, layer) => {
    cutouts.push(paper(hillPolyline(name, layer), hill.tone, -hill.depth));
    // Only the skyline is inked: the polygon's floor and sides lie in the box's own faces.
    staticInk.push(...onPlane(openSegments(hillSkyline(name, layer)), inkLift - hill.depth));
  });
  for (const tree of treePolygons(name)) {
    cutouts.push(paper(tree, COLORS.sceneryDark, -scenery.tree.depth));
    staticInk.push(...inkPositions(tree, inkLift - scenery.tree.depth));
  }
  const paperMesh = new THREE.Mesh(mergeGeometries(cutouts)!, new THREE.MeshBasicMaterial({ vertexColors: true }));
  paperMesh.name = `${name}SceneryPaper`;
  const staticLines = new LineSegments2(new LineSegmentsGeometry().setPositions(staticInk), ink);
  staticLines.name = `${name}SceneryInk`;
  group.add(paperMesh, staticLines);

  // A moving cutout: a fill and its ink in one group that `update` slides.
  const mover = (label: string, polygon: readonly Point[], color: number, depth: number, material: LineMaterial) => {
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x, y)))), new THREE.MeshBasicMaterial({ color }));
    const outline = new LineSegments2(new LineSegmentsGeometry().setPositions(inkPositions(polygon, inkLift)), material);
    const moving = new THREE.Group();
    moving.name = `${name}Scenery${label}`;
    moving.position.z = -depth;
    moving.add(fill, outline);
    group.add(moving);
    return { moving, fill, outline };
  };
  // One disc serves the sun by day and the moon by night — they are never up together — recoloured and scaled to
  // whichever is up.
  const body = mover('Body', discPolygon(scenery.sun.radius), COLORS.sceneryPaper, scenery.sun.depth, ink);
  const moonScale = scenery.moon.radius / scenery.sun.radius;

  // The cloud drifts across and wraps, so it is clipped to the box's sides: a cloud half past the edge must not show
  // outside the box. The planes are the box's sides in its own frame, carried to world space each frame from the
  // group's matrix, so they follow the room wherever it stands.
  const sidePlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), mouth.width / 2), new THREE.Plane(new THREE.Vector3(-1, 0, 0), mouth.width / 2)];
  const clips = sidePlanes.map((plane) => plane.clone());
  const cloudInk = ink.clone();
  cloudInk.clippingPlanes = clips;
  const cloud = mover('Cloud', cloudPolygon(name), COLORS.sceneryPaper, scenery.cloud.depth, cloudInk);
  (cloud.fill.material as THREE.MeshBasicMaterial).clippingPlanes = clips;

  let lit = NaN;
  let elapsed = 0;
  // Reused every frame, so the loop allocates nothing.
  const bodies = celestial(0);
  const spot: Point = [0, 0];
  return {
    group,
    /** Per frame: `phase` of the day and `delta` seconds of game time, after the sky material is painted for `phase`. */
    update(phase: number, delta: number) {
      elapsed += delta;
      cloud.moving.position.x = cloudX(mouth, elapsed);
      group.updateWorldMatrix(true, false);
      clips.forEach((clip, i) => clip.copy(sidePlanes[i]!).applyMatrix4(group.matrixWorld));
      cloudInk.resolution.copy(ink.resolution);
      if (phase === lit) return;
      lit = phase;
      (backlight.material as THREE.MeshBasicMaterial).color.copy(skyMaterial.color).lerp(starlight, starlightAt(phase));
      celestial(phase, bodies);
      const up = bodies.sun.visible ? bodies.sun : bodies.moon;
      const radius = bodies.sun.visible ? scenery.sun.radius : scenery.moon.radius;
      body.moving.visible = up.visible;
      if (!up.visible) return;
      (body.fill.material as THREE.MeshBasicMaterial).color.setHex(bodies.sun.visible ? COLORS.sceneryPaper : COLORS.sceneryFaint);
      body.moving.scale.setScalar(bodies.sun.visible ? 1 : moonScale);
      bodyAt(mouth, up, radius, spot);
      body.moving.position.x = spot[0];
      body.moving.position.y = spot[1];
    },
  };
}
