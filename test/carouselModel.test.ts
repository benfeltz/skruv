import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI } from '../src/constants.js';
import { centreSlot, clampTravel, pitch, slotCount, snapSteps, stripSide, tapOn, visibleCount, windowOf } from '../src/game/carouselModel.js';

const { page, gap, reach } = BOOKLET_UI.strip;
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
  it('lets the first page reach the centre and no further', () => {
    expect(clampTravel(500, 0, 10, step, 9)).toBe(0);
    expect(clampTravel(30, 0, 10, step, 9)).toBe(0);
    expect(clampTravel(500, 3, 10, step, 9)).toBe(3 * step);
  });

  it('lets the last page reach the centre and no further', () => {
    expect(clampTravel(-500, 9, 10, step, 9)).toBe(0);
    expect(clampTravel(-500, 7, 10, step, 9)).toBe(-2 * step);
  });

  it('leaves a pull in between as it is', () => {
    expect(clampTravel(-112, 4, 10, step, 9)).toBe(-112);
    expect(clampTravel(25, 4, 10, step, 9)).toBe(25);
  });

  it('goes no further than the pages the slots were built for', () => {
    expect(reach).toBe(1);
    expect(clampTravel(-500, 4, 10, step, reach)).toBe(-step);
    expect(clampTravel(500, 4, 10, step, reach)).toBe(step);
    // ...and still only to the centre at an end.
    expect(clampTravel(500, 0, 10, step, reach)).toBe(0);
    expect(clampTravel(-500, 9, 10, step, reach)).toBe(0);
  });
});

describe('how many slots are built', () => {
  it('fills the band at rest and at the end of a drag, odd, along either axis', () => {
    // A 390 px phone: 3 shown, 79 px spare each side, and a page's drag more.
    expect(slotCount(390, strip, gutter, reach)).toBe(7);
    expect(slotCount(844, tall, gutter, reach)).toBeGreaterThan(visibleCount(844, tall, gutter));
    for (const sizes of [strip, tall]) {
      for (let extent = 200; extent < 2000; extent += 13) {
        const built = slotCount(extent, sizes, gutter, reach);
        expect(built % 2).toBe(1);
        // The centre slot's neighbours reach the band's edge with the track a drag off centre.
        const half = (built - 1) / 2;
        expect(half * pitch(sizes) - reach * pitch(sizes) + sizes.slot / 2).toBeGreaterThanOrEqual(extent / 2);
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

describe('which side the band stands on in landscape', () => {
  it('is the side without the notch: the larger safe-area inset is the notch', () => {
    expect(stripSide(59, 0)).toBe('right');
    expect(stripSide(0, 59)).toBe('left');
    expect(stripSide(47, 34)).toBe('right');
    expect(stripSide(34, 47)).toBe('left');
  });

  it('is the right with no notch, or the same inset both sides', () => {
    expect(stripSide(0, 0)).toBe('right');
    expect(stripSide(20, 20)).toBe('right');
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
