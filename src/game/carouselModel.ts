// The manual's carousel (1.9.1.2, a band by orientation since 1.9.7.1.2), worked out
// headlessly: how many pages the band shows, how far its track may be pulled, how many pages
// a release moves, which page sits in each slot round the current one, and what a tap on a
// slot means. There are no arrows and no breakpoint: the band shows what its long side
// takes. The strip does not wrap — slots past either end of the booklet are empty. Pure: the
// band's DOM lives in src/ui/booklet.ts and only draws what this says. A fast release carries
// the pages on by its speed (`velocityOf`, `flickPages`) and a wheel steps one page per
// threshold, with a rest between steps (`wheelNext`). The caller passes the
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

/** The slot that holds the current page: the middle of `visible` slots. */
export const centreSlot = (visible: number): number => Math.floor(visible / 2);

/**
 * How far the track may sit off centre, in slots, from `page` of `count` with `visible` slots in
 * the band, so the band never shows empty paper: `max` puts the first page at the band's start,
 * `min` the last at its end. Positive is toward earlier pages, as `clampTravel` has it. A booklet
 * shorter than the band starts at the band's start.
 */
export function trackRange(page: number, count: number, visible: number): { min: number; max: number } {
  const side = centreSlot(visible);
  const max = page - side;
  const min = side - (count - 1 - page);
  return min > max ? { min: max, max } : { min, max };
}

/**
 * How many slots the track rests off centre so the band never shows an empty slot beside its
 * pages (Ben, 2026-10-18: no padding beside the strip): near the first page the pages slide
 * toward the start (negative), near the last toward the end (positive); between, 0, the current
 * page in the middle. A booklet shorter than the band starts at the band's start. The current
 * page keeps its gold border wherever it then sits.
 */
export function restShift(page: number, count: number, visible: number): number {
  const { min, max } = trackRange(page, count, visible);
  return Math.min(max, Math.max(min, 0));
}

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

/**
 * The slots of `built` whose span overlaps the band when the track sits `track` px off centre,
 * `slot` px long at a `step` pitch, in a band `extent` px long: the first and last index.
 */
export function slotsInView(track: number, built: number, step: number, slot: number, extent: number): { first: number; last: number } {
  const centre = centreSlot(built);
  const reach = (extent + slot) / 2;
  const first = Math.ceil((-reach - track) / step) + centre;
  const last = Math.floor((reach - track) / step) + centre;
  return { first: Math.max(0, first), last: Math.min(built - 1, last) };
}

/** The speed along the band, px/ms, from the earliest of `samples` within `windowMs` of the last to the last; 0 without two samples in the window or any time between them. */
export function velocityOf(samples: readonly { t: number; at: number }[], windowMs: number): number {
  const last = samples[samples.length - 1];
  const first = samples.find((sample) => last.t - sample.t <= windowMs);
  if (!last || !first || last.t === first.t) return 0;
  return (last.at - first.at) / (last.t - first.t);
}

/** How many pages past the nearest a release at `velocity` px/ms carries: negative (toward earlier pages) for a positive velocity, as `snapSteps` has it; 0 below the threshold. */
export function flickPages(velocity: number, flick: { velocity: number; maxPages: number }): number {
  const pages = Math.min(flick.maxPages, Math.floor(Math.abs(velocity) / flick.velocity));
  return pages === 0 ? 0 : velocity < 0 ? pages : -pages;
}

/** The wheel's delta along the band: the larger of the two axes (a mouse has only a vertical one), times `scale` for a line-mode wheel. */
export function wheelDelta({ deltaX, deltaY }: { deltaX: number; deltaY: number }, scale: number): number {
  return (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY) * scale;
}

/** What the wheel has gathered since the last step, and when that step was. */
export interface WheelState {
  acc: number;
  steppedAt: number;
}

export const WHEEL_REST: WheelState = { acc: 0, steppedAt: -Infinity };

/**
 * Takes one wheel `delta` at `now` ms: a step (+1 toward later pages for a positive delta) the
 * moment the gathered delta passes `threshold`, then none until `stepMs` have passed. A delta
 * the other way clears what was gathered.
 */
export function wheelNext(state: WheelState, delta: number, now: number, { threshold, stepMs }: { threshold: number; stepMs: number }): { state: WheelState; steps: -1 | 0 | 1 } {
  if (now - state.steppedAt < stepMs) return { state: { acc: 0, steppedAt: state.steppedAt }, steps: 0 };
  const acc = Math.sign(delta) === -Math.sign(state.acc) ? delta : state.acc + delta;
  if (Math.abs(acc) < threshold) return { state: { acc, steppedAt: state.steppedAt }, steps: 0 };
  return { state: { acc: 0, steppedAt: now }, steps: acc > 0 ? 1 : -1 };
}
