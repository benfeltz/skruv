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
  sceneryBox,
  starField,
  starlightAt,
  starMask,
  treePolygons,
} from '../src/game/scenery.js';
import { WALL_NAMES, sceneryMouth, windowOpenings } from '../src/game/stageBoxes.js';

const { scenery } = STAGE;
const near = scenery.hills.length - 1;
const inside = (mouth: ReturnType<typeof sceneryMouth>, [x, y]: [number, number]) =>
  Math.abs(x) <= mouth.width / 2 + 1e-9 && Math.abs(y) <= mouth.height / 2 + 1e-9;

describe('the box behind a wall', () => {
  it('has a mouth over every opening and the margin, within the wall top and the floor', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      const openings = windowOpenings(name);
      const lo = Math.min(...openings.map((o) => o.a0)) - STAGE.window.skyMargin;
      const hi = Math.max(...openings.map((o) => o.a1)) + STAGE.window.skyMargin;
      expect(mouth.width).toBeCloseTo(hi - lo, 9);
      expect(mouth.alongCentre).toBeCloseTo((lo + hi) / 2, 9);
      expect(mouth.centre[1] + mouth.height / 2).toBeLessThanOrEqual(STAGE.wallHeight + 1e-9);
      expect(mouth.centre[1] - mouth.height / 2).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('is one wide mouth for the back wall\'s two windows and one for the left wall\'s', () => {
    expect(sceneryMouth('back').width).toBeGreaterThan(2 * STAGE.window.width + STAGE.window.skyMargin);
    expect(sceneryMouth('left').width).toBeCloseTo(STAGE.window.width + 2 * STAGE.window.skyMargin, 9);
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

  it('are continuous across the pier of the back wall', () => {
    const profile = hillPolyline('back', near).slice(1, -1);
    const steps = profile.slice(1).map(([, y], i) => Math.abs(y - profile[i]![1]));
    const reach = (2 * Math.PI * scenery.hills[near]!.amplitude * (1 + 1 / scenery.hillDetail.ratio)) / scenery.hillSamplesPerMetre;
    expect(Math.max(...steps)).toBeLessThan(reach);
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

describe('the trees and the cloud', () => {
  it('stand on the near hill, inside the mouth', () => {
    for (const name of WALL_NAMES) {
      const mouth = sceneryMouth(name);
      const trees = treePolygons(name);
      expect(trees).toHaveLength(scenery.tree.at[name].length);
      trees.forEach((tree, i) => {
        const along = scenery.tree.at[name][i]!;
        const base = Math.min(...tree.map(([, y]) => y));
        expect(base).toBeCloseTo(hillHeight(along, near) - mouth.centre[1], 9);
        expect(tree.every((p) => inside(mouth, p))).toBe(true);
      });
    }
  });

  it('puts every tree in view through a window', () => {
    for (const name of WALL_NAMES) {
      for (const along of scenery.tree.at[name]) {
        expect(windowOpenings(name).some((o) => along > o.a0 && along < o.a1)).toBe(true);
      }
    }
  });

  it('drifts at its speed and wraps once clear of the mouth', () => {
    const name = 'back';
    const reach = sceneryMouth(name).width + scenery.cloud.width;
    expect(cloudX(name, 0)).toBeCloseTo(-reach / 2, 9);
    expect(cloudX(name, 100) - cloudX(name, 0)).toBeCloseTo(100 * scenery.cloud.drift, 9);
    expect(cloudX(name, reach / scenery.cloud.drift)).toBeCloseTo(cloudX(name, 0), 6);
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
        const [x, y] = bodyAt(name, celestial(phase)[body], radius);
        expect(Math.abs(x) + radius).toBeLessThanOrEqual(mouth.width / 2 + 1e-9);
        expect(y + radius).toBeLessThanOrEqual(mouth.height / 2 + 1e-9);
      }
    }
  });

  it('stands in front of the back panel and behind the hills', () => {
    expect(scenery.sun.depth).toBeLessThan(scenery.depth - scenery.backlight.gap);
    expect(scenery.sun.depth).toBeGreaterThan(Math.max(...scenery.hills.map((h) => h.depth)));
  });
});

describe('the stars', () => {
  it('are fully lit at midnight and gone at noon, blending through dawn and dusk', () => {
    expect(starlightAt(0)).toBe(1);
    expect(starlightAt(0.5)).toBe(0);
    expect(starlightAt(0.25)).toBeGreaterThan(0);
    expect(starlightAt(0.25)).toBeLessThan(1);
    expect(starlightAt(0.125)).toBeGreaterThan(starlightAt(0.25));
    expect(starlightAt(0.375)).toBeLessThan(starlightAt(0.25));
    expect(starlightAt(1)).toBe(starlightAt(0));
    expect(starlightAt(0.9)).toBeGreaterThan(starlightAt(0.75));
  });

  it('are the same for the same seed and inside the tile', () => {
    expect(starField(7, 20)).toEqual(starField(7, 20));
    expect(starField(7, 20)).not.toEqual(starField(8, 20));
    expect(starField(7, scenery.stars.count)).toHaveLength(scenery.stars.count);
    for (const [u, v] of starField(7, 200)) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('pierce a mask of paper with holes, a small share of it', () => {
    const mask = starMask();
    expect(mask).toHaveLength(scenery.stars.texels ** 2);
    const holes = mask.filter((v) => v === 0).length;
    expect(holes).toBeGreaterThan(scenery.stars.count);
    expect(holes / mask.length).toBeLessThan(0.05);
    expect(mask.every((v) => v === 0 || v === 255)).toBe(true);
  });
});

describe('outlines', () => {
  it('turn a polygon into one segment per edge, closed', () => {
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const segments = closedSegments(square);
    expect(segments).toHaveLength(16);
    expect(segments.slice(-4)).toEqual([0, 1, 0, 0]);
    expect(discPolygon(0.5, 8)).toHaveLength(8);
  });
});
