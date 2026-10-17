// Where the detail inset sits on screen and where its camera stands. Pure — CSS px and
// metres in, plain records out; src/scene/inset.ts turns them into a Three camera.

import { INSET } from '../constants.js';
import { add, scale, sub } from '../../tools/validate/lib/geometry.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import type { ScreenPoint } from './dragMath.js';

export type InsetLayout = 'portrait' | 'landscape';

export interface Viewport {
  width: number;
  height: number;
}

/** The safe-area insets the circle keeps clear of, CSS px. */
export interface SafeInsets {
  top: number;
  right: number;
}

/** The circle on screen: its `centre` and `radius` in CSS px. */
export interface InsetFrame {
  centre: ScreenPoint;
  radius: number;
}

/** Where the inset camera stands: it looks from `position` at `target`, with `up` up the screen. */
export interface InsetPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
}

/** An orthographic camera's planes, as Three's OrthographicCamera takes them. */
export interface InsetOrtho {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

const WORLD_UP: Vec3 = [0, 1, 0];
// Below this length a vector has no direction worth trusting.
const EPSILON = 1e-6;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / length(a));

// `v` with its component along the unit vector `along` taken out.
const without = (v: Vec3, along: Vec3): Vec3 => sub(v, scale(along, dot(v, along)));

// The first of `candidates` with a usable part perpendicular to the unit vector `to`, as a unit vector.
function perpendicular(to: Vec3, candidates: readonly Vec3[]): Vec3 {
  for (const candidate of candidates) {
    const flat = without(candidate, to);
    if (length(flat) > EPSILON) return unit(flat);
  }
  return unit(without([1, 0, 0], to));
}

/** Portrait when the viewport is taller than wide, else landscape. */
export function insetLayout({ width, height }: Viewport): InsetLayout {
  return height > width ? 'portrait' : 'landscape';
}

/**
 * The circle for a viewport: its diameter a share of the shorter side clamped to the
 * layout's min and max; in portrait top-centre, in landscape on the right under the
 * control cluster, both inside `safe`, with room left round them for the turn ring.
 */
export function insetFrame(viewport: Viewport, safe: SafeInsets = { top: 0, right: 0 }, layout: InsetLayout = insetLayout(viewport)): InsetFrame {
  const { share, min, max } = INSET[layout];
  // The turn ring round the circle needs room outside it: the offsets from the screen edge are to its outer edge.
  const reach = ringReach();
  const diameter = Math.min(max, Math.max(min, share * Math.min(viewport.width, viewport.height)));
  const radius = diameter / 2;
  if (layout === 'portrait') return { centre: [viewport.width / 2, safe.top + INSET.portrait.top + reach + radius], radius };
  return { centre: [viewport.width - safe.right - INSET.landscape.right - reach - radius, safe.top + INSET.landscape.top + reach + radius], radius };
}

/** How far the turn ring's grab band reaches past the circle's rim, CSS px: what the circle leaves room for on every side. */
export const ringReach = () => INSET.controls.ring.gap + INSET.controls.ring.band;

/** Whether a client-px `point` is on or inside the circle. */
export function insideInset([x, y]: ScreenPoint, { centre, radius }: InsetFrame) {
  return Math.hypot(x - centre[0], y - centre[1]) <= radius;
}

/**
 * The inset camera for a joint at `centre` whose hole runs along `axis` (pointing into the
 * hole). It looks along `axis` turned INSET.camera.tilt degrees toward the side the main
 * camera faces (`azimuth`, its horizontal forward), so the close-up's left and right follow
 * the room's. When `azimuth` runs along the hole there is no such side, and world up stands in.
 */
export function insetCameraPose(centre: Vec3, axis: Vec3, azimuth: Vec3): InsetPose {
  const into = unit(axis);
  const side = perpendicular(into, [azimuth, WORLD_UP]);
  const tilt = (INSET.camera.tilt * Math.PI) / 180;
  const direction = add(scale(into, Math.cos(tilt)), scale(side, Math.sin(tilt)));
  return {
    position: sub(centre, scale(direction, INSET.camera.distance)),
    target: centre,
    up: perpendicular(direction, [WORLD_UP, side]),
  };
}

/** The orthographic planes for a frame `frameHeight` metres tall, `aspect` wide per tall, kept `depth` either side of the joint. */
export function insetOrtho(frameHeight: number = INSET.camera.frameHeight, aspect = 1): InsetOrtho {
  const half = frameHeight / 2;
  return { left: -half * aspect, right: half * aspect, top: half, bottom: -half, near: INSET.camera.distance - INSET.depth, far: INSET.camera.distance + INSET.depth };
}
