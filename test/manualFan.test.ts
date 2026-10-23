import { describe, expect, it } from 'vitest';
import { FAN } from '../src/constants.js';
import { fanCovers, fanLabel, fanLayout, fanWidth, overflows } from '../src/game/manualFan.js';

describe('which manuals the fan holds', () => {
  it('leaves out the active one and keeps room order', () => {
    expect(fanCovers(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
  it('holds every id when none is active', () => {
    expect(fanCovers(['a', 'b'], null)).toEqual(['a', 'b']);
  });
  it('is empty with one world', () => {
    expect(fanCovers(['a'], 'a')).toEqual([]);
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
