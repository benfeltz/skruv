import { describe, expect, it } from 'vitest';
import { STAGE } from '../src/constants.js';
import {
  bodyAt,
  boxTint,
  daylightAt,
  celestial,
  cloudLayerOffset,
  cloudLayerPolygons,
  closedSegments,
  discPolygon,
  hillHeight,
  hillPolyline,
  hillSkyline,
  openSegments,
  sceneryBox,
  starlightAt,
} from '../src/game/scenery.js';
import { WALL_NAMES, sceneryMouth, windowOpenings } from '../src/game/stageBoxes.js';
import { skyColourAt } from '../src/game/skyCycle.js';

const { scenery } = STAGE;
const near = scenery.hills.length - 1;
const inside = (mouth: ReturnType<typeof sceneryMouth>, [x, y]: [number, number]) =>
  Math.abs(x) <= mouth.width / 2 + 1e-9 && Math.abs(y) <= mouth.height / 2 + 1e-9;

describe('the box behind a wall', () => {
  it('has a mouth over every opening, within the wall top and the floor', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      const openings = windowOpenings(name);
      expect(mouth.alongCentre - mouth.width / 2).toBeLessThan(Math.min(...openings.map((o) => o.a0)));
      expect(mouth.alongCentre + mouth.width / 2).toBeGreaterThan(Math.max(...openings.map((o) => o.a1)));
      expect(mouth.centre[1] + mouth.height / 2).toBeLessThanOrEqual(STAGE.wallHeight + 1e-9);
      expect(mouth.centre[1] - mouth.height / 2).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('is one wide mouth for the back wall\'s two windows and one for the left wall\'s', () => {
    expect(sceneryMouth('back').width).toBeGreaterThan(2 * STAGE.window.width + 2);
    expect(sceneryMouth('left').width).toBeGreaterThan(STAGE.window.width + 2);
  });

  it('reaches back by the scenery depth with five faces turned into it', () => {
    for (const name of WALL_NAMES) {
      const box = sceneryBox(name);
      expect(box.depth).toBe(scenery.depth);
      expect(box.faces.map((f) => f.name).sort()).toEqual(['back', 'bottom', 'left', 'right', 'top']);
      const back = box.faces.find((f) => f.name === 'back')!;
      expect(back.centre[2]).toBe(-box.depth);
      expect(box.panelDepth).toBeLessThan(box.depth);
      for (const face of box.faces) expect(face.centre[2]).toBeLessThanOrEqual(0);
    }
  });
});

describe('the hills', () => {
  it('are sampled by world position, so the same place is the same height whichever way it is asked', () => {
    expect(hillHeight(0.7, 0)).toBe(hillHeight(0.7, 0));
    const mouth = sceneryMouth('back');
    const profile = hillPolyline('back', near);
    // The profile's height at local x equals the height at that world position on the wall.
    for (const [x, y] of profile.slice(1, -1)) {
      const expected = hillHeight(mouth.alongCentre + mouth.alongSign * x, near) - mouth.centre[1];
      expect(y).toBeCloseTo(Math.min(expected, mouth.height / 2), 9);
    }
  });

  it('are continuous across the pier of the back wall, in steps too small to show', () => {
    for (let layer = 0; layer < scenery.hills.length; layer++) {
      const profile = hillSkyline('back', layer);
      const steps = profile.slice(1).map(([, y], i) => Math.abs(y - profile[i]![1]));
      expect(Math.max(...steps), `layer ${layer}`).toBeLessThan(0.08);
    }
  });

  it('roll smoothly in every layer, with no corners', () => {
    for (let layer = 0; layer < scenery.hills.length; layer++) {
      const y = hillSkyline('back', layer).map(([, v]) => v);
      const corner = Math.max(...y.slice(1, -1).map((v, i) => Math.abs(y[i + 2]! - 2 * v + y[i]!)));
      expect(corner, `layer ${layer}`).toBeLessThan(0.003);
    }
  });

  it('read as distance: three layers, each further back lower in amplitude and fainter in tone', () => {
    expect(scenery.hills).toHaveLength(3);
    const lum = (hex: number) => ((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255);
    for (let i = 1; i < scenery.hills.length; i++) {
      const far = scenery.hills[i - 1]!;
      const near = scenery.hills[i]!;
      expect(far.depth).toBeGreaterThan(near.depth);
      expect(far.amplitude).toBeLessThan(near.amplitude);
      expect(lum(far.tone)).toBeLessThan(lum(near.tone));
    }
    expect('ridged' in scenery.hills[0]!).toBe(false);
  });

  it('sample finely enough that a smooth hill has no corners', () => {
    expect(scenery.hillSamplesPerMetre).toBeGreaterThanOrEqual(30);
    const mouth = sceneryMouth('back');
    expect(hillPolyline('back', 2).length).toBeGreaterThan(mouth.width * scenery.hillSamplesPerMetre);
  });

  it('close into polygons inside the mouth, from its floor corners up', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      for (let layer = 0; layer < scenery.hills.length; layer++) {
        const polygon = hillPolyline(name, layer);
        expect(polygon.length).toBeGreaterThan(3);
        expect(polygon[0]![1]).toBeCloseTo(-mouth.height / 2, 9);
        expect(polygon[polygon.length - 1]![1]).toBeCloseTo(-mouth.height / 2, 9);
        expect(polygon.every((p) => inside(mouth, p))).toBe(true);
      }
    }
  });

  it('keep the far layer behind the near one', () => {
    const depths = scenery.hills.map((h) => h.depth);
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
    expect(Math.max(...depths)).toBeLessThan(scenery.depth - scenery.backlight.gap);
  });
});

