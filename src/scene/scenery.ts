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

const cutout = (polygons: readonly (readonly Point[])[], material: THREE.Material) =>
  new THREE.Mesh(
    mergeGeometries(polygons.map((polygon) => new THREE.ShapeGeometry(new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x, y))))))!,
    material,
  );

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

  // The light behind the back panel: the sky's own colour by day, so the pinholes vanish, starlight by night.
  const backlight = new THREE.Mesh(new THREE.PlaneGeometry(mouth.width, mouth.height), new THREE.MeshBasicMaterial());
  backlight.name = `${name}SceneryBacklight`;
  backlight.position.z = -depth;
  const starlight = new THREE.Color(COLORS.starlight);

  group.add(inside, backlight, panel, skin);

  // The paper theatre: cutouts at their depths, each an ink-outlined silhouette. The static outlines (the box's
  // edges, the hills, the trees) share one ink draw.
  const { scenery } = STAGE;
  const { inkLift } = scenery;
  const staticInk = [...edges];
  const unlit = (color: number) => new THREE.MeshBasicMaterial({ color });
  scenery.hills.forEach((hill, layer) => {
    const polygon = hillPolyline(name, layer);
    const mesh = cutout([polygon], unlit(hill.tone));
    mesh.name = `${name}SceneryHill${layer}`;
    mesh.position.z = -hill.depth;
    group.add(mesh);
    // Only the skyline is inked: the polygon's floor and sides lie in the box's own faces.
    staticInk.push(...onPlane(openSegments(hillSkyline(name, layer)), inkLift - hill.depth));
  });
  const trees = treePolygons(name);
  if (trees.length > 0) {
    const mesh = cutout(trees, unlit(COLORS.sceneryDark));
    mesh.name = `${name}SceneryTrees`;
    mesh.position.z = -scenery.tree.depth;
    group.add(mesh);
    for (const tree of trees) staticInk.push(...inkPositions(tree, inkLift - scenery.tree.depth));
  }
  const staticLines = new LineSegments2(new LineSegmentsGeometry().setPositions(staticInk), ink);
  staticLines.name = `${name}SceneryInk`;
  group.add(staticLines);

  // A moving cutout: a fill and its ink in one group that `update` slides.
  const mover = (label: string, polygon: readonly Point[], color: number, depth: number, material: LineMaterial) => {
    const fill = cutout([polygon], unlit(color));
    const outline = new LineSegments2(new LineSegmentsGeometry().setPositions(inkPositions(polygon, inkLift)), material);
    const moving = new THREE.Group();
    moving.name = `${name}Scenery${label}`;
    moving.position.z = -depth;
    moving.add(fill, outline);
    group.add(moving);
    return { moving, fill, outline };
  };
  const sun = mover('Sun', discPolygon(scenery.sun.radius), COLORS.sceneryPaper, scenery.sun.depth, ink);
  const moon = mover('Moon', discPolygon(scenery.moon.radius), COLORS.sceneryFaint, scenery.moon.depth, ink);

  // The cloud drifts across and wraps, so it is clipped to the box's sides, in the room's frame (the room stands
  // at the origin): a cloud half past the edge must not show outside the box.
  const along = new THREE.Vector3(Math.cos(mouth.yaw), 0, -Math.sin(mouth.yaw));
  const centre = new THREE.Vector3(...mouth.centre);
  const clips = [
    new THREE.Plane(along.clone(), mouth.width / 2 - along.dot(centre)),
    new THREE.Plane(along.clone().negate(), mouth.width / 2 + along.dot(centre)),
  ];
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
      cloudInk.resolution.copy(ink.resolution);
      if (phase === lit) return;
      lit = phase;
      (backlight.material as THREE.MeshBasicMaterial).color.copy(skyMaterial.color).lerp(starlight, starlightAt(phase));
      celestial(phase, bodies);
      sun.moving.visible = bodies.sun.visible;
      moon.moving.visible = bodies.moon.visible;
      bodyAt(mouth, bodies.sun, scenery.sun.radius, spot);
      sun.moving.position.x = spot[0];
      sun.moving.position.y = spot[1];
      bodyAt(mouth, bodies.moon, scenery.moon.radius, spot);
      moon.moving.position.x = spot[0];
      moon.moving.position.y = spot[1];
    },
  };
}
