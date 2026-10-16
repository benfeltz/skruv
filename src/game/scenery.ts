// Pure geometry and timing of the paper theatre behind each wall's windows — no Three, no DOM — so the box, its
// cutouts, the sun and moon and the stars are worked out headlessly and the scene only draws them.
//
// Box-local coordinates, in metres: the origin is the mouth's centre on the wall's outer face, x runs along the wall
// (left to right as seen from the room), y up, and the room lies towards +z, so the box reaches back to z = -depth.
// Hills are sampled by WORLD position along the wall, so the back wall's two windows look into one continuous scene
// across the pier, and each wall is its own slice.

import { STAGE } from '../constants.js';
import { sceneryMouth } from './stageBoxes.js';
import type { SceneryMouth, WallName } from './stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

export type Point = [number, number];

const { scenery } = STAGE;
const TAU = Math.PI * 2;

/** One inner face of the box: a plane by centre and size, turned by Euler x then y so its +z normal faces into the box. */
export interface BoxFace {
  name: 'back' | 'left' | 'right' | 'bottom' | 'top';
  centre: Vec3;
  width: number;
  height: number;
  rotation: [number, number];
}

export interface SceneryBox {
  mouth: SceneryMouth;
  depth: number;
  /** How far behind the mouth the sky panel stands: `depth` less the gap to the backlight. */
  panelDepth: number;
  /** The five inner faces; the back one stands at `depth`, where the backlight is. */
  faces: BoxFace[];
}

/** The box behind a wall's windows and its five inner faces, normals into the box. */
export function sceneryBox(name: WallName): SceneryBox {
  const mouth = sceneryMouth(name);
  const { depth } = scenery;
  const { width, height } = mouth;
  const quarter = Math.PI / 2;
  return {
    mouth,
    depth,
    panelDepth: depth - scenery.backlight.gap,
    faces: [
      { name: 'back', centre: [0, 0, -depth], width, height, rotation: [0, 0] },
      { name: 'left', centre: [-width / 2, 0, -depth / 2], width: depth, height, rotation: [0, quarter] },
      { name: 'right', centre: [width / 2, 0, -depth / 2], width: depth, height, rotation: [0, -quarter] },
      { name: 'bottom', centre: [0, -height / 2, -depth / 2], width, height: depth, rotation: [-quarter, 0] },
      { name: 'top', centre: [0, height / 2, -depth / 2], width, height: depth, rotation: [quarter, 0] },
    ],
  };
}

