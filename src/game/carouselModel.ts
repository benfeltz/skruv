// The manual's carousel (1.9.1.2, a band by orientation since 1.9.7.1.2), worked out
// headlessly: how many pages the band shows, how far its track may be pulled, how many pages
// a release moves, which page sits in each slot round the current one, and what a tap on a
// slot means. There are no arrows and no breakpoint: the band shows what its long side
// takes. The strip does not wrap — slots past either end of the booklet are empty. Pure: the
// band's DOM lives in src/ui/booklet.ts and only draws what this says. The caller passes the
// band's constants (BOOKLET_UI.strip, BOOKLET_UI.page.gutter), so a test can pass its own.

/** What the sizes below are made of: a slot's length along the band (a page's width on the bottom, its height down the right edge) and the gap between slots (CSS px). */
export interface StripSizes {
  slot: number;
  gap: number;
}

/** The distance between one slot's start and the next's along the band. */
export const pitch = ({ slot, gap }: StripSizes): number => slot + gap;

/**
 * How many pages the band shows along `extent` CSS px (its long side: the viewport's width in
 * portrait, its height in landscape): the largest odd count whose pitches fit inside a
 * `gutter` at each end, at least one. Odd, so one page is the centre.
 */
export function visibleCount(extent: number, strip: StripSizes, gutter: number): number {
  const fit = Math.floor((extent - 2 * gutter + strip.gap) / pitch(strip));
  return Math.max(1, fit % 2 === 0 ? fit - 1 : fit);
}

/**
 * How many slots to build so a drag of up to `reach` pages never shows empty paper: the visible
 * ones (`visibleCount`) and, at each end, enough more to fill the room the odd count leaves
 * beside them and the band's whole extent with the track `reach` pitches off centre. Odd.
 */
export function slotCount(extent: number, strip: StripSizes, gutter: number, reach: number): number {
  const step = pitch(strip);
  const shown = visibleCount(extent, strip, gutter);
  const spare = Math.max(0, extent - (shown * step - strip.gap)) / 2;
  return shown + 2 * Math.ceil(spare / step + reach);
}

/**
 * Where the track may be pulled to, in px along the band, from the current page `page` of
 * `count`: positive travel pulls toward earlier pages. No further than `reach` pages (what
 * `slotCount` built slots for), and the first and the last page may go no further than the
 * centre, so the band never shows past either end of the booklet.
 */
export function clampTravel(travel: number, page: number, count: number, step: number, reach: number): number {
  return Math.min(Math.min(page, reach) * step, Math.max(0 - Math.min(count - 1 - page, reach) * step, travel));
}

/** How many pages a release at `travel` moves, to the nearest page (half a pitch counts as a page): positive toward later pages, which a pull toward the start of the band (negative travel) reaches. */
export function snapSteps(travel: number, step: number): number {
  const pages = Math.round(Math.abs(travel) / step);
  return pages === 0 ? 0 : travel < 0 ? pages : -pages;
}

/**
 * Which side of the screen the band stands on in landscape, from the safe-area insets (CSS
 * px): the side without the notch — the larger inset is the notch's — and the right when
 * neither side has one.
 */
export const stripSide = (left: number, right: number): 'left' | 'right' => (right > left ? 'left' : 'right');

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
