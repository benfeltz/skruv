import { describe, expect, it } from 'vitest';
import { GESTURE, LIFT_LINE, ROOM } from '../src/constants.js';
import { clampLift } from '../src/game/dragMath.js';
import { easeHeight, fractionOf, heightAt, liftRange, pressOnKnob } from '../src/game/liftLine.js';

describe('liftRange', () => {
  it.each([
    ['thin', 0.009],
    ['tall', 1.01],
  ])('matches clampLift for a %s part', (_name, half) => {
    const [min, max] = liftRange(half);
    expect(min).toBe(clampLift(-100, half, ROOM, GESTURE.ceilingMargin));
    expect(max).toBe(clampLift(100, half, ROOM, GESTURE.ceilingMargin));
    expect(min).toBe(half);
    expect(max).toBeCloseTo(ROOM.height - GESTURE.ceilingMargin - half, 12);
  });
});

describe('fractionOf / heightAt', () => {
  const range = liftRange(0.2);

  it('round-trips across the range', () => {
    for (const f of [0, 0.1, 0.5, 0.77, 1]) {
      expect(fractionOf(heightAt(f, range), range)).toBeCloseTo(f, 12);
    }
  });

  it('puts the floor at 0 and the ceiling at 1', () => {
    expect(fractionOf(range[0], range)).toBe(0);
    expect(fractionOf(range[1], range)).toBe(1);
  });

  it('clamps at both ends', () => {
    expect(fractionOf(-1, range)).toBe(0);
    expect(fractionOf(99, range)).toBe(1);
    expect(heightAt(-0.5, range)).toBe(range[0]);
    expect(heightAt(1.5, range)).toBe(range[1]);
  });

  it('reads 0 for a part too tall to lift', () => {
    expect(fractionOf(2, [2, 2])).toBe(0);
  });
});

describe('easeHeight', () => {
  it('covers the same share of the gap at 30, 60 and 120 fps', () => {
    const seconds = 0.5;
    const after = (fps: number) => {
      let y = 0;
      for (let i = 0; i < seconds * fps; i++) y = easeHeight(y, 1, LIFT_LINE.easeRate, 1 / fps);
      return y;
    };
    expect(after(30)).toBeCloseTo(after(60), 9);
    expect(after(120)).toBeCloseTo(after(60), 9);
    expect(after(60)).toBeGreaterThan(0.9);
  });

  it('stays put with no time or no rate', () => {
    expect(easeHeight(0.3, 1, LIFT_LINE.easeRate, 0)).toBe(0.3);
    expect(easeHeight(0.3, 1, 0, 0.1)).toBe(0.3);
  });
});

describe('pressOnKnob', () => {
  const r = LIFT_LINE.knobRadius;

  it('counts the knob edge as the knob, and just past it as the line', () => {
    expect(pressOnKnob(300, 300, r)).toBe(true);
    expect(pressOnKnob(300 + r, 300, r)).toBe(true);
    expect(pressOnKnob(300 - r, 300, r)).toBe(true);
    expect(pressOnKnob(300 + r + 1, 300, r)).toBe(false);
    expect(pressOnKnob(300 - r - 1, 300, r)).toBe(false);
  });
});