describe('the clouds', () => {
  const { layers } = scenery.clouds;
  const spanOf = (polygon: [number, number][]) => [Math.min(...polygon.map(([x]) => x)), Math.max(...polygon.map(([x]) => x))] as const;

  it('are several, in layers at different depths and speeds, none on a hill\'s depth', () => {
    expect(layers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(layers.map((l) => l.depth)).size).toBe(layers.length);
    expect(new Set(layers.map((l) => l.drift)).size).toBe(layers.length);
    const hills = scenery.hills.map((h) => h.depth);
    for (const layer of layers) {
      expect(hills).not.toContain(layer.depth);
      expect(layer.depth).toBeLessThan(scenery.depth - scenery.backlight.gap);
      expect(layer.clouds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('put at least one cloud in view of every window at the start', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      for (const o of windowOpenings(name)) {
        const lo = mouth.alongSign * (o.a0 - mouth.alongCentre);
        const hi = mouth.alongSign * (o.a1 - mouth.alongCentre);
        const [a, b] = [Math.min(lo, hi), Math.max(lo, hi)];
        const seen = layers.some((_, layer) => cloudLayerPolygons(name, layer).some((p) => spanOf(p)[1] > a && spanOf(p)[0] < b));
        expect(seen, `${name} window`).toBe(true);
      }
    }
  });

  it('drift at their own speeds and wrap once a box width', () => {
    const mouth = sceneryMouth('back');
    expect(cloudLayerOffset(mouth, 0, 0)).toBe(0);
    layers.forEach((layer, i) => {
      expect(cloudLayerOffset(mouth, i, 100)).toBeCloseTo(100 * layer.drift, 9);
      expect(cloudLayerOffset(mouth, i, mouth.width / layer.drift)).toBeCloseTo(0, 6);
      expect(cloudLayerOffset(mouth, i, 1e6)).toBeLessThan(mouth.width);
    });
    expect(cloudLayerOffset(mouth, 0, 50)).not.toBeCloseTo(cloudLayerOffset(mouth, 1, 50), 3);
  });

  it('cover the whole box all through a drift: a copy a width behind fills in for what leaves', () => {
    const mouth = sceneryMouth('back');
    for (let layer = 0; layer < layers.length; layer++) {
      const polygons = cloudLayerPolygons('back', layer);
      expect(polygons).toHaveLength(2 * layers[layer]!.clouds.length);
      const spans = polygons.map(spanOf);
      // The pattern is a box width long: every cloud has its twin exactly one width to the left.
      const half = polygons.length / 2;
      for (let i = 0; i < half; i++) expect(spans[i]![0]).toBeCloseTo(spans[half + i]![0] - mouth.width, 9);
      for (const [, hi] of spans.slice(half)) expect(hi).toBeLessThanOrEqual(mouth.width / 2 + 1e-9);
    }
  });

  it('stand up the wall within the window\'s band and inside the box vertically', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      const [o] = windowOpenings(name);
      for (let layer = 0; layer < layers.length; layer++) {
        for (const polygon of cloudLayerPolygons(name, layer)) {
          const ys = polygon.map(([, y]) => y + mouth.centre[1]);
          expect(Math.min(...ys)).toBeGreaterThan(o!.y0);
          expect(Math.max(...ys)).toBeLessThanOrEqual(o!.y1);
        }
      }
    }
  });
});

