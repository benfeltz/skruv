// The night sky as pure data: every star's place and size, and the texture the pinholes are cut from — no Three, no DOM.
// One texture of stacked strips, one per wall, each covering that wall's face once; a panel's UVs pick its strip.

import { STAGE } from '../constants.js';
import type { WallName } from './stageBoxes.js';

const { stars } = STAGE.scenery;

/** One star: its strip, its place in metres from the strip's lower left, its radius, and whether it is a plus. */
export interface Star {
  strip: number;
  x: number;
  y: number;
  radius: number;
  plus: boolean;
}

/** The texels across one metre of the sky, and the texture's size: one strip per wall, stacked. */
export const TEXELS_PER_METRE = stars.texels / stars.sky.width;
export const STRIP_TEXELS = Math.round(stars.sky.height * TEXELS_PER_METRE);
const STRIPS = Object.keys(stars.strip).length;
export const SKY_TEXELS: { width: number; height: number } = { width: stars.texels, height: STRIPS * STRIP_TEXELS };
const CHANNELS = 4;

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

/** The constellations' stars, laid out as their real patterns. */
export function constellationStars(): Star[] {
  return stars.constellations.flatMap((c) =>
    c.stars.map((s): Star => ({
      strip: stars.strip[c.strip],
      x: c.at[0] + s.dx * c.metresPerDegree,
      y: c.at[1] + s.dy * c.metresPerDegree,
      radius: s.bright ? stars.constellationRadius.bright : stars.constellationRadius.dim,
      plus: s.bright,
    })),
  );
}

/**
 * Every star of every strip: the constellations, then a scattered field kept `spacing` apart and `clearance` from a
 * constellation's stars, mostly tiny with a few bright plus-shaped ones. The same stars every time.
 */
export function skyStars(): Star[] {
  const next = seeded(stars.seed);
  const placed = constellationStars();
  const field: Star[] = [];
  for (const strip of Object.values(stars.strip)) {
    let made = 0;
    // Bounded attempts, so a crowded tuning ends rather than spinning.
    for (let tries = 0; made < stars.count && tries < stars.count * 40; tries++) {
      const x = next() * stars.sky.width;
      const y = next() * stars.sky.height;
      const near = (other: Star, gap: number) => other.strip === strip && Math.hypot(other.x - x, other.y - y) < gap;
      if (placed.some((o) => near(o, stars.clearance)) || field.some((o) => near(o, stars.spacing))) continue;
      const plus = next() < stars.brightShare;
      const span = plus ? stars.bright : stars.dim;
      // Skewed small: a power of a uniform draw, so the dim end is crowded.
      const radius = span.min + (span.max - span.min) * (plus ? next() : next() ** stars.skew);
      field.push({ strip, x, y, radius, plus });
      made++;
    }
  }
  return [...placed, ...field];
}

/** Clears the texels of one star (alpha to 0): a disc, or a small core with two arms crossing. */
function cutStar(data: Uint8Array, star: Star) {
  const { width } = SKY_TEXELS;
  const cx = star.x * TEXELS_PER_METRE;
  const cy = star.strip * STRIP_TEXELS + star.y * TEXELS_PER_METRE;
  const r = star.radius * TEXELS_PER_METRE;
  const { core, arm, thickness } = stars.plus;
  const reach = Math.ceil(star.plus ? r * arm : r);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const inDisc = dx * dx + dy * dy <= (star.plus ? r * core : r) ** 2;
      const inArms = star.plus && ((Math.abs(dy) <= (r * thickness) / 2 && Math.abs(dx) <= r * arm) || (Math.abs(dx) <= (r * thickness) / 2 && Math.abs(dy) <= r * arm));
      if (!inDisc && !inArms) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || x >= width || y < 0 || y >= SKY_TEXELS.height) continue;
      data[(y * width + x) * CHANNELS + 1] = 0;
    }
  }
}

/**
 * The sky texture as RGBA texels, bottom row first: green is the pinhole mask (255 paper, 0 a hole where a star shows
 * through). The other channels are left for what rides on the stars.
 */
export function skyTexture(): Uint8Array {
  const data = new Uint8Array(SKY_TEXELS.width * SKY_TEXELS.height * CHANNELS);
  for (let i = 0; i < data.length; i += CHANNELS) {
    data[i + 1] = 255;
    data[i + 3] = 255;
  }
  for (const star of skyStars()) cutStar(data, star);
  return data;
}

/** The texture coordinates of a point on a wall's panel: `x` along it from its centre, `y` up from its centre. */
export function skyUv(name: WallName, x: number, y: number, panelHeight: number): [number, number] {
  return [
    (x + stars.sky.width / 2) / stars.sky.width,
    (stars.strip[name] * STRIP_TEXELS + (y + panelHeight / 2) * TEXELS_PER_METRE) / SKY_TEXELS.height,
  ];
}
