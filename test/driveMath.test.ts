import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FASTENER } from '../src/constants.js';
import { driveRadians, ratchetTicks } from '../src/game/driveMath.js';

// Hold-to-drive and ratchet maths (1.8.2.2 step 2).

const FRAME = 1 / 60;

// Frames of driving `span` for `seconds`, summed; and how many frames it took.
function drive(span: number, seconds: number) {
  let turned = 0;
  let frames = 0;
  while (turned < span - 1e-9) {
    turned = Math.min(span, turned + driveRadians(span, FASTENER.driveSeconds, FRAME));
    frames++;
    if (frames * FRAME > seconds + FRAME) break;
  }
  return { turned, frames };
}

describe('driveRadians', () => {
  it("drives a bolt's two turns home over driveSeconds of frames", () => {
    const { turned, frames } = drive(FASTENER.screwRadians, FASTENER.driveSeconds);
    expect(turned).toBeCloseTo(FASTENER.screwRadians, 9);
    expect(frames).toBe(Math.round(FASTENER.driveSeconds / FRAME));
  });

  it("drives a cam's quarter turn in the same time", () => {
    const { turned, frames } = drive(FASTENER.quarterTurn, FASTENER.driveSeconds);
    expect(turned).toBeCloseTo(FASTENER.quarterTurn, 9);
    expect(frames).toBe(Math.round(FASTENER.driveSeconds / FRAME));
  });

  it('is framerate-independent', () => {
    expect(driveRadians(1, 2, 0.5)).toBe(0.25);
    expect(driveRadians(1, 2, 0.25) * 2).toBe(driveRadians(1, 2, 0.5));
  });
});

describe('ratchetTicks', () => {
  const step = FASTENER.ratchetRadians;

  it("clicks 16 times over a bolt's two turns and twice over a cam's quarter turn", () => {
    expect(ratchetTicks(0, 4 * Math.PI, step)).toBe(16);
    expect(ratchetTicks(0, Math.PI / 2, step)).toBe(2);
  });

  it('counts the same however the turn is sliced into frames', () => {
    let ticks = 0;
    let at = 0;
    const span = FASTENER.screwRadians;
    while (at < span) {
      const next = Math.min(span, at + driveRadians(span, FASTENER.driveSeconds, FRAME));
      ticks += ratchetTicks(at, next, step);
      at = next;
    }
    expect(ticks).toBe(16);
  });

  it('never clicks for a turn that crosses no boundary', () => {
    expect(ratchetTicks(0.1, 0.2, step)).toBe(0);
    expect(ratchetTicks(step + 0.01, 2 * step - 0.01, step)).toBe(0);
  });

  it('clicks loosening too', () => {
    expect(ratchetTicks(4 * Math.PI, 0, step)).toBe(16);
    expect(ratchetTicks(2 * step + 0.01, step - 0.01, step)).toBe(2);
  });
});

describe('src/game/driveMath.ts', () => {
  it('is pure: no Three, Rapier or DOM', () => {
    const source = readFileSync(new URL('../src/game/driveMath.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from 'three'|rapier|document\.|window\./);
  });
});
