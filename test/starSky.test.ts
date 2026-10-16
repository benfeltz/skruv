import { describe, expect, it } from 'vitest';
import { STAGE } from '../src/constants.js';
import { sceneryMouth, windowOpenings } from '../src/game/stageBoxes.js';
import type { WallName } from '../src/game/stageBoxes.js';
import { SKY_TEXELS, STRIP_TEXELS, TEXELS_PER_METRE, constellationStars, skyStars, skyTexture, skyUv, twinkleAt } from '../src/game/starSky.js';
import type { Star } from '../src/game/starSky.js';

const { stars } = STAGE.scenery;
const named = (name: string) => stars.constellations.find((c) => c.name === name)!;
const degrees = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) => Math.hypot(a.dx - b.dx, a.dy - b.dy);

describe('the constellations', () => {
  it('lay the Big Dipper out in its real pattern, seven stars', () => {
    const dipper = named('Big Dipper').stars;
    expect(dipper).toHaveLength(7);
    const [dubhe, merak, phecda, megrez, alioth, mizar, alkaid] = dipper as [typeof dipper[0], ...typeof dipper];
    // Angular separations of the real stars, in degrees (Dubhe–Merak 5.4, Megrez–Alioth 5.4, Alioth–Mizar 4.2 ...).
    expect(degrees(dubhe, merak)).toBeCloseTo(5.4, 0);
    expect(degrees(megrez, alioth)).toBeCloseTo(5.4, 0);
    expect(degrees(alioth, mizar)).toBeCloseTo(4.4, 0);
    expect(degrees(merak, phecda)).toBeGreaterThan(7);
    expect(degrees(phecda, megrez)).toBeCloseTo(4.1, 0);
    // The bowl closes: the pointers Dubhe and Merak stand on the bowl's far side from the handle, which trails off
    // past Alioth to Alkaid, the farthest star from Dubhe.
    expect(Math.max(...dipper.map((s) => degrees(dubhe, s)))).toBe(degrees(dubhe, alkaid));
    expect(megrez.dx).toBeGreaterThan(phecda.dx);
    expect(alkaid.dx).toBeGreaterThan(mizar.dx);
  });

  it('lay Cassiopeia out as a W: five stars zigzagging up and down', () => {
    const w = named('Cassiopeia').stars;
    expect(w).toHaveLength(5);
    const rises = w.slice(1).map((s, i) => Math.sign(s.dy - w[i]!.dy));
    expect(rises).toEqual([-1, 1, -1, 1]);
    expect(w.map((s) => s.dx)).toEqual([...w.map((s) => s.dx)].sort((a, b) => a - b));
  });

  it('lay Orion\'s belt out as three bright stars in a near-straight, evenly spaced line', () => {
    const belt = named("Orion's belt").stars;
    expect(belt).toHaveLength(3);
    expect(belt.every((s) => s.bright)).toBe(true);
    const [a, b, c] = belt as [typeof belt[0], ...typeof belt];
    expect(degrees(a, b) / degrees(b, c)).toBeCloseTo(1, 0);
    const turn = Math.abs(Math.atan2(b.dy - a.dy, b.dx - a.dx) - Math.atan2(c.dy - b.dy, c.dx - b.dx));
    expect(turn).toBeLessThan(0.25);
  });

  it('stand each in view through a window of its wall, once', () => {
    for (const c of stars.constellations) {
      const wall = c.strip as WallName;
      const mouth = sceneryMouth(wall);
      const openings = windowOpenings(wall);
      const placed = constellationStars().filter((s) => s.strip === stars.strip[wall]);
      for (const s of placed) {
        // Strip x runs from the box's left edge; along the wall that is the mouth's x.
        const along = mouth.alongCentre + mouth.alongSign * (s.x - stars.sky.width / 2);
        if (!c.stars.some((cs) => Math.abs(c.at[0] + cs.dx * c.metresPerDegree - s.x) < 1e-9)) continue;
        expect(openings.some((o) => along > o.a0 && along < o.a1), `${c.name} at ${s.x}`).toBe(true);
        expect(s.y).toBeGreaterThan(openings[0]!.y0);
        expect(s.y).toBeLessThan(openings[0]!.y1);
      }
    }
  });
});

