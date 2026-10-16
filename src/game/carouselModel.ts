import { BOOKLET_UI } from '../constants.js';

// The manual's carousel (1.9.1.2), worked out headlessly: how many pages the strip shows,
// which page sits in each slot round the current one, and what a tap on a slot means. The
// strip does not wrap — slots past either end of the booklet are empty. Pure: the strip's
// DOM lives in src/ui/booklet.ts and only draws what this says.

/** How many pages the strip shows at this viewport width (CSS px): the narrow count below the breakpoint, the wide count at or above it. */
export function visibleCount(viewportWidth: number): number {
  const { breakpoint, narrow, wide } = BOOKLET_UI.strip;
  return viewportWidth >= breakpoint ? wide : narrow;
}

/** The slot that holds the current page: the middle of `visible` slots. */
export const centreSlot = (visible: number): number => Math.floor(visible / 2);

/**
 * The page index in each of `visible` slots, with `page` in the centre slot; a slot past
 * either end of a `count`-page booklet is null.
 */
export function windowOf(page: number, count: number, visible: number): (number | null)[] {
  const centre = centreSlot(visible);
  return Array.from({ length: visible }, (_, slot) => {
    const index = page + slot - centre;
    return index >= 0 && index < count ? index : null;
  });
}

/** What a tap on `slot` of `slots` (a `windowOf`) means: 'centre', the page to move to, or null for an empty slot. */
export function tapOn(slots: readonly (number | null)[], slot: number): 'centre' | number | null {
  if (slot === centreSlot(slots.length)) return 'centre';
  return slots[slot] ?? null;
}
