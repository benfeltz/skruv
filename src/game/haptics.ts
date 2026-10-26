// Haptic moments: which game event buzzes as which named cue, and the buzzer slot the cues
// go to. Pure — events in, cue names out; the buzzer is injected. The web build's default
// buzzer (src/main.ts) plays `patternFor(cue)` through navigator.vibrate; a native shell
// swaps in its own with `setBuzzer`, mapping cues to its impact styles (`nativeFor`) — cues,
// never millisecond patterns, cross that seam.

import { HAPTICS, type NativeStyle } from '../constants.js';
import { KIND } from '../../tools/validate/lib/vocabulary.js';
import { EVENT } from './events.js';

export const CUE = Object.freeze({
  SEAT: 'seat',
  ENGAGE: 'engage',
  TICK: 'tick',
  HOME: 'home',
  LOCK: 'lock',
});

export type Cue = (typeof CUE)[keyof typeof CUE];

/** What receives the cues: the browser's vibration by default, a native shell's otherwise. */
export type Buzzer = (cue: Cue) => void;

/**
 * The cue a bus event buzzes, or null: a part seating buzzes `seat`, a tool seating on a
 * head or slot `engage`; a bolt screwed home `home`, a cam lock locking `lock`. The ratchet
 * tick is no event — the router reports it (`onRatchet`), as it does a fastener backed off
 * partway and turned home again (`onRehome`, buzzing `homeCue`)., and a drawer reaching
 * either end of its runners (`onSlideEnd`, buzzing `seat`).
 */
export function cueFor(event: { type: string; kind?: unknown }): Cue | null {
  if (event.type === EVENT.SEAT) return event.kind === KIND.TOOL ? CUE.ENGAGE : CUE.SEAT;
  if (event.type === EVENT.FASTEN) return homeCue(event.kind);
  return null;
}

/** The cue a turned fastener of `kind` buzzes arriving home: a bolt, stud or screw `home`, a cam `lock`; else null. */
export function homeCue(kind: unknown): Cue | null {
  if (kind === KIND.BOLT || kind === KIND.STUD || kind === KIND.SCREW) return CUE.HOME;
  if (kind === KIND.CAM) return CUE.LOCK;
  return null;
}

/**
 * The vibration pattern (ms) a cue plays on the web, read from HAPTICS at call time so a
 * ?tune change applies at once; null when its knob is 0 (off). A tool engaging buzzes as a
 * seat does.
 */
export function patternFor(cue: Cue): number | number[] | null {
  switch (cue) {
    case CUE.SEAT:
    case CUE.ENGAGE:
      return HAPTICS.seatMs > 0 ? HAPTICS.seatMs : null;
    case CUE.TICK:
      return HAPTICS.tickMs > 0 ? HAPTICS.tickMs : null;
    case CUE.HOME:
      return HAPTICS.homeMs > 0 ? HAPTICS.homeMs : null;
    case CUE.LOCK:
      return HAPTICS.lockMs > 0 ? [HAPTICS.lockMs, HAPTICS.lockGapMs, HAPTICS.lockMs] : null;
    default:
      return null;
  }
}

/**
 * The native style a cue plays in the shell (HAPTICS.native), or null when its knob is 0 —
 * off on native as on the web.
 */
export function nativeFor(cue: Cue): NativeStyle | null {
  return patternFor(cue) === null ? null : HAPTICS.native[cue];
}

/** The buzzer slot: `cue(name)` buzzes through whichever buzzer `setBuzzer` last plugged in. */
export function createHaptics({ buzzer }: { buzzer: Buzzer }) {
  let current = buzzer;
  return {
    cue(name: Cue) {
      current(name);
    },
    setBuzzer(next: Buzzer) {
      current = next;
    },
  };
}

export type Haptics = ReturnType<typeof createHaptics>;
