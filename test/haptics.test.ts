import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { HAPTICS } from '../src/constants.js';
import { EVENT } from '../src/game/events.js';
import { createHaptics, CUE, cueFor, homeCue, patternFor } from '../src/game/haptics.js';
import type { Cue } from '../src/game/haptics.js';

// The haptics module (1.8.2.2 step 3): events to cues, cues to today's exact patterns, and
// the buzzer slot.

const defaults = { ...HAPTICS };
afterEach(() => Object.assign(HAPTICS, defaults));

describe('patternFor', () => {
  it("keeps today's exact patterns: a 10 ms seat, an [18, 60, 18] cam lock", () => {
    expect(patternFor(CUE.SEAT)).toBe(10);
    expect(patternFor(CUE.SEAT)).toBe(HAPTICS.seatMs);
    expect(patternFor(CUE.LOCK)).toEqual([18, 60, 18]);
  });

  it('buzzes a tool engaging as a seat, as a tool seating always has', () => {
    expect(patternFor(CUE.ENGAGE)).toBe(patternFor(CUE.SEAT));
  });

  it('plays the new tick and home knobs', () => {
    expect(patternFor(CUE.TICK)).toBe(HAPTICS.tickMs);
    expect(patternFor(CUE.HOME)).toBe(HAPTICS.homeMs);
  });

  it.each([
    ['seatMs', CUE.SEAT],
    ['seatMs', CUE.ENGAGE],
    ['lockMs', CUE.LOCK],
    ['tickMs', CUE.TICK],
    ['homeMs', CUE.HOME],
  ] as const)('a 0 ms %s silences %s', (knob, cue) => {
    HAPTICS[knob] = 0;
    expect(patternFor(cue)).toBeNull();
  });

  it('reads the knobs live', () => {
    HAPTICS.seatMs = 30;
    expect(patternFor(CUE.SEAT)).toBe(30);
  });
});

describe('cueFor', () => {
  it.each([
    [{ type: EVENT.SEAT, kind: KIND.DOWEL }, CUE.SEAT],
    [{ type: EVENT.SEAT, kind: KIND.BOLT }, CUE.SEAT],
    [{ type: EVENT.SEAT, kind: KIND.TOOL }, CUE.ENGAGE],
    [{ type: EVENT.FASTEN, kind: KIND.BOLT }, CUE.HOME],
    [{ type: EVENT.FASTEN, kind: KIND.CAM }, CUE.LOCK],
    [{ type: EVENT.FASTEN, kind: KIND.DOWEL }, null],
    [{ type: EVENT.UNFASTEN, kind: KIND.BOLT }, null],
    [{ type: EVENT.UNSEAT, kind: KIND.TOOL }, null],
    [{ type: EVENT.GRAB }, null],
  ])('%o buzzes %s', (event, cue) => {
    expect(cueFor(event)).toBe(cue);
  });
});

describe('homeCue', () => {
  it('buzzes a bolt back home as home and a cam as lock, as their FASTEN events do', () => {
    expect(homeCue(KIND.BOLT)).toBe(CUE.HOME);
    expect(homeCue(KIND.CAM)).toBe(CUE.LOCK);
    expect(homeCue(KIND.BOLT)).toBe(cueFor({ type: EVENT.FASTEN, kind: KIND.BOLT }));
    expect(homeCue(KIND.DOWEL)).toBeNull();
  });
});

describe('createHaptics', () => {
  it('sends cues to its buzzer, and setBuzzer swaps the receiver', () => {
    const first: Cue[] = [];
    const second: Cue[] = [];
    const haptics = createHaptics({ buzzer: (cue) => first.push(cue) });
    haptics.cue(CUE.SEAT);
    haptics.setBuzzer((cue) => second.push(cue));
    haptics.cue(CUE.TICK);
    expect(first).toEqual([CUE.SEAT]);
    expect(second).toEqual([CUE.TICK]);
  });
});

describe('src/game/haptics.ts', () => {
  it('is pure and never imports Capacitor', () => {
    // Code only: the header names what the default buzzer and a native shell use.
    const code = readFileSync(new URL('../src/game/haptics.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/from 'three'|rapier|document\.|window\.|navigator|capacitor/i);
  });
});
