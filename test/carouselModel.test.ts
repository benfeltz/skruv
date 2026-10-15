import { describe, expect, it } from 'vitest';
import { BOOKLET_UI } from '../src/constants.js';
import { centreSlot, tapOn, visibleCount, windowOf } from '../src/game/carouselModel.js';

const { breakpoint, narrow, wide } = BOOKLET_UI.strip;

describe('how many pages the strip shows', () => {
  it('is three below the breakpoint and five from it up', () => {
    expect(narrow).toBe(3);
    expect(wide).toBe(5);
    expect(visibleCount(breakpoint - 1)).toBe(3);
    expect(visibleCount(breakpoint)).toBe(5);
    expect(visibleCount(390)).toBe(3);
    expect(visibleCount(1440)).toBe(5);
  });

  it('puts the current page in the middle slot', () => {
    expect(centreSlot(3)).toBe(1);
    expect(centreSlot(5)).toBe(2);
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
