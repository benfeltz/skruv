import { describe, expect, it } from 'vitest';
import { FAN } from '../src/constants.js';
import { coverDepth, fanLabel, fanLayout, fanOrder, fanWidth, overflows } from '../src/game/manualFan.js';

describe('the covers\' order', () => {
  it('keeps the covers where they were, drops the gone and adds the new at the end', () => {
    expect(fanOrder(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual(['a', 'c', 'd']);
  });
  it('is not re-arranged when another world goes active (the room\'s order changes, the fan\'s does not)', () => {
    expect(fanOrder(['johnny', 'blank'], ['blank', 'johnny'])).toEqual(['johnny', 'blank']);
  });
  it('starts from the room\'s order', () => {
    expect(fanOrder([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(fanOrder(['a'], [])).toEqual([]);
  });
});

describe('what lies on top', () => {
  it('puts the active cover over every other, the rest as they lie', () => {
    expect([0, 1, 2].map((i) => coverDepth(i, 3, 1))).toEqual([0, 3, 2]);
    expect(coverDepth(0, 1, 0)).toBe(1);
  });
});

describe('where the covers sit', () => {
  it('lays a lone folded cover flat at 0', () => {
    expect(fanLayout(1, false, FAN)).toEqual([{ x: 0, angle: 0 }]);
  });
  it('folds covers a step apart, leaning alternately from the first', () => {
    const [a, b, c] = fanLayout(3, false, FAN);
    expect([a.x, b.x, c.x]).toEqual([0, FAN.step, 2 * FAN.step]);
    expect([a.angle, b.angle, c.angle]).toEqual([-FAN.tilt, FAN.tilt, -FAN.tilt]);
  });
  it('spreads covers a pitch apart, upright', () => {
    const [a, b, c] = fanLayout(3, true, FAN);
    const pitch = FAN.cover + FAN.gap;
    expect([a.x, b.x, c.x]).toEqual([0, pitch, 2 * pitch]);
    expect([a.angle, b.angle, c.angle]).toEqual([0, 0, 0]);
  });
  it('has nothing to place with no covers', () => {
    expect(fanLayout(0, true, FAN)).toEqual([]);
  });
});

describe('widths', () => {
  it('is 0 with no covers', () => {
    expect(fanWidth(0, true, FAN)).toBe(0);
    expect(fanWidth(0, false, FAN)).toBe(0);
  });
  it('is one cover wide for a lone cover, either way', () => {
    expect(fanWidth(1, true, FAN)).toBe(FAN.cover);
    expect(fanWidth(1, false, FAN)).toBe(FAN.cover);
  });
  it('folded adds a step per cover, spread a pitch', () => {
    expect(fanWidth(3, false, FAN)).toBe(FAN.cover + 2 * FAN.step);
    expect(fanWidth(3, true, FAN)).toBe(3 * FAN.cover + 2 * FAN.gap);
  });
});

describe('overflow', () => {
  it('is true only when the spread row is wider than the box', () => {
    const width = fanWidth(4, true, FAN);
    expect(overflows(4, width, FAN)).toBe(false);
    expect(overflows(4, width - 1, FAN)).toBe(true);
  });
});

describe('the label', () => {
  it('counts the manuals, singular and plural', () => {
    expect(fanLabel(1)).toBe('Switch item: 1 manual');
    expect(fanLabel(2)).toBe('Switch item: 2 manuals');
  });
});
