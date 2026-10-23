import type { FAN } from '../constants.js';

// The manual fan's model (1.9.9.3): every world's manual in a stable order, the active one on top,
// and where each cover sits, folded and spread. Pure: src/ui/manualFan.ts applies the numbers.

type Fan = typeof FAN;

/** Where one cover sits in the row: its offset along the row (CSS px) and its lean (degrees). */
export interface CoverPlace {
  x: number;
  angle: number;
}

/**
 * The covers' order in the row: those already in it keep their places, the ones the room no longer
 * holds drop out, a new one joins at the end. A pick never re-arranges the others; only which cover
 * is on top changes (`coverDepth`).
 */
export function fanOrder(previous: readonly string[], ids: readonly string[]): string[] {
  return [...previous.filter((id) => ids.includes(id)), ...ids.filter((id) => !previous.includes(id))];
}

/** A cover's stacking depth: the active one on top of the rest, the others as they lie, later over earlier. */
export function coverDepth(index: number, count: number, activeIndex: number): number {
  return index === activeIndex ? count : index;
}

/**
 * Each cover's place. Folded, the covers step along by `step` and lean `tilt` alternately from the
 * first, so the stack reads as a fan, a lone cover lying flat; spread, they lie a pitch apart, upright.
 */
export function fanLayout(count: number, spread: boolean, fan: Fan): CoverPlace[] {
  return Array.from({ length: count }, (_, i) => {
    if (spread) return { x: i * (fan.cover + fan.gap), angle: 0 };
    return { x: i * fan.step, angle: count === 1 ? 0 : (i % 2 === 0 ? -fan.tilt : fan.tilt) };
  });
}

/** The row's width, folded or spread. */
export function fanWidth(count: number, spread: boolean, fan: Fan): number {
  if (count <= 0) return 0;
  return spread ? count * fan.cover + (count - 1) * fan.gap : fan.cover + (count - 1) * fan.step;
}

/** True when the spread row is wider than the box it lies in, so it scrolls sideways. */
export function overflows(count: number, boxWidth: number, fan: Fan): boolean {
  return fanWidth(count, true, fan) > boxWidth;
}

/** The fan's accessible name. */
export function fanLabel(count: number): string {
  return `Switch item: ${count} ${count === 1 ? 'manual' : 'manuals'}`;
}
