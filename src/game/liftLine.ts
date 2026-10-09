// Elevation-line math (src/ui/liftLine.ts, src/scene/liftHold.ts). Pure: heights in metres,
// fractions 0 (floor) to 1 (ceiling), screen positions in CSS px.

import { GESTURE, ROOM } from '../constants.js';
import { clampLift } from './dragMath.js';

/** A part's centre-height range [min, max]: resting on the floor up to the lift ceiling. */
export type LiftRange = [number, number];

/** The lift range for a part of half-height `halfHeight` — clampLift's own bounds. */
export function liftRange(halfHeight: number): LiftRange {
  const at = (y: number) => clampLift(y, halfHeight, ROOM, GESTURE.ceilingMargin);
  return [at(-Infinity), at(Infinity)];
}

const unit = (t: number) => Math.min(1, Math.max(0, t));

/** Where `height` sits on the line, 0..1; a part too tall to lift reads 0. */
export function fractionOf(height: number, [min, max]: LiftRange) {
  return max > min ? unit((height - min) / (max - min)) : 0;
}

/** The height a line fraction stands for, the fraction clamped to 0..1. */
export function heightAt(fraction: number, [min, max]: LiftRange) {
  return min + unit(fraction) * (max - min);
}

/**
 * `current` eased toward `target` over `delta` seconds at `rate` (1/s) — the exponential
 * law easeToward uses, so it feels the same at any frame rate.
 */
export function easeHeight(current: number, target: number, rate: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-rate * delta));
}

/** True when a press at screen y `pointerY` lands on the knob drawn at `knobY`. */
export function pressOnKnob(pointerY: number, knobY: number, radius: number) {
  return Math.abs(pointerY - knobY) <= radius;
}

/**
 * Whether a tap on `tapped` (null: empty space) may change the selection while the line
 * holds `held`. Taps switch what the free hand does to the held part — empty space puts its
 * rings away so a drag moves it, the part itself brings them back to turn it — but never
 * pick another part.
 */
export function selectsDuringHold<T>(tapped: T | null, held: T | null) {
  return held === null || tapped === null || tapped === held;
}
