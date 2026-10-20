import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI } from '../src/constants.js';
import { centreSlot, clampTravel, flickPages, pitch, restShift, slotCount, slotsInView, snapSteps, tapOn, trackRange, velocityOf, visibleCount, wheelDelta, wheelNext, WHEEL_REST, windowOf } from '../src/game/carouselModel.js';

const { page, gap } = BOOKLET_UI.strip;
const { gutter } = BOOKLET_UI.page;
const strip = { slot: page, gap };
// Down the right edge a slot's length along the band is a page's height.
const tall = { slot: Math.round((page * BOOKLET.pageSize[1]) / BOOKLET.pageSize[0]), gap };
const step = pitch(strip);

describe('how many pages the band shows', () => {
  it('follows the long side: three on a phone\'s width, more on a long edge', () => {
    expect(step).toBe(80);
    expect(visibleCount(390, strip, gutter)).toBe(3);
    expect(visibleCount(1280, strip, gutter)).toBe(15);
    expect(visibleCount(800, strip, gutter)).toBe(9);
  });

  it('counts a slot by its length along the band: a page\'s height down the right edge', () => {
    expect(tall.slot).toBe(100);
    expect(pitch(tall)).toBe(108);
    // 800 px tall: (800 - 24 + 8) / 108 = 7.3 pages.
    expect(visibleCount(800, tall, gutter)).toBe(7);
    expect(visibleCount(390, tall, gutter)).toBe(3);
  });

  it('is always odd, so one page is the centre, and never below one', () => {
    for (let extent = 0; extent < 2000; extent += 7) {
      const count = visibleCount(extent, strip, gutter);
      expect(count % 2).toBe(1);
      expect(count).toBeGreaterThanOrEqual(1);
    }
    expect(visibleCount(0, strip, gutter)).toBe(1);
  });

  it('puts the current page in the middle slot', () => {
    expect(centreSlot(3)).toBe(1);
    expect(centreSlot(5)).toBe(2);
  });
});

describe('how far the track may be pulled', () => {
  it('lets the first page reach the band\'s start and no further', () => {
    expect(clampTravel(500, 0, 10, 5, step)).toBe(0);
    expect(clampTravel(30, 0, 10, 5, step)).toBe(0);
    // The first page is one pitch off centre's start-side limit: it may go one pitch further.
    expect(clampTravel(500, 3, 10, 5, step)).toBe(step);
  });

  it('lets the last page reach the band\'s end and no further', () => {
    expect(clampTravel(-500, 9, 10, 5, step)).toBe(0);
    // Page 7 of 10 with five visible: the last page already sits at the band's end.
    expect(clampTravel(-500, 7, 10, 5, step)).toBe(0);
  });

  it('leaves a pull in between as it is', () => {
    expect(clampTravel(-112, 4, 10, 5, step)).toBe(-112);
    expect(clampTravel(25, 4, 10, 5, step)).toBe(25);
  });

  it('goes to the band\'s ends and no further: the first page to the start, the last to the end', () => {
    expect(clampTravel(-500, 4, 10, 5, step)).toBe(-3 * step);
    expect(clampTravel(500, 4, 10, 5, step)).toBe(2 * step);
    expect(clampTravel(500, 1, 10, 5, step)).toBe(0);
  });
});

describe('how many slots are built', () => {
  it('fills the band at rest and at the end of a drag, a slot for every page, odd, along either axis', () => {
    // A 390 px phone, 10 pages: a slot for every page round any current one.
    expect(slotCount(390, strip, gutter, 10)).toBe(19);
    expect(slotCount(844, tall, gutter, 1)).toBeGreaterThan(visibleCount(844, tall, gutter));
    for (const sizes of [strip, tall]) {
      for (let extent = 200; extent < 2000; extent += 13) {
        for (const count of [1, 2, 10, 40]) {
          const built = slotCount(extent, sizes, gutter, count);
          expect(built % 2).toBe(1);
          expect(built).toBeGreaterThanOrEqual(2 * count - 1);
          // With the track a rest shift off centre, the centre slot's neighbours still reach the band's edge.
          const shown = visibleCount(extent, sizes, gutter);
          const half = (built - 1) / 2;
          const shifted = centreSlot(shown) * pitch(sizes);
          expect(half * pitch(sizes) - shifted + sizes.slot / 2).toBeGreaterThanOrEqual(extent / 2);
        }
      }
    }
  });
});

