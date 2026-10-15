// The catalog's item page, as numbers (1.9.1.1): where each line sits on the page, top to
// bottom — heavy rule, category heading, thin rule, the drawing's frame, the name line, a row
// per variant, the part count — all above the tag (CATALOG.page.action, the one source for where the
// tag is drawn and where it is tapped; the lines stack up from it). The drawing takes what the
// lines leave. Pure — src/scene/catalogPages.ts draws what this lays out.

import { BOOKLET, CATALOG } from '../constants.js';

/** A variant row: where its words sit and where the thin rule under it is (page pixels). */
export interface RowLayout {
  baseline: number;
  rule: number;
}

/** Where everything on an item page goes, in page pixels, for the page's `[width, height]` paper. */
export interface ItemPageLayout {
  left: number;
  right: number;
  /** The heavy rule's top edge. */
  heavyRule: number;
  headingBaseline: number;
  /** The thin rule's top edge, under the heading. */
  thinRule: number;
  /** The drawing's frame: `[x, y, w, h]`, clear of the swatch column at the right margin. */
  drawing: [number, number, number, number];
  /** Each swatch's centre, the first at the drawing's foot and the rest above it. */
  swatches: { x: number; y: number }[];
  nameBaseline: number;
  rows: RowLayout[];
  partCountBaseline: number;
}

/**
 * The item page for `variantCount` variant rows. The blocks are stacked from the tag up —
 * part count, rows, name line — and from the margin down — rule, heading, rule — and the
 * drawing is the gap between, beside the swatch column: more variants, a shorter drawing,
 * the tag untouched.
 */
export function itemPageLayout(variantCount: number): ItemPageLayout {
  const [pageW] = BOOKLET.pageSize;
  const m = BOOKLET.margin;
  const p = CATALOG.page;
  const [, tagTop] = p.action;

  // Down from the margin.
  const heavyRule = m;
  const headingBaseline = heavyRule + p.heavyRule + p.headingGap + p.headingSize * p.capHeight;
  const thinRule = headingBaseline + p.headingSize * p.descender + p.ruleGap;
  const drawingTop = thinRule + p.thinRule + p.lineGap;

  // Up from the tag.
  const partCountBaseline = tagTop - p.tagGap;
  const rowHeight = p.rowSize * p.rowHeight;
  const rowsBottom = partCountBaseline - p.detailSize * p.capHeight - p.countGap;
  const rowsTop = rowsBottom - variantCount * rowHeight;
  const rows = Array.from({ length: variantCount }, (_, i) => {
    const bottom = rowsTop + (i + 1) * rowHeight;
    return { baseline: bottom - (rowHeight - p.rowSize * p.capHeight) / 2, rule: bottom - p.thinRule };
  });
  const nameBaseline = rowsTop - p.lineGap - p.nameLineSize * p.descender;
  const drawingBottom = nameBaseline - p.nameLineSize * p.capHeight - p.lineGap;

  // The swatch column takes the right margin's side of the frame, so the drawing is fitted
  // beside it and never under it.
  const swatchStep = 2 * p.swatchRadius + p.swatchGap;
  const swatchX = pageW - m - p.swatchRadius;
  const swatches = Array.from({ length: variantCount }, (_, i) => ({ x: swatchX, y: drawingBottom - p.swatchRadius - i * swatchStep }));
  const drawingW = pageW - 2 * m - swatchStep;

  return {
    left: m,
    right: pageW - m,
    heavyRule,
    headingBaseline,
    thinRule,
    drawing: [m, drawingTop, drawingW, drawingBottom - drawingTop],
    swatches,
    nameBaseline,
    rows,
    partCountBaseline,
  };
}

/**
 * Where the tag's words go: centred between the punched hole's right edge and the tag's
 * right edge, `inset` clear on each side. `action` is `[x, y, w, h]` (CATALOG.page.action);
 * the hole sits at the middle of the tag's left `h`-square, `holeRadius` round.
 */
export function tagWords([x, , w, h]: readonly [number, number, number, number], holeRadius: number, inset: number) {
  const from = x + h / 2 + holeRadius + inset;
  const to = x + w - inset;
  return { centre: (from + to) / 2, width: to - from };
}

/** What a catalog page prints besides its content: its number (the cover is unnumbered) and which corner arrows it shows. */
export interface PageMarks {
  number: string | null;
  prev: boolean;
  next: boolean;
}

/** The marks for page `index` of `count`: numbered from the cover as page 1, so the first item page reads 2; no arrow where there is no page to turn to. */
export function pageMarks(index: number, count: number): PageMarks {
  return { number: index === 0 ? null : String(index + 1), prev: index > 0, next: index < count - 1 };
}

/**
 * The three points of an arrow's chevron, in page pixels: centred in `rect` (`[x, y, w, h]`,
 * CATALOG.page.prev / .next), pointing left for 'prev' and right for 'next'. The one source
 * for the drawn arrow in src/scene/catalogPages.ts and the cold-boot stand-in in index.html.
 */
export function arrowChevron([x, y, w, h]: readonly [number, number, number, number], direction: 'prev' | 'next'): [number, number][] {
  const { arrowHalfWidth: halfW, arrowHalfHeight: halfH } = CATALOG.page;
  const [cx, cy] = [x + w / 2, y + h / 2];
  const tip = direction === 'next' ? halfW : -halfW;
  return [
    [cx - tip, cy - halfH],
    [cx + tip, cy],
    [cx - tip, cy + halfH],
  ];
}