describe('the scattered field', () => {
  const all = skyStars();
  const constellation = constellationStars();
  const field = all.slice(constellation.length);

  it('is the same stars every time, a strip each of the same count', () => {
    expect(skyStars()).toEqual(all);
    for (const strip of Object.values(stars.strip)) expect(field.filter((s) => s.strip === strip)).toHaveLength(stars.count);
  });

  it('keeps inside its strip, apart from each other and clear of the constellations', () => {
    for (const s of field) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(stars.sky.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(stars.sky.height);
      for (const o of constellation) {
        if (o.strip === s.strip) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThanOrEqual(stars.clearance);
      }
    }
    for (const [i, s] of field.entries()) {
      for (const o of field.slice(i + 1)) {
        if (o.strip === s.strip) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThanOrEqual(stars.spacing);
      }
    }
  });

  it('is mostly small, a few bright plus-shaped ones, none larger than the old pinhole', () => {
    const plus = field.filter((s) => s.plus);
    expect(plus.length).toBeGreaterThan(0);
    expect(plus.length / field.length).toBeLessThan(0.15);
    expect(plus.every((s) => s.radius >= stars.bright.min)).toBe(true);
    const dim = field.filter((s) => !s.plus);
    expect(dim.every((s) => s.radius >= stars.dim.min && s.radius <= stars.dim.max)).toBe(true);
    expect(Math.max(...all.map((s) => s.radius))).toBeLessThanOrEqual(0.025);
    const sorted = dim.map((s) => s.radius).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median).toBeLessThan((stars.dim.min + stars.dim.max) / 2);
    expect(new Set(sorted.map((r) => r.toFixed(4))).size).toBeGreaterThan(10);
  });
});

describe('the sky texture', () => {
  const data = skyTexture();
  const alpha = (x: number, y: number) => data[(y * SKY_TEXELS.width + x) * 4 + 1]!;
  const centre = (s: Star) => [Math.round(s.x * TEXELS_PER_METRE), Math.round(s.strip * STRIP_TEXELS + s.y * TEXELS_PER_METRE)] as const;

  it('stacks one strip of the room\'s face per wall', () => {
    expect(SKY_TEXELS.width).toBe(stars.texels);
    expect(SKY_TEXELS.height).toBe(STRIP_TEXELS * Object.keys(stars.strip).length);
    expect(STRIP_TEXELS / TEXELS_PER_METRE).toBeCloseTo(stars.sky.height, 9);
    expect(data).toHaveLength(SKY_TEXELS.width * SKY_TEXELS.height * 4);
  });

  it('is paper (255) with holes (0) where the stars are, and a small share of it holes', () => {
    let holes = 0;
    for (let i = 1; i < data.length; i += 4) {
      expect(data[i] === 0 || data[i] === 255).toBe(true);
      if (data[i] === 0) holes++;
    }
    expect(holes).toBeGreaterThan(skyStars().length);
    expect(holes / (data.length / 4)).toBeLessThan(0.02);
    for (const s of skyStars()) expect(alpha(...centre(s)), `star at ${s.x},${s.y}`).toBe(0);
  });

  it('cuts a bright star as a plus: holes along its axes reach farther than along its diagonals', () => {
    const bright = constellationStars().find((s) => s.plus)!;
    const [cx, cy] = centre(bright);
    const reach = Math.ceil(bright.radius * TEXELS_PER_METRE * stars.plus.arm);
    const along = (dx: number, dy: number) => {
      let n = 0;
      while (n < 2 * reach && alpha(cx + dx * (n + 1), cy + dy * (n + 1)) === 0) n++;
      return n;
    };
    expect(along(1, 0)).toBeGreaterThan(along(1, 1) * 1.4);
    expect(along(0, 1)).toBeGreaterThan(along(1, 1) * 1.4);
  });

  it('keeps each wall\'s stars in its own strip', () => {
    const orion = constellationStars().filter((s) => s.strip === stars.strip.left);
    expect(orion.length).toBeGreaterThan(0);
    for (const s of orion) expect(centre(s)[1]).toBeGreaterThanOrEqual(STRIP_TEXELS);
  });
});

