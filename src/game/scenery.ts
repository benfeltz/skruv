// Pure geometry and timing of the paper theatre behind each wall's windows — no Three, no DOM — so the box, its
// cutouts, the sun and moon and the stars are worked out headlessly and the scene only draws them.
//
// Box-local coordinates, in metres: the origin is the mouth's centre on the wall's outer face, x runs along the wall
// (left to right as seen from the room), y up, and the room lies towards +z, so the box reaches back to z = -depth.
// Hills are sampled by WORLD position along the wall, so the back wall's two windows look into one continuous scene
// across the pier, and each wall is its own slice.

import { STAGE } from '../constants.js';
import { closedLoop, segmentAt, sortedKeyframes } from './skyCycle.js';
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

/** A unit wave of phase `x`: a sine, or its ridged fold with a sharp peak at 0 and rounded valleys. */
const wave = (x: number, ridged: boolean) => (ridged ? 1 - 2 * Math.abs(Math.sin(x / 2)) : Math.sin(x));

/** The world height (metres above the floor) of hill layer `layer` at `along`, a world position on the wall's axis. */
export function hillHeight(along: number, layer: number): number {
  const hill = scenery.hills[layer]!;
  const swell = (1 - hill.weight) * wave((TAU * along) / hill.wavelength + hill.phase, hill.ridged)
    + hill.weight * wave((TAU * along) / (hill.wavelength * hill.ratio) + scenery.hillPhaseScale * hill.phase, hill.ridged);
  return hill.base * STAGE.wallHeight + hill.amplitude * swell;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);


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

/** The cloud's silhouette in box-local coordinates, centred on x = 0 at its height. */
export function cloudPolygon(name: WallName): Point[] {
  const mouth = sceneryMouth(name);
  const { outline, width, height } = scenery.cloud;
  const base = height * STAGE.wallHeight - mouth.centre[1];
  return outline.map(([u, v]): Point => [u * width, base + v * width]);
}

/** Where the cloud's centre is after `seconds` of game time: drifting left to right, wrapping once clear of the mouth. */
export function cloudX(mouth: SceneryMouth, seconds: number): number {
  const reach = mouth.width + scenery.cloud.width;
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

/** An open polyline as ink segments: x0, y0, x1, y1 for each edge between neighbours, none closing it. */
export function openSegments(points: readonly Point[]): number[] {
  return points.slice(1).flatMap(([x1, y1], i) => [points[i]![0], points[i]![1], x1, y1]);
}

/** A hill layer's skyline alone — the polygon without its floor corners — so the ink never runs along the box's floor or sides. */
export function hillSkyline(name: WallName, layer: number): Point[] {
  return hillPolyline(name, layer).slice(1, -1);
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
 * the horizon. Pure phase maths, so the floor's light patch can follow the same sun; written into `out` when given,
 * so the loop allocates nothing.
 */
export function celestial(phase: number, out: { sun: Body; moon: Body } = { sun: { x: 0, y: 0, visible: false }, moon: { x: 0, y: 0, visible: false } }): { sun: Body; moon: Body } {
  const angle = TAU * (phase - 0.25);
  const { sun, moon } = out;
  sun.x = (1 - Math.cos(angle)) / 2;
  sun.y = Math.sin(angle);
  sun.visible = sun.y > 0;
  moon.x = (1 + Math.cos(angle)) / 2;
  moon.y = -sun.y;
  moon.visible = moon.y > 0;
  return out;
}

/** A body's centre in a wall's box-local coordinates, its disc kept wholly between the box's sides; written into `out` when given. */
export function bodyAt(mouth: SceneryMouth, body: Body, radius: number, out: Point = [0, 0]): Point {
  const { horizon, rise } = scenery.arc;
  out[0] = -mouth.width / 2 + radius + body.x * (mouth.width - 2 * radius);
  out[1] = (horizon + body.y * rise) * STAGE.wallHeight - mouth.centre[1];
  return out;
}

const STARLIGHT_LOOP = closedLoop(sortedKeyframes(scenery.starlight, 'starlight'));

/** How lit the backlight is at `phase`, 0 to 1: the sky's own colour by day, full starlight by night. */
export function starlightAt(phase: number): number {
  const { from, to, t } = segmentAt(STARLIGHT_LOOP, phase);
  return from.level + (to.level - from.level) * t;
}