describe('the sun and moon', () => {
  it('has the sun up and above the horizon at noon, down and below it at midnight', () => {
    const noon = celestial(0.5);
    expect(noon.sun.visible).toBe(true);
    expect(noon.sun.y).toBeGreaterThan(0);
    expect(noon.sun.x).toBeCloseTo(0.5, 9);
    expect(noon.moon.visible).toBe(false);
    const midnight = celestial(0);
    expect(midnight.sun.visible).toBe(false);
    expect(midnight.sun.y).toBeLessThan(0);
    expect(midnight.moon.visible).toBe(true);
    expect(midnight.moon.x).toBeCloseTo(0.5, 9);
  });

  it('crosses from the left at dawn to the right at dusk, the moon the other half', () => {
    expect(celestial(0.25).sun.x).toBeCloseTo(0, 9);
    expect(celestial(0.75).sun.x).toBeCloseTo(1, 9);
    expect(celestial(0.75).moon.x).toBeCloseTo(0, 9);
    expect(celestial(1.25).moon.x).toBeCloseTo(1, 9);
    // Never both up: they stand opposite each other.
    for (let phase = 0.01; phase < 1; phase += 0.03) {
      const { sun, moon } = celestial(phase);
      expect(sun.visible && moon.visible).toBe(false);
      expect(sun.y).toBeCloseTo(-moon.y, 9);
    }
  });

  it('keeps each disc between the box\'s sides and under the mouth\'s top at its highest', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      for (const [phase, body, radius] of [[0.25, 'sun', scenery.sun.radius], [0.5, 'sun', scenery.sun.radius], [0.75, 'sun', scenery.sun.radius], [0, 'moon', scenery.moon.radius]] as const) {
        const [x, y] = bodyAt(mouth, celestial(phase)[body], radius);
        expect(Math.abs(x) + radius).toBeLessThanOrEqual(mouth.width / 2 + 1e-9);
        expect(y + radius).toBeLessThanOrEqual(mouth.height / 2 + 1e-9);
      }
    }
  });

  it('writes into the buffers it is given, allocating nothing', () => {
    const bodies = celestial(0);
    expect(celestial(0.5, bodies)).toBe(bodies);
    expect(bodies.sun.visible).toBe(true);
    const spot: [number, number] = [0, 0];
    expect(bodyAt(sceneryMouth('back'), bodies.sun, scenery.sun.radius, spot)).toBe(spot);
  });

  it('crosses the windows\' visible band: above the near hills\' line, its peak clear of the opening\'s head', () => {
    const { horizon, rise } = scenery.arc;
    const nearHills = scenery.hills[scenery.hills.length - 1]!;
    const crest = nearHills.base * STAGE.wallHeight + nearHills.amplitude;
    for (const name of WALL_NAMES) {
      const head = Math.min(...windowOpenings(name).map((o) => o.y1));
      const sill = Math.max(...windowOpenings(name).map((o) => o.y0));
      for (const radius of [scenery.sun.radius, scenery.moon.radius]) {
        expect(horizon * STAGE.wallHeight).toBeGreaterThan(crest);
        expect(horizon * STAGE.wallHeight).toBeGreaterThan(sill);
        expect((horizon + rise) * STAGE.wallHeight + radius).toBeLessThan(head);
      }
      // At noon the sun stands at the peak, at the world height the arc says.
      const mouth = sceneryMouth(name);
      expect(bodyAt(mouth, celestial(0.5).sun, scenery.sun.radius)[1] + mouth.centre[1]).toBeCloseTo((horizon + rise) * STAGE.wallHeight, 9);
    }
  });

  it('stands in front of the back panel and behind the hills', () => {
    expect(scenery.sun.depth).toBeLessThan(scenery.depth - scenery.backlight.gap);
    expect(scenery.sun.depth).toBeGreaterThan(Math.max(...scenery.hills.map((h) => h.depth)));
  });
});

