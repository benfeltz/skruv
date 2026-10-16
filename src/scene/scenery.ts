import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { COLORS, STAGE } from '../constants.js';
import {
  bodyAt,
  boxTint,
  celestial,
  closedSegments,
  cloudLayerOffset,
  cloudLayerPolygons,
  discPolygon,
  hillPolyline,
  hillSkyline,
  openSegments,
  sceneryBox,
  starlightAt,
} from '../game/scenery.js';
import type { BoxFace, Point } from '../game/scenery.js';
import { skyColourAt } from '../game/skyCycle.js';
import type { Rgb } from '../game/skyCycle.js';
import { SKY_TEXELS, skyTexture, skyUv } from '../game/starSky.js';
import type { WallName } from '../game/stageBoxes.js';

/** One inner face as a plane in box-local coordinates, its +z normal turned into the box. */
function faceGeometry({ centre, width, height, rotation }: BoxFace) {
  return new THREE.PlaneGeometry(width, height).rotateX(rotation[0]).rotateY(rotation[1]).translate(...centre);
}

/**
 * Pierces the sky material with the night sky's pinhole mask, once: the mask is the alpha (a hole discards), so the
 * backlight behind the back panel shows through. A no-op when the material already has it, so every box shares the one sky.
 */
function pierceSky(skyMaterial: THREE.MeshBasicMaterial) {
  if (skyMaterial.alphaMap) return;
  // The alpha map reads the green channel, which the sky texture carries.
  const texture = new THREE.DataTexture(skyTexture(), SKY_TEXELS.width, SKY_TEXELS.height, THREE.RGBAFormat);
  // Mipmapped, so a hole shrinks steadily with distance instead of flickering across the alpha test; a hole too small
  // for the screen averages away to paper in the same way every frame.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  skyMaterial.alphaMap = texture;
  skyMaterial.alphaTest = STAGE.scenery.stars.alphaTest;
  skyMaterial.needsUpdate = true;
}

const BACKLIGHT_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The light behind the pinholes: the sky's own colour mixed toward starlight by `uLevel`, each star's share dimmed by
// its own slow swing — phase in the sky texture's red, swing in its blue (see twinkleAt in src/game/starSky.ts).
const BACKLIGHT_FRAGMENT = `
  uniform sampler2D uSky;
  uniform vec3 uSkyColour;
  uniform vec3 uStarColour;
  uniform float uLevel;
  uniform float uTime;
  uniform float uPeriod;
  uniform float uDepth;
  varying vec2 vUv;
  void main() {
    vec4 star = texture2D(uSky, vUv);
    float swing = 0.5 + 0.5 * sin(6.28318530718 * (uTime / uPeriod + star.r));
    float light = uLevel * (1.0 - uDepth * star.b * swing);
    gl_FragColor = vec4(mix(uSkyColour, uStarColour, light), 1.0);
    #include <colorspace_fragment>
  }
`;

/** The backlight's material: the sky texture it reads the twinkle from, and the colours and clock `update` moves. */
function backlightMaterial(sky: THREE.Texture) {
  const { period, depth } = STAGE.scenery.stars.twinkle;
  return new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: sky },
      uSkyColour: { value: new THREE.Color() },
      uStarColour: { value: new THREE.Color(COLORS.starlight) },
      uLevel: { value: 0 },
      uTime: { value: 0 },
      uPeriod: { value: period },
      uDepth: { value: depth },
    },
    vertexShader: BACKLIGHT_VERTEX,
    fragmentShader: BACKLIGHT_FRAGMENT,
  });
}

