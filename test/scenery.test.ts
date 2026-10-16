import { describe, expect, it } from 'vitest';
import { STAGE } from '../src/constants.js';
import {
  bodyAt,
  celestial,
  cloudPolygon,
  cloudX,
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

  it('roll smoothly in the near layer and peak sharply in the far one, so the two read as different distances', () => {
    const corner = (layer: number) => {
      const y = hillSkyline('back', layer).map(([, v]) => v);
      return Math.max(...y.slice(1, -1).map((v, i) => Math.abs(y[i + 2]! - 2 * v + y[i]!)));
    };
    const nearLayer = scenery.hills.length - 1;
    expect(scenery.hills[0]!.ridged).toBe(true);
    expect(scenery.hills[nearLayer]!.ridged).toBe(false);
    expect(corner(nearLayer)).toBeLessThan(0.003);
    expect(corner(0)).toBeGreaterThan(8 * corner(nearLayer));
  });

  it('sample finely enough that a smooth hill has no corners', () => {
    expect(scenery.hillSamplesPerMetre).toBeGreaterThanOrEqual(30);
    const mouth = sceneryMouth('back');
    expect(hillPolyline('back', 1).length).toBeGreaterThan(mouth.width * scenery.hillSamplesPerMetre);
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

describe('the cloud', () => {
  it('drifts at its speed and wraps once clear of the mouth', () => {
    const name = 'back';
    const reach = sceneryMouth(name).width + scenery.cloud.width;
    expect(cloudX(sceneryMouth(name), 0)).toBeCloseTo(-reach / 2, 9);
    expect(cloudX(sceneryMouth(name), 100) - cloudX(sceneryMouth(name), 0)).toBeCloseTo(100 * scenery.cloud.drift, 9);
    expect(cloudX(sceneryMouth(name), reach / scenery.cloud.drift)).toBeCloseTo(cloudX(sceneryMouth(name), 0), 6);
    const mouth = sceneryMouth(name);
    expect(cloudPolygon(name).every(([, y]) => Math.abs(y) <= mouth.height / 2)).toBe(true);
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