describe('the stars', () => {
  it('are lit only at night: full in the dark, none at dusk, dawn or midday', () => {
    expect(starlightAt(0)).toBe(1);
    expect(starlightAt(0.98)).toBe(1);
    for (const phase of [0.12, 0.2, 0.25, 0.3, 0.5, 0.7, 0.75, 0.8, 0.88]) expect(starlightAt(phase), `phase ${phase}`).toBe(0);
  });

  it('fade in after dusk and out before dawn, smoothly and one way each', () => {
    const rising = [0.88, 0.9, 0.92, 0.95].map(starlightAt);
    expect(rising).toEqual([...rising].sort((a, b) => a - b));
    expect(rising[0]).toBe(0);
    expect(rising[3]).toBe(1);
    const falling = [0.05, 0.07, 0.1, 0.12].map(starlightAt);
    expect(falling).toEqual([...falling].sort((a, b) => b - a));
    expect(falling[0]).toBe(1);
    expect(falling[3]).toBe(0);
    expect(starlightAt(1)).toBe(starlightAt(0));
    expect(starlightAt(0.9)).toBeGreaterThan(0);
    expect(starlightAt(0.9)).toBeLessThan(1);
  });
});

describe('the box\'s daylight', () => {
  const phases = Array.from({ length: 101 }, (_, i) => i / 100);

  it('is full at midday and down to the night level in the dark, never outside them', () => {
    expect(daylightAt(0.5)).toBe(1);
    expect(daylightAt(0)).toBe(scenery.nightLevel);
    expect(daylightAt(0.97)).toBe(scenery.nightLevel);
    for (const phase of phases) {
      expect(daylightAt(phase)).toBeGreaterThanOrEqual(scenery.nightLevel);
      expect(daylightAt(phase)).toBeLessThanOrEqual(1);
    }
    expect(daylightAt(1)).toBe(daylightAt(0));
  });

  it('is dim but readable at night: about a quarter of midday', () => {
    expect(scenery.nightLevel).toBeGreaterThan(0.15);
    expect(scenery.nightLevel).toBeLessThanOrEqual(0.3);
  });

  it('is the one curve the starlight is the inverse of: more daylight, never more stars', () => {
    const pairs = phases.map((p) => [daylightAt(p), starlightAt(p)] as const).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pairs.length; i++) expect(pairs[i]![1]).toBeLessThanOrEqual(pairs[i - 1]![1] + 1e-12);
    for (const phase of phases) {
      const expected = Math.min(Math.max((scenery.starsBelow - daylightAt(phase)) / (scenery.starsBelow - scenery.nightLevel), 0), 1);
      expect(starlightAt(phase)).toBeCloseTo(expected, 12);
      if (daylightAt(phase) >= scenery.starsBelow) expect(starlightAt(phase)).toBe(0);
    }
  });
});