/** The panel's UVs on the wall's strip of the sky texture, so each constellation stands once where its wall shows it. */
function skyUvs(geometry: THREE.PlaneGeometry, name: WallName, height: number) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ...skyUv(name, position.getX(i), position.getY(i), height));
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
  skyUvs(panelGeometry, name, mouth.height);
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
  const backlightGeometry = new THREE.PlaneGeometry(mouth.width, mouth.height);
  skyUvs(backlightGeometry, name, mouth.height);
  const backlightLook = backlightMaterial(skyMaterial.alphaMap!);
  const backlight = new THREE.Mesh(backlightGeometry, backlightLook);
  backlight.name = `${name}SceneryBacklight`;
  backlight.position.z = -depth;

  group.add(backlight, panel, skin);

  // The paper theatre: the box's inside and the static cutouts at their depths merge into one vertex-coloured mesh,
  // and their outlines (the box's edges, the hills' skylines) into one ink draw; only the sun or moon
  // and each cloud layer move, each its own fill and ink.
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
  // Its material's colour is the tint `update` writes each frame (the vertex colours carry the tones), so the hills and
  // the box's inside dim and cool with the night; the ink does not.
  const paperMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const paperMesh = new THREE.Mesh(mergeGeometries(cutouts)!, paperMaterial);
  paperMesh.name = `${name}SceneryPaper`;
  const staticLines = new LineSegments2(new LineSegmentsGeometry().setPositions(staticInk), ink);
  staticLines.name = `${name}SceneryInk`;
  group.add(paperMesh, staticLines);

  // A moving cutout: a fill and its ink in one group that `update` slides.
  const mover = (label: string, polygons: readonly (readonly Point[])[], color: number, depth: number, material: LineMaterial) => {
    const fill = new THREE.Mesh(
      mergeGeometries(polygons.map((polygon) => new THREE.ShapeGeometry(new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x, y))))))!,
      new THREE.MeshBasicMaterial({ color }),
    );
    const outline = new LineSegments2(new LineSegmentsGeometry().setPositions(polygons.flatMap((polygon) => inkPositions(polygon, inkLift))), material);
    const moving = new THREE.Group();
    moving.name = `${name}Scenery${label}`;
    moving.position.z = -depth;
    moving.add(fill, outline);
    group.add(moving);
    return { moving, fill, outline };
  };
  // One disc serves the sun by day and the moon by night — they are never up together — recoloured and scaled to
  // whichever is up.
  const body = mover('Body', [discPolygon(scenery.sun.radius)], COLORS.sceneryPaper, scenery.sun.depth, ink);
  const moonScale = scenery.moon.radius / scenery.sun.radius;

  // The clouds drift across and wrap, so they are clipped to the box's sides: a cloud half past the edge must not show
  // outside the box. The planes are the box's sides in its own frame, carried to world space each frame from the
  // group's matrix, so they follow the room wherever it stands.
  const sidePlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), mouth.width / 2), new THREE.Plane(new THREE.Vector3(-1, 0, 0), mouth.width / 2)];
  const clips = sidePlanes.map((plane) => plane.clone());
  const cloudInk = ink.clone();
  cloudInk.clippingPlanes = clips;
  const sheets = scenery.clouds.layers.map((layer, i) => {
    const sheet = mover(`Cloud${i}`, cloudLayerPolygons(name, i), COLORS.sceneryPaper, layer.depth, cloudInk);
    (sheet.fill.material as THREE.MeshBasicMaterial).clippingPlanes = clips;
    return sheet;
  });
  // The clouds take the box's tint like the hills; the sun and moon do not: the moon is a light of its own.
  const cloudPaper = new THREE.Color(COLORS.sceneryPaper);

  let lit = NaN;
  let elapsed = 0;
  // Reused every frame, so the loop allocates nothing.
  const bodies = celestial(0);
  const spot: Point = [0, 0];
  const skyRgb: Rgb = [0, 0, 0];
  const tint: Rgb = [0, 0, 0];
  return {
    group,
    /** Per frame: `phase` of the day and `delta` seconds of game time, after the sky material is painted for `phase`. */
    update(phase: number, delta: number) {
      elapsed += delta;
      backlightLook.uniforms.uTime!.value = elapsed;
      sheets.forEach((sheet, i) => { sheet.moving.position.x = cloudLayerOffset(mouth, i, elapsed); });
      group.updateWorldMatrix(true, false);
      clips.forEach((clip, i) => clip.copy(sidePlanes[i]!).applyMatrix4(group.matrixWorld));
      cloudInk.resolution.copy(ink.resolution);
      if (phase === lit) return;
      lit = phase;
      backlightLook.uniforms.uSkyColour!.value.copy(skyMaterial.color);
      backlightLook.uniforms.uLevel!.value = starlightAt(phase);
      boxTint(phase, skyColourAt(phase, skyRgb), tint);
      // A multiplier, so linear: the daylight itself, not a colour to be gamma-lifted.
      paperMaterial.color.setRGB(tint[0], tint[1], tint[2], THREE.LinearSRGBColorSpace);
      for (const sheet of sheets) (sheet.fill.material as THREE.MeshBasicMaterial).color.copy(cloudPaper).multiply(paperMaterial.color);
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