describe('how many pages a release moves', () => {
  it('is the nearest page, toward later pages for a pull toward the start of the band', () => {
    expect(snapSteps(-112, step)).toBe(1);
    expect(snapSteps(-170, step)).toBe(2);
    expect(snapSteps(112, step)).toBe(-1);
    expect(snapSteps(0, step)).toBe(0);
    expect(snapSteps(-30, step)).toBe(0);
    expect(snapSteps(30, step)).toBe(0);
  });

  it('counts half a pitch as a page, either way', () => {
    expect(snapSteps(-step / 2, step)).toBe(1);
    expect(snapSteps(step / 2, step)).toBe(-1);
  });
});

describe('the window round the current page', () => {
  it('holds the page in the centre with its neighbours either side', () => {
    expect(windowOf(4, 10, 3)).toEqual([3, 4, 5]);
    expect(windowOf(4, 10, 5)).toEqual([2, 3, 4, 5, 6]);
  });

  it('leaves empty slots before the first page — the strip does not wrap', () => {
    expect(windowOf(0, 10, 3)).toEqual([null, 0, 1]);
    expect(windowOf(1, 10, 5)).toEqual([null, 0, 1, 2, 3]);
  });

  it('leaves empty slots after the last page', () => {
    expect(windowOf(9, 10, 3)).toEqual([8, 9, null]);
    expect(windowOf(8, 10, 5)).toEqual([6, 7, 8, 9, null]);
  });
});

describe('a tap on a slot', () => {
  const slots = windowOf(0, 10, 5);

  it('on the centre does not move', () => {
    expect(tapOn(slots, 2)).toBe('centre');
  });

  it('on a side slot moves to that slot\'s page', () => {
    expect(tapOn(slots, 3)).toBe(1);
    expect(tapOn(slots, 4)).toBe(2);
    expect(tapOn(windowOf(5, 10, 5), 0)).toBe(3);
  });

  it('on an empty slot does nothing', () => {
    expect(tapOn(slots, 0)).toBeNull();
    expect(tapOn(slots, 1)).toBeNull();
  });
});

