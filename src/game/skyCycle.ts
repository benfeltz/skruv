// The sky's day–night cycle: a phase in [0, 1) (0 midnight, 0.5 noon) and the colour it paints.
// Pure: imports constants only.

import { CLOCK, STAGE } from '../constants.js';

/** A colour as `[r, g, b]`, each 0–1, in sRGB. */
export type Rgb = [number, number, number];

/** A keyframe as authored: the phase it sits at and its colour as hex. */
export interface Keyframe {
  at: number;
  color: number;
}

/** A keyframe ready to blend: its phase and colour channels. */
interface Stop {
  at: number;
  rgb: Rgb;
}

const SECONDS_PER_HOUR = CLOCK.minutesPerHour * CLOCK.secondsPerMinute;

/** A hex colour as `[r, g, b]` channels, each 0–1. */
export function hexToRgb(hex: number): Rgb {
  const { channelMax } = CLOCK;
  return [(hex >> 16) & channelMax, (hex >> 8) & channelMax, hex & channelMax].map((c) => c / channelMax) as Rgb;
}

/**
 * The keyframes as a closed loop of stops, sorted: the first closes the loop one cycle on. Throws on keyframes
 * outside [0, 1), on two at one phase, or on none — a blend between them would divide by zero.
 */
export function loopOf(keyframes: readonly Keyframe[]): Stop[] {
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) throw new Error('the sky needs at least one keyframe');
  sorted.forEach((k, i) => {
    if (!(k.at >= 0 && k.at < 1)) throw new Error(`sky keyframe at ${k.at} is outside [0, 1)`);
    if (i > 0 && k.at === sorted[i - 1]!.at) throw new Error(`two sky keyframes share phase ${k.at}`);
  });
  const stops = sorted.map((k) => ({ at: k.at, rgb: hexToRgb(k.color) }));
  return [...stops, { at: stops[0]!.at + 1, rgb: stops[0]!.rgb }];
}

const SKY_LOOP = loopOf(STAGE.sky.keyframes);

/** The phase the wall clock says: local midnight 0, noon 0.5. */
export function phaseFromClock(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / CLOCK.minutesPerHour + date.getSeconds() / SECONDS_PER_HOUR;
  return hours / CLOCK.hoursPerDay;
}

/** `phase` moved on by `deltaSeconds` of a cycle that takes `cycleMinutes`, wrapped into [0, 1). */
export function advance(phase: number, deltaSeconds: number, cycleMinutes: number): number {
  const next = (phase + deltaSeconds / (cycleMinutes * CLOCK.secondsPerMinute)) % 1;
  return next < 0 ? next + 1 : next;
}

/** The sky at `phase`: the two stops round it, blended; written into `out` when given. */
export function skyColourAt(phase: number, out: Rgb = [0, 0, 0], loop: readonly Stop[] = SKY_LOOP): Rgb {
  const wrapped = phase % 1 < 0 ? (phase % 1) + 1 : phase % 1;
  // Before the first keyframe the colour is still blending in from the last, one cycle back.
  const p = wrapped < loop[0]!.at ? wrapped + 1 : wrapped;
  let i = 0;
  while (i < loop.length - 2 && p >= loop[i + 1]!.at) i++;
  const from = loop[i]!;
  const to = loop[i + 1]!;
  const t = (p - from.at) / (to.at - from.at);
  for (let c = 0; c < 3; c++) out[c] = from.rgb[c]! + (to.rgb[c]! - from.rgb[c]!) * t;
  return out;
}
