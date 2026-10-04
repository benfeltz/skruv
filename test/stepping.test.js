import { describe, expect, it } from 'vitest';
import { createAccumulator } from '../src/physics/stepping.js';

const DT = 1 / 60;

describe('createAccumulator', () => {
  it('runs no steps for a zero delta', () => {
    expect(createAccumulator(DT, 4).consume(0)).toBe(0);
  });

  it('accumulates sub-step deltas until a step fires', () => {
    const acc = createAccumulator(DT, 4);
    expect(acc.consume(DT * 0.4)).toBe(0);
    expect(acc.consume(DT * 0.4)).toBe(0);
    expect(acc.consume(DT * 0.4)).toBe(1);
  });

  it('banks the remainder for the next frame', () => {
    const acc = createAccumulator(DT, 4);
    expect(acc.consume(DT * 1.5)).toBe(1);
    expect(acc.consume(DT * 0.5)).toBe(1);
    expect(acc.consume(DT * 0.5)).toBe(0);
  });

  it('caps steps per frame and drops the backlog beyond the cap', () => {
    const acc = createAccumulator(DT, 4);
    expect(acc.consume(DT * 10)).toBe(4);
    expect(acc.consume(0)).toBe(0);
  });
});