/** The world height (metres above the floor) of hill layer `layer` at `along`, a world position on the wall's axis. */
export function hillHeight(along: number, layer: number): number {
  const hill = scenery.hills[layer]!;
  const { ratio, weight } = scenery.hillDetail;
  const swell = (1 - weight) * Math.sin((TAU * along) / hill.wavelength + hill.phase)
    + weight * Math.sin((TAU * along) / (hill.wavelength * ratio) + 2 * hill.phase);
  return hill.base * STAGE.wallHeight + hill.amplitude * swell;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Box-local x for a world position along the wall, and back. */
const localX = (mouth: SceneryMouth, along: number) => mouth.alongSign * (along - mouth.alongCentre);

/**
 * Hill layer `layer` as a polygon in box-local coordinates, wound from the box floor's left corner up and along the
 * profile and down to the right corner (the last point joins the first); the profile never leaves the mouth.
 */
export function hillPolyline(name: WallName, layer: number): Point[] {
  const mouth = sceneryMouth(name);
  const samples = Math.max(2, Math.ceil(mouth.width * scenery.hillSamplesPerMetre));
  const half = mouth.height / 2;
  const profile: Point[] = Array.from({ length: samples + 1 }, (_, i) => {
    const x = -mouth.width / 2 + (mouth.width * i) / samples;
    const along = mouth.alongCentre + mouth.alongSign * x;
    return [x, clamp(hillHeight(along, layer) - mouth.centre[1], -half, half)];
  });
  return [[-mouth.width / 2, -half], ...profile, [mouth.width / 2, -half]];
}

/** The trees on a wall's near hill as polygons in box-local coordinates, base on the hill; only those wholly in the mouth. */
export function treePolygons(name: WallName): Point[][] {
  const mouth = sceneryMouth(name);
  const near = scenery.hills.length - 1;
  const { height, outline, at } = scenery.tree;
  return at[name]
    .map((along): Point[] => {
      const x = localX(mouth, along);
      const base = hillHeight(along, near) - mouth.centre[1];
      return outline.map(([u, v]): Point => [x + u * height, base + v * height]);
    })
    .filter((tree) => tree.every(([x, y]) => Math.abs(x) <= mouth.width / 2 && Math.abs(y) <= mouth.height / 2));
}

/** The cloud's silhouette in box-local coordinates, centred on x = 0 at its height. */
export function cloudPolygon(name: WallName): Point[] {
  const mouth = sceneryMouth(name);
  const { outline, width, height } = scenery.cloud;
  const base = height * STAGE.wallHeight - mouth.centre[1];
  return outline.map(([u, v]): Point => [u * width, base + v * width]);
}

/** Where the cloud's centre is after `seconds` of game time: drifting left to right, wrapping once clear of the mouth. */
export function cloudX(name: WallName, seconds: number): number {
  const reach = sceneryMouth(name).width + scenery.cloud.width;
  const travelled = (((scenery.cloud.drift * seconds) % reach) + reach) % reach;
  return -reach / 2 + travelled;
}

/** A circle as a polygon of `segments` points. */
export function discPolygon(radius: number, segments: number = scenery.discSegments): Point[] {
  return Array.from({ length: segments }, (_, i): Point => [radius * Math.cos((TAU * i) / segments), radius * Math.sin((TAU * i) / segments)]);
}

/** A closed polygon as ink segments: x0, y0, x1, y1 for each edge, the last back to the first. */
export function closedSegments(polygon: readonly Point[]): number[] {
  return polygon.flatMap(([x0, y0], i) => {
    const [x1, y1] = polygon[(i + 1) % polygon.length]!;
    return [x0, y0, x1, y1];
  });
}

/** Where a body stands on the sky: `x` across the box (0 left to 1 right), `y` its height over the horizon (-1 to 1). */
export interface Body {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * The sun and moon at `phase`, as positions on one arc over the horizon: the sun rises on the left at dawn (0.25),
 * tops out at noon and sets on the right at dusk (0.75); the moon is half a day behind it. A body shows while above
 * the horizon. Pure phase maths, so the floor's light patch can follow the same sun.
 */
export function celestial(phase: number): { sun: Body; moon: Body } {
  const angle = TAU * (phase - 0.25);
  const sun = { x: (1 - Math.cos(angle)) / 2, y: Math.sin(angle) };
  const moon = { x: (1 + Math.cos(angle)) / 2, y: -Math.sin(angle) };
  return { sun: { ...sun, visible: sun.y > 0 }, moon: { ...moon, visible: moon.y > 0 } };
}

/** A body's centre in a wall's box-local coordinates, its disc kept wholly between the box's sides. */
export function bodyAt(name: WallName, body: Body, radius: number): Point {
  const mouth = sceneryMouth(name);
  const { horizon, rise } = scenery.arc;
  return [
    -mouth.width / 2 + radius + body.x * (mouth.width - 2 * radius),
    (horizon + body.y * rise) * STAGE.wallHeight - mouth.centre[1],
  ];
}

/** How lit the backlight is at `phase`, 0 to 1: the sky's own colour by day, full starlight by night. */
export function starlightAt(phase: number): number {
  const stops = scenery.starlight;
  const p = ((phase % 1) + 1) % 1;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (p < first.at) return blend(last.level, first.level, (p + 1 - (last.at)) / (first.at + 1 - last.at));
  let i = 0;
  while (i < stops.length - 1 && p >= stops[i + 1]!.at) i++;
  const from = stops[i]!;
  const to = stops[i + 1] ?? { at: first.at + 1, level: first.level };
  return blend(from.level, to.level, (p - from.at) / (to.at - from.at));
}

const blend = (a: number, b: number, t: number) => a + (b - a) * t;

/** A seeded generator (mulberry32): the same seed gives the same stars everywhere, with no `Math.random`. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` star positions as fractions of the tile, in [0, 1) both ways, the same for the same seed. */
export function starField(seed: number, count: number): Point[] {
  const next = seeded(seed);
  return Array.from({ length: count }, (): Point => [next(), next()]);
}

/**
 * The pinhole mask: `texels` square, 255 paper and 0 where a star shows through, one hole of `stars.radius` metres
 * (against the tile's side) at each star, wrapping at the tile's edges so it repeats seamlessly.
 */
export function starMask(): Uint8Array {
  const { texels, tile, radius, count, seed } = scenery.stars;
  const mask = new Uint8Array(texels * texels).fill(255);
  const reach = (radius / tile) * texels;
  for (const [u, v] of starField(seed, count)) {
    const cx = u * texels;
    const cy = v * texels;
    for (let dy = -Math.ceil(reach); dy <= Math.ceil(reach); dy++) {
      for (let dx = -Math.ceil(reach); dx <= Math.ceil(reach); dx++) {
        if (dx * dx + dy * dy > reach * reach) continue;
        const x = (((Math.floor(cx) + dx) % texels) + texels) % texels;
        const y = (((Math.floor(cy) + dy) % texels) + texels) % texels;
        mask[y * texels + x] = 0;
      }
    }
  }
  return mask;
}
