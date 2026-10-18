// The night sky as pure data: every star's place and size, and the texture the pinholes are cut from — no Three, no DOM.
// One texture of stacked strips, one per wall, each covering that wall's face once; a panel's UVs pick its strip.

import { STAGE } from '../constants.js';
import { seeded } from './seeded.js';
import type { WallName } from './stageBoxes.js';

const { stars } = STAGE.scenery;

/** A star's twinkle: where in its swing it starts (0 to 1 of a period) and how much of the full swing it makes (0 none). */
export interface Twinkle {
  phase: number;
  swing: number;
}

/** One star: its strip, its place in metres from the strip's lower left, its radius, whether it is a plus, and its twinkle. */
export interface Star {
  strip: number;
  x: number;
  y: number;
  radius: number;
  plus: boolean;
  twinkle: Twinkle;
}

/** The texels across one metre of the sky, and the texture's size: one strip per wall, stacked. */
export const TEXELS_PER_METRE = stars.texels / stars.sky.width;
export const STRIP_TEXELS = Math.round(stars.sky.height * TEXELS_PER_METRE);
const STRIPS = Object.keys(stars.strip).length;
export const SKY_TEXELS: { width: number; height: number } = { width: stars.texels, height: STRIPS * STRIP_TEXELS };
const CHANNELS = 4;

const STEADY: Twinkle = { phase: 0, swing: 0 };

/** The constellations' stars, laid out as their real patterns. */
export function constellationStars(): Star[] {
  return stars.constellations.flatMap((c) =>
    c.stars.map((s): Star => ({
      strip: stars.strip[c.strip],
      x: c.at[0] + s.dx * c.metresPerDegree,
      y: c.at[1] + s.dy * c.metresPerDegree,
      radius: s.bright ? stars.constellationRadius.bright : stars.constellationRadius.dim,
      plus: s.bright,
      twinkle: STEADY,
    })),
  );
}

/** A star's twinkle drawn from the generator: most stars steady, `share` of them twinkling from a random phase. */
function rollTwinkle(next: () => number): Twinkle {
  const { share, minSwing } = stars.twinkle;
  const phase = next();
  const swings = next() < share;
  const swing = minSwing + (1 - minSwing) * next();
  return swings ? { phase, swing } : STEADY;
}

/**
 * Every star of every strip: the constellations, then a scattered field kept `spacing` apart and `clearance` from a
 * constellation's stars, mostly tiny with a few bright plus-shaped ones. The same stars every time.
 */
export function skyStars(): Star[] {
  const next = seeded(stars.seed);
  const placed = constellationStars().map((s): Star => ({ ...s, twinkle: rollTwinkle(next) }));
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
      field.push({ strip, x, y, radius, plus, twinkle: rollTwinkle(next) });
      made++;
    }
  }
  return [...placed, ...field];
}

/** How much of its light a star gives at `seconds`: full, down to `1 - depth` for a full swing, over `period`. The backlight's shader does the same. */
export function twinkleAt(seconds: number, { phase, swing }: Twinkle): number {
  const { period, depth } = stars.twinkle;
  return 1 - depth * swing * (0.5 + 0.5 * Math.sin(2 * Math.PI * (seconds / period + phase)));
}

/** The texels a star's hole reaches from its centre. */
const holeReach = (star: Star) => Math.ceil(star.radius * TEXELS_PER_METRE * (star.plus ? stars.plus.arm : 1));

/** Writes the twinkle (red phase, blue swing) into the texels within `reach` of a star's centre. */
function stampTwinkle(data: Uint8Array, star: Star, reach: number) {
  const cx = Math.round(star.x * TEXELS_PER_METRE);
  const cy = Math.round(star.strip * STRIP_TEXELS + star.y * TEXELS_PER_METRE);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > reach * reach) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= SKY_TEXELS.width || y < 0 || y >= SKY_TEXELS.height) continue;
      const at = (y * SKY_TEXELS.width + x) * CHANNELS;
      data[at] = Math.round(star.twinkle.phase * 255);
      data[at + 2] = Math.round(star.twinkle.swing * 255);
    }
  }
}

/** Clears the texels of one star (alpha to 0): a disc, or a small core with two arms crossing. */
function cutStar(data: Uint8Array, star: Star) {
  const { width } = SKY_TEXELS;
  const cx = star.x * TEXELS_PER_METRE;
  const cy = star.strip * STRIP_TEXELS + star.y * TEXELS_PER_METRE;
  const r = star.radius * TEXELS_PER_METRE;
  const { core, arm, thickness } = stars.plus;
  const reach = holeReach(star);
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
 * through); red and blue carry each star's twinkle (phase, swing) in a zone `margin` wider than its hole, which the
 * backlight behind reads, and are 0 elsewhere.
 */
export function skyTexture(): Uint8Array {
  const data = new Uint8Array(SKY_TEXELS.width * SKY_TEXELS.height * CHANNELS);
  for (let i = 0; i < data.length; i += CHANNELS) {
    data[i + 1] = 255;
    data[i + 3] = 255;
  }
  const all = skyStars();
  const margin = Math.ceil(stars.twinkle.margin * TEXELS_PER_METRE);
  for (const star of all) stampTwinkle(data, star, holeReach(star) + margin);
  // A neighbour's zone must never cover a star's own hole: each star's centre is stamped again, over its hole.
  for (const star of all) stampTwinkle(data, star, holeReach(star));
  for (const star of all) cutStar(data, star);
  return data;
}

/** The texture coordinates of a point on a wall's panel: `x` along it from its centre, `y` up from its centre. */
export function skyUv(name: WallName, x: number, y: number, panelHeight: number): [number, number] {
  return [
    (x + stars.sky.width / 2) / stars.sky.width,
    (stars.strip[name] * STRIP_TEXELS + (y + panelHeight / 2) * TEXELS_PER_METRE) / SKY_TEXELS.height,
  ];
}