describe('a panel\'s coordinates in the sky', () => {
  it('map a wall\'s panel onto its strip once: left to right across the room, floor to wall top', () => {
    const height = STAGE.wallHeight;
    expect(skyUv('back', -stars.sky.width / 2, -height / 2, height)).toEqual([0, 0]);
    const top = skyUv('back', stars.sky.width / 2, height / 2, height);
    expect(top[0]).toBeCloseTo(1, 9);
    expect(top[1]).toBeCloseTo(0.5, 9);
    const left = skyUv('left', 0, -height / 2, height);
    expect(left[0]).toBeCloseTo(0.5, 9);
    expect(left[1]).toBeCloseTo(0.5, 9);
    expect(skyUv('left', 0, height / 2, height)[1]).toBeCloseTo(1, 9);
  });
});

describe('the twinkle', () => {
  const all = skyStars();
  const twinkling = all.filter((s) => s.twinkle.swing > 0);
  const { period, depth, share, minSwing, margin } = stars.twinkle;

  it('is on only some of the stars, from phases spread round the cycle so none pulse together', () => {
    expect(twinkling.length / all.length).toBeGreaterThan(share / 2);
    expect(twinkling.length / all.length).toBeLessThan(share * 1.6);
    const phases = twinkling.map((s) => s.twinkle.phase);
    expect(Math.min(...phases)).toBeLessThan(0.15);
    expect(Math.max(...phases)).toBeGreaterThan(0.85);
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBeGreaterThan(twinkling.length * 0.9);
    expect(twinkling.every((s) => s.twinkle.swing >= minSwing && s.twinkle.swing <= 1)).toBe(true);
    expect(all.filter((s) => s.twinkle.swing === 0).length).toBeGreaterThan(all.length / 2);
  });

  it('is subtle and slow: a star dims by at most `depth`, never out, and swings once a period', () => {
    expect(depth).toBeLessThanOrEqual(0.5);
    for (const s of twinkling) {
      const seen = Array.from({ length: 200 }, (_, i) => twinkleAt((i * period) / 200, s.twinkle));
      expect(Math.min(...seen)).toBeGreaterThanOrEqual(1 - depth - 1e-9);
      expect(Math.max(...seen)).toBeLessThanOrEqual(1 + 1e-9);
      expect(twinkleAt(0, s.twinkle)).toBeCloseTo(twinkleAt(period, s.twinkle), 9);
    }
    expect(period).toBeGreaterThanOrEqual(2);
  });

  it('leaves a steady star at full light always, and two stars at different phases apart', () => {
    const steady = all.find((s) => s.twinkle.swing === 0)!;
    for (const t of [0, 1.3, 2.7, 9]) expect(twinkleAt(t, steady.twinkle)).toBe(1);
    const [a, b] = twinkling.slice(0, 2) as [Star, Star];
    const gaps = Array.from({ length: 40 }, (_, i) => Math.abs(twinkleAt(i * 0.1, a.twinkle) - twinkleAt(i * 0.1, b.twinkle)));
    expect(Math.max(...gaps)).toBeGreaterThan(0.01);
  });

  it('is drawn into the sky texture: each star\'s own phase and swing at its hole, in a zone wider than the hole', () => {
    const data = skyTexture();
    const at = (x: number, y: number) => (y * SKY_TEXELS.width + x) * 4;
    const centreOf = (s: Star) => [Math.round(s.x * TEXELS_PER_METRE), Math.round(s.strip * STRIP_TEXELS + s.y * TEXELS_PER_METRE)] as const;
    for (const s of all) {
      const [x, y] = centreOf(s);
      expect(data[at(x, y)], `phase of star at ${s.x}`).toBe(Math.round(s.twinkle.phase * 255));
      expect(data[at(x, y) + 2], `swing of star at ${s.x}`).toBe(Math.round(s.twinkle.swing * 255));
    }
    // Beyond its hole by the margin, a slanted view through the hole still finds its star's twinkle.
    const wide = twinkling.find((s) => !s.plus && centreOf(s)[0] > 40 && s.x < stars.sky.width - 0.5)!;
    const [x, y] = centreOf(wide);
    const offset = Math.ceil(wide.radius * TEXELS_PER_METRE) + Math.floor((margin * TEXELS_PER_METRE) / 2);
    expect(data[at(x + offset, y)]).toBeGreaterThan(0);
    expect(data[at(x + offset, y) + 2]).toBeGreaterThan(0);
  });
});
