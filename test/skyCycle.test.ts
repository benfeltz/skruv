import { describe, expect, it } from 'vitest';
import { COLORS, STAGE } from '../src/constants.js';
import { advance, phaseFromClock, skyColourAt } from '../src/game/skyCycle.js';

const rgbOf = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => c / 255);
const { keyframes } = STAGE.sky;

describe('the clock sets the phase', () => {
  it('is 0 at midnight and 0.5 at noon', () => {
    expect(phaseFromClock(new Date(2026, 9, 16, 0, 0, 0))).toBe(0);
    expect(phaseFromClock(new Date(2026, 9, 16, 12, 0, 0))).toBe(0.5);
    expect(phaseFromClock(new Date(2026, 9, 16, 18, 0, 0))).toBe(0.75);
  });
});

describe('advance', () => {
  it('moves a whole cycle in cycleMinutes', () => {
    expect(advance(0, 360, 12)).toBeCloseTo(0.5, 9);
  });
  it('wraps past 1 and below 0', () => {
    expect(advance(0.9, 72, 12)).toBeCloseTo(0, 9);
    expect(advance(0.95, 72, 12)).toBeCloseTo(0.05, 9);
    expect(advance(0.05, -72, 12)).toBeCloseTo(0.95, 9);
  });
});

describe('skyColourAt', () => {
  it('is each keyframe at its phase', () => {
    for (const k of keyframes) expect(skyColourAt(k.at)).toEqual(rgbOf(k.color));
  });
  it('is the midpoint halfway between two keyframes', () => {
    const [a, b] = [rgbOf(keyframes[0]!.color), rgbOf(keyframes[1]!.color)];
    const mid = skyColourAt((keyframes[0]!.at + keyframes[1]!.at) / 2);
    mid.forEach((c, i) => expect(c).toBeCloseTo((a[i]! + b[i]!) / 2, 9));
  });
  it('blends the last keyframe back to the first across the wrap', () => {
    const [a, b] = [rgbOf(keyframes.at(-1)!.color), rgbOf(keyframes[0]!.color)];
    const mid = skyColourAt((keyframes.at(-1)!.at + 1) / 2);
    mid.forEach((c, i) => expect(c).toBeCloseTo((a[i]! + b[i]!) / 2, 9));
  });
  it('writes into the array it is given', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(skyColourAt(0.5, out)).toBe(out);
  });
  it('paints the day colour at noon', () => {
    expect(skyColourAt(0.5)).toEqual(rgbOf(COLORS.sky));
  });
});
