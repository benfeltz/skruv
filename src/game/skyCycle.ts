// The sky's day–night cycle: a phase in [0, 1) (0 midnight, 0.5 noon) and the colour it paints.
// Pure: imports constants only.

import { STAGE } from '../constants.js';

const SECONDS_PER_MINUTE = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = 3600;
const BYTE = 255;

/** A colour as `[r, g, b]`, each 0–1, in sRGB. */
export type Rgb = [number, number, number];

const channels = (hex: number): Rgb => [(hex >> 16) & BYTE, (hex >> 8) & BYTE, hex & BYTE].map((c) => c / BYTE) as Rgb;

// Sorted once; the first keyframe closes the loop at phase 1.
const KEYS = [...STAGE.sky.keyframes].sort((a, b) => a.at - b.at).map((k) => ({ at: k.at, rgb: channels(k.color) }));
const LOOP = [...KEYS, { at: 1, rgb: KEYS[0]!.rgb }];

/** The phase the wall clock says: local midnight 0, noon 0.5. */
export function phaseFromClock(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / MINUTES_PER_HOUR + date.getSeconds() / SECONDS_PER_HOUR;
  return hours / HOURS_PER_DAY;
}

/** `phase` moved on by `deltaSeconds` of a cycle that takes `cycleMinutes`, wrapped into [0, 1). */
export function advance(phase: number, deltaSeconds: number, cycleMinutes: number): number {
  const next = (phase + deltaSeconds / (cycleMinutes * SECONDS_PER_MINUTE)) % 1;
  return next < 0 ? next + 1 : next;
}

/** The sky at `phase`: the two keyframes round it, blended; written into `out` when given. */
export function skyColourAt(phase: number, out: Rgb = [0, 0, 0]): Rgb {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < LOOP.length - 2 && p >= LOOP[i + 1]!.at) i++;
  const from = LOOP[i]!;
  const to = LOOP[i + 1]!;
  const t = (p - from.at) / (to.at - from.at);
  for (let c = 0; c < 3; c++) out[c] = from.rgb[c]! + (to.rgb[c]! - from.rgb[c]!) * t;
  return out;
}