describe('the hills over the stars', () => {
  const { strip } = scenery.stars;
  const inside = (polygon: [number, number][], [x, y]: [number, number]) => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]!;
      const [xj, yj] = polygon[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  it('stand in front of the back panel and the backlight, so a pinhole behind a hill is never in view', () => {
    const panel = scenery.depth - scenery.backlight.gap;
    for (const hill of scenery.hills) expect(hill.depth).toBeLessThan(panel);
  });

  it('cover every pinhole below the far skyline: the far hill\'s polygon holds each one, and none above it', async () => {
    const { skyStars } = await import('../src/game/starSky.js');
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      const farthest = hillPolyline(name, 0);
      let covered = 0;
      let open = 0;
      for (const star of skyStars().filter((s) => s.strip === strip[name])) {
        // The star as a point on the panel in box-local coordinates, its x within the box.
        const local: [number, number] = [star.x - scenery.stars.sky.width / 2, star.y - mouth.height / 2];
        if (Math.abs(local[0]) > mouth.width / 2) continue;
        const skyline = Math.max(...farthest.filter(([x]) => Math.abs(x - local[0]) < 0.03).map(([, y]) => y));
        const hidden = local[1] < skyline - 0.02;
        const shown = local[1] > skyline + 0.02;
        if (hidden) {
          covered++;
          expect(inside(farthest, local), `star at ${star.x},${star.y} behind the hill`).toBe(true);
        } else if (shown) {
          open++;
          expect(inside(farthest, local), `star at ${star.x},${star.y} above the hill`).toBe(false);
        }
      }
      expect(covered, name).toBeGreaterThan(0);
      expect(open, name).toBeGreaterThan(0);
    }
  });
});

describe('the box\'s tint', () => {
  const tintAt = (phase: number) => boxTint(phase, skyColourAt(phase), [0, 0, 0]);

  it('is plain white at midday, so the day is the paper as drawn', () => {
    expect(tintAt(0.5)).toEqual([1, 1, 1]);
  });

  it('is a dim, cool moonlit blue at night, about a quarter bright', () => {
    const [r, g, b] = tintAt(0);
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    expect(b).toBeCloseTo(scenery.nightLevel, 2);
    expect(r).toBeGreaterThan(0.05);
  });

  it('warms toward the dusk and dawn sky as it fades and returns, and dims between', () => {
    for (const phase of [0.25, 0.75]) {
      const [r, , b] = tintAt(phase);
      expect(r, `phase ${phase}`).toBeGreaterThan(b);
    }
    const noon = Math.max(...tintAt(0.5));
    for (const phase of [0.1, 0.25, 0.75, 0.9, 0]) expect(Math.max(...tintAt(phase)), `phase ${phase}`).toBeLessThan(noon);
  });

  it('writes into the buffer it is given', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(boxTint(0.3, skyColourAt(0.3), out)).toBe(out);
  });
});

describe('outlines', () => {
  it('ink a hill\'s skyline alone, without the floor or the sides', () => {
    const mouth = sceneryMouth('back');
    const skyline = hillSkyline('back', near);
    expect(skyline).toEqual(hillPolyline('back', near).slice(1, -1));
    const segments = openSegments(skyline);
    expect(segments).toHaveLength(4 * (skyline.length - 1));
    // Every edge runs along the profile: none rests on the floor or stands on a side.
    for (let i = 0; i < segments.length; i += 4) {
      expect(segments[i]).not.toBe(segments[i + 2]);
      expect(segments[i + 1]).toBeGreaterThan(-mouth.height / 2);
    }
    expect(openSegments([[0, 0], [1, 0]])).toEqual([0, 0, 1, 0]);
  });

  it('turn a polygon into one segment per edge, closed', () => {
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const segments = closedSegments(square);
    expect(segments).toHaveLength(16);
    expect(segments.slice(-4)).toEqual([0, 1, 0, 0]);
    expect(discPolygon(0.5, 8)).toHaveLength(8);
  });
});
