import { describe, expect, it } from 'vitest';
import { FASTENER } from '../src/constants.js';
import { createCrank, tightenSign } from '../src/game/crankMath.js';

const DEG = Math.PI / 180;
const C = [0, 0];
const onCircle = (deg, r = 50, [cx, cy] = C) => [cx + r * Math.cos(deg * DEG), cy - r * Math.sin(deg * DEG)];

describe('createCrank', () => {
  it('counts a clockwise sweep on screen as positive', () => {
    const crank = createCrank();
    crank.move(C, onCircle(0));
    expect(crank.move(C, onCircle(-90))).toBeCloseTo(90 * DEG);
  });

  it('counts a counter-clockwise sweep as negative', () => {
    const crank = createCrank();
    crank.move(C, onCircle(0));
    expect(crank.move(C, onCircle(60))).toBeCloseTo(-60 * DEG);
  });

  it('primes on the first point, emitting nothing', () => {
    expect(createCrank().move(C, onCircle(30))).toBe(0);
  });

  it('accumulates past a full turn, wrap-around safe at ±π', () => {
    const crank = createCrank();
    for (let deg = 0; deg >= -720; deg -= 30) crank.move(C, onCircle(deg));
    expect(crank.total).toBeCloseTo(720 * DEG);
    // Straddling the ±180° seam goes the short way round.
    const seam = createCrank();
    seam.move(C, onCircle(170));
    expect(seam.move(C, onCircle(-170))).toBeCloseTo(-20 * DEG);
  });

  it('measures each step about the centre given with it', () => {
    const crank = createCrank();
    crank.move(C, [50, 0]);
    // The centre moved under the finger: [50, 0] is now straight above it and [100, 50]
    // straight right — a quarter turn clockwise about the new centre (26.6° about the old).
    expect(crank.move([50, 50], [100, 50])).toBeCloseTo(90 * DEG);
  });

  it('drops motion inside the deadzone and resumes cleanly outside it', () => {
    const crank = createCrank();
    crank.move(C, onCircle(0));
    expect(crank.move(C, [FASTENER.crankDeadzone / 2, 0])).toBe(0);
    expect(crank.move(C, onCircle(-90))).toBe(0); // re-primes after the deadzone
    expect(crank.move(C, onCircle(-120))).toBeCloseTo(30 * DEG);
  });
});

describe('tightenSign', () => {
  it('is +1 viewing along the into-hole direction, −1 from behind', () => {
    expect(tightenSign([0, 0, -1], [0, -0.3, -1])).toBe(1);
    expect(tightenSign([0, 0, -1], [0, 0, 1])).toBe(-1);
  });
});
