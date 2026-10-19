// The stage's light: one sun on one arc, following the sky's phase — no Three, no DOM — so the direction, the
// strength, the colour and the windows' patches on the floor are worked out headlessly and the scene only draws them.
//
// The sun stands where the scenery's sun disc stands (`celestial`): its sideways travel (0 at the left, 1 at the right)
// turns it from the left wall's side at dawn over the back-left corner at noon to the back wall's side at dusk, and its
// height lifts it from `minElevation` to `peak`. At night the light is not cut: it retraces the day's path backwards at
// the same heights (as the moon, which `celestial` puts opposite), so the direction is continuous through dusk and dawn
// and shadows never flip. The sun and the fill share one strength and one tint, and the strength never falls below the
// night floor (a ?tune knob), so the build stays readable.

import { ROOM, STAGE } from '../constants.js';
import { celestial, daylightAt } from './scenery.js';
import type { Body, Point } from './scenery.js';
import type { Rgb } from './skyCycle.js';
import type { StageBox } from './stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

/** Where the sun is at a phase: the unit vector from the room toward it, and whether it is above the horizon. */
export interface SunArc {
  toSun: Vec3;
  up: boolean;
}

const RAD = Math.PI / 180;
const sky: { sun: Body; moon: Body } = { sun: { x: 0, y: 0, visible: false }, moon: { x: 0, y: 0, visible: false } };

/**
 * The sun at `phase`, in the room's frame. Azimuth 0 is straight out through the left wall (-x), 90 straight out
 * through the back wall (-z); the horizontal direction is `[-cos, 0, -sin]`. Written into `out` when given, so the
 * loop allocates nothing.
 */
export function sunArc(phase: number, out: SunArc = { toSun: [0, 0, 0], up: false }): SunArc {
  const { sun } = celestial(phase, sky);
  const { azimuth, peak, minElevation } = STAGE.light;
  const theta = (azimuth.rise + (azimuth.set - azimuth.rise) * sun.x) * RAD;
  const elevation = (minElevation + (peak - minElevation) * Math.abs(sun.y)) * RAD;
  const flat = Math.cos(elevation);
  out.toSun[0] = -Math.cos(theta) * flat;
  out.toSun[1] = Math.sin(elevation);
  out.toSun[2] = -Math.sin(theta) * flat;
  out.up = sun.visible;
  return out;
}

/** The daylight rescaled to 0 in the dark and 1 at midday: the box's daylight less its night level. */
function daylightShare(phase: number): number {
  const { nightLevel } = STAGE.scenery;
  return (daylightAt(phase) - nightLevel) / (1 - nightLevel);
}

/**
 * How strong the light is at `phase`, from `nightFloor` (exactly, in the dark) to 1 (midday): the scenery's own
 * daylight curve between. The sun and the fill both scale by it.
 */
export function lightLevel(phase: number, nightFloor: number = STAGE.light.nightFloor): number {
  return nightFloor + (1 - nightFloor) * daylightShare(phase);
}

/**
 * The light's colour at `phase`, written into `out`: white at midday, and as the day fades the sky's own hue (its
 * colour taken to full brightness) `tintDepth` of the way in — cool at night, peach and rose through dawn and dusk.
 */
export function lightTint(phase: number, skyColour: Rgb, out: Rgb): Rgb {
  const fade = 1 - daylightShare(phase);
  const brightest = Math.max(skyColour[0], skyColour[1], skyColour[2], Number.EPSILON);
  for (let c = 0; c < 3; c++) out[c] = 1 - STAGE.light.tintDepth * fade * (1 - skyColour[c]! / brightest);
  return out;
}

/** The floor's extent in x and z: where the planks (and so a patch) can lie. */
export interface Footprint {
  min: Point;
  max: Point;
}

/** The slab's footprint under the planks, the room's width by its depth about the origin. */
export function patchFootprint(): Footprint {
  return { min: [-ROOM.width / 2, -ROOM.depth / 2], max: [ROOM.width / 2, ROOM.depth / 2] };
}

/** `polygon` cut to the rectangle `min`..`max` (Sutherland–Hodgman); empty when none of it is inside. */
export function clipToRect(polygon: readonly Point[], min: Point, max: Point): Point[] {
  let points: Point[] = polygon.map(([x, z]): Point => [x, z]);
  for (let axis = 0; axis < 2; axis++) {
    for (const side of [-1, 1]) {
      const edge = side < 0 ? min[axis]! : max[axis]!;
      // Signed distance inside the edge: >= 0 keeps the point.
      const inside = (p: Point) => -side * (p[axis]! - edge);
      const next: Point[] = [];
      points.forEach((current, i) => {
        const previous = points[(i + points.length - 1) % points.length]!;
        const a = inside(previous);
        const b = inside(current);
        if ((a >= 0) !== (b >= 0)) {
          const t = a / (a - b);
          next.push([previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t]);
        }
        if (b >= 0) next.push(current);
      });
      points = next;
    }
  }
  return points.length < 3 ? [] : points;
}

/**
 * The sunlight through an opening, on the floor: the room-side face's four corners projected along the sun's rays to
 * y = 0 (`P - toSun × P.y / toSun.y`, a shear), clipped to `footprint`, in winding order. `outward` is the wall's
 * outward normal (an opening box carries none of its own). Empty while the sun is down or on the room's side of the wall.
 */
export function windowPatch(box: Pick<StageBox<string>, 'min' | 'max'>, outward: Vec3, toSun: Vec3, footprint: Footprint): Point[] {
  const across = outward.findIndex((v) => v !== 0);
  const dot = toSun[0] * outward[0] + toSun[1] * outward[1] + toSun[2] * outward[2];
  if (across < 0 || toSun[1] <= 0 || dot <= 0) return [];
  const along = across === 0 ? 2 : 0;
  // The face looking into the room is opposite the outward normal.
  const face = outward[across]! < 0 ? box.max[across]! : box.min[across]!;
  const corners: [number, number][] = [
    [box.min[along]!, box.min[1]],
    [box.max[along]!, box.min[1]],
    [box.max[along]!, box.max[1]],
    [box.min[along]!, box.max[1]],
  ];
  const projected = corners.map(([a, y]): Point => {
    const reach = y / toSun[1];
    const p: Vec3 = [0, 0, 0];
    p[across] = face;
    p[along] = a;
    return [p[0] - toSun[0] * reach, p[2] - toSun[2] * reach];
  });
  return clipToRect(projected, footprint.min, footprint.max);
}
