import { describe, expect, it } from 'vitest';
import { COLORS, STAGE } from '../src/constants.js';
import { advance, closedLoop, hexToRgb, loopOf, phaseFromClock, segmentAt, skyColourAt, sortedKeyframes } from '../src/game/skyCycle.js';

const rgbOf = hexToRgb;
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

describe('keyframes that do not start at 0', () => {
  const loop = loopOf([{ at: 0.1, color: 0xff0000 }, { at: 0.6, color: 0x0000ff }]);
  it('blend the last back to the first across the wrap, never past either', () => {
    expect(skyColourAt(0.1, [0, 0, 0], loop)).toEqual([1, 0, 0]);
    expect(skyColourAt(0.85, [0, 0, 0], loop)[0]).toBeCloseTo(0.5, 9);
    for (const p of [0, 0.05, 0.99]) {
      for (const c of skyColourAt(p, [0, 0, 0], loop)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
  it('refuses keyframes it cannot blend', () => {
    expect(() => loopOf([])).toThrow(/at least one/);
    expect(() => loopOf([{ at: 0.2, color: 0 }, { at: 0.2, color: 1 }])).toThrow(/share phase/);
    expect(() => loopOf([{ at: 1, color: 0 }])).toThrow(/outside/);
  });
});

describe('the loop machinery any keyframed value shares', () => {
  it('sorts keyframes and refuses ones that would divide by zero, naming what they are', () => {
    expect(sortedKeyframes([{ at: 0.6 }, { at: 0.1 }], 'x').map((k) => k.at)).toEqual([0.1, 0.6]);
    expect(() => sortedKeyframes([], 'starlight')).toThrow('the starlight needs at least one keyframe');
    expect(() => sortedKeyframes([{ at: 0.2 }, { at: 0.2 }], 'starlight')).toThrow('two starlight keyframes share phase 0.2');
    expect(() => sortedKeyframes([{ at: 1 }], 'starlight')).toThrow('starlight keyframe at 1 is outside [0, 1)');
  });

  it('closes a loop on its first stop and finds the segment round a phase', () => {
    const loop = closedLoop([{ at: 0.1, v: 0 }, { at: 0.6, v: 1 }]);
    expect(loop.map((s) => s.at)).toEqual([0.1, 0.6, 1.1]);
    expect(segmentAt(loop, 0.35).t).toBeCloseTo(0.5, 9);
    expect(segmentAt(loop, 0.85).from.v).toBe(1);
    expect(segmentAt(loop, 0.85).t).toBeCloseTo(0.5, 9);
    expect(segmentAt(loop, 0.05).t).toBeCloseTo(0.9, 9);
  });
});