// Ben, 2026-10-18: no padding beside the strip. The track rests off centre near either end so no
// visible slot is empty; the current page keeps its gold border wherever it then sits.
describe('where the track rests', () => {
  /** The pages the visible slots show, the track shifted `restShift` slots. */
  const shown = (current: number, count: number, visible: number) => {
    const shiftBy = restShift(current, count, visible);
    return windowOf(current, count, visible + 2 * Math.abs(shiftBy)).slice(Math.abs(shiftBy) - shiftBy, Math.abs(shiftBy) - shiftBy + visible);
  };

  it('fills the band from the first page: no empty slot before it', () => {
    expect(restShift(0, 12, 5)).toBe(-2);
    expect(restShift(1, 12, 5)).toBe(-1);
    expect(shown(0, 12, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(shown(1, 12, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('fills it to the last page: no empty slot after it', () => {
    expect(restShift(11, 12, 5)).toBe(2);
    expect(shown(11, 12, 5)).toEqual([7, 8, 9, 10, 11]);
  });

  it('keeps the current page in the middle between the ends', () => {
    expect(restShift(5, 12, 5)).toBe(0);
    expect(shown(5, 12, 5)).toEqual([3, 4, 5, 6, 7]);
  });

  it('starts a booklet shorter than the band at the band\'s start', () => {
    expect(restShift(0, 2, 5)).toBe(-2);
    expect(shown(0, 2, 5)).toEqual([0, 1, null, null, null]);
    expect(shown(1, 2, 5)).toEqual([0, 1, null, null, null]);
  });
});

describe('how far the track may sit off centre', () => {
  it('is bounded by the first page at the band\'s start and the last at its end', () => {
    expect(trackRange(4, 10, 5)).toEqual({ min: -3, max: 2 });
    expect(trackRange(0, 10, 5).max).toBe(-2);
    expect(trackRange(9, 10, 5).min).toBe(2);
  });

  it('starts a booklet shorter than the band at the band\'s start', () => {
    expect(trackRange(1, 2, 5)).toEqual({ min: -1, max: -1 });
  });

  it('holds the rest shift: 0 clamped into the range, for every page', () => {
    for (let page = 0; page < 12; page++) {
      const { min, max } = trackRange(page, 12, 5);
      expect(restShift(page, 12, 5)).toBe(Math.min(max, Math.max(min, 0)));
    }
  });
});

describe('which slots are in the band', () => {
  const slot = page;
  it('holds the centre and two either side at rest on a 390 px band', () => {
    expect(slotsInView(0, 19, step, slot, 390)).toEqual({ first: 7, last: 11 });
  });

  it('moves with the track', () => {
    expect(slotsInView(-4 * step, 19, step, slot, 390)).toEqual({ first: 11, last: 15 });
  });

  it('never leaves the slots built', () => {
    expect(slotsInView(-50 * step, 19, step, slot, 390).last).toBe(18);
    expect(slotsInView(50 * step, 19, step, slot, 390).first).toBe(0);
  });
});

describe('how fast a release is', () => {
  it('is the distance over the time across the window', () => {
    expect(velocityOf([{ t: 0, at: 0 }, { t: 50, at: 80 }], 100)).toBeCloseTo(1.6);
  });

  it('leaves out a sample older than the window', () => {
    expect(velocityOf([{ t: 0, at: 0 }, { t: 500, at: 100 }, { t: 550, at: 180 }], 100)).toBeCloseTo(1.6);
  });

  it('is 0 with one sample or no time between them', () => {
    expect(velocityOf([{ t: 0, at: 0 }], 100)).toBe(0);
    expect(velocityOf([{ t: 5, at: 0 }, { t: 5, at: 50 }], 100)).toBe(0);
    expect(velocityOf([], 100)).toBe(0);
  });
});

describe('how many pages a flick carries', () => {
  const flick = { velocity: 0.6, maxPages: 2 };
  it('is none below the threshold', () => {
    expect(flickPages(0.59, flick)).toBe(0);
    expect(flickPages(-0.3, flick)).toBe(0);
  });

  it('is a page at the threshold, toward later pages for a pull toward the band\'s start', () => {
    expect(flickPages(-0.6, flick)).toBe(1);
    expect(flickPages(1.2, flick)).toBe(-2);
  });

  it('never carries more than maxPages', () => {
    expect(flickPages(-9, flick)).toBe(2);
  });
});

describe('the wheel along the band', () => {
  it('takes the larger axis with its sign, times the scale', () => {
    expect(wheelDelta({ deltaX: 5, deltaY: -100 }, 1)).toBe(-100);
    expect(wheelDelta({ deltaX: 120, deltaY: 10 }, 1)).toBe(120);
    expect(wheelDelta({ deltaX: 0, deltaY: 3 }, 16)).toBe(48);
  });
});

describe('the wheel steps', () => {
  const rule = { threshold: 40, stepMs: 200 };

  it('steps once for a notch and clears what it gathered', () => {
    expect(wheelNext(WHEEL_REST, 100, 1000, rule)).toEqual({ state: { acc: 0, steppedAt: 1000 }, steps: 1 });
    expect(wheelNext(WHEEL_REST, -100, 1000, rule).steps).toBe(-1);
  });

  it('gathers small deltas and steps when they pass the threshold', () => {
    let state = WHEEL_REST;
    const stepsAt: number[] = [];
    [0, 10, 20, 30].forEach((now) => {
      const next = wheelNext(state, 15, now, rule);
      state = next.state;
      stepsAt.push(next.steps);
    });
    expect(stepsAt).toEqual([0, 0, 1, 0]);
  });

  it('rests for stepMs after a step, then steps again', () => {
    const first = wheelNext(WHEEL_REST, 100, 1000, rule);
    expect(wheelNext(first.state, 100, 1100, rule).steps).toBe(0);
    expect(wheelNext(first.state, 100, 1200, rule).steps).toBe(1);
  });

  it('clears what was gathered when the delta turns', () => {
    const gathered = wheelNext(WHEEL_REST, 30, 0, rule);
    expect(gathered.steps).toBe(0);
    const turned = wheelNext(gathered.state, -30, 10, rule);
    expect(turned).toEqual({ state: { acc: -30, steppedAt: -Infinity }, steps: 0 });
  });
});
