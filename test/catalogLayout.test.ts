import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOKLET, CATALOG } from '../src/constants.js';
import { arrowChevron, itemPageLayout, pageMarks, tagWords } from '../src/game/catalogLayout.js';

// The item page's lines (1.9.1.1), headless: in order, all above the unmoved tag, with room
// left for the drawing. How the drawing reads on a phone is a manual check.

const [pageW, pageH] = BOOKLET.pageSize;
const m = BOOKLET.margin;
const [, tagTop] = CATALOG.page.action;

describe.each([1, 2])('the item page with %i variant row(s)', (count) => {
  const layout = itemPageLayout(count);

  it('stacks heavy rule, heading, thin rule, drawing, name, rows and part count in reading order', () => {
    const [, drawingTop, , drawingH] = layout.drawing;
    const rowBaselines = layout.rows.map((r) => r.baseline);
    const order = [layout.heavyRule, layout.headingBaseline, layout.thinRule, drawingTop, drawingTop + drawingH, layout.nameBaseline, ...rowBaselines, layout.partCountBaseline];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(layout.rows).toHaveLength(count);
    for (const { baseline, rule } of layout.rows) expect(rule).toBeGreaterThan(baseline);
  });

  it('keeps every line above the tag', () => {
    const [, drawingTop, , drawingH] = layout.drawing;
    expect(layout.partCountBaseline).toBeLessThan(tagTop);
    expect(drawingTop + drawingH).toBeLessThan(tagTop);
    for (const { rule } of layout.rows) expect(rule).toBeLessThan(tagTop);
  });

  it('leaves the drawing at least half the page height less its margins', () => {
    const [, , , drawingH] = layout.drawing;
    expect(drawingH).toBeGreaterThanOrEqual(pageH / 2 - 2 * m);
  });

  it('stays inside the side margins, the drawing clear of the swatch column', () => {
    const [x, , w] = layout.drawing;
    const { swatchRadius } = CATALOG.page;
    expect([layout.left, layout.right, x]).toEqual([m, pageW - m, m]);
    expect(layout.swatches).toHaveLength(count);
    for (const swatch of layout.swatches) {
      expect(x + w).toBeLessThanOrEqual(swatch.x - swatchRadius);
      expect(swatch.x + swatchRadius).toBeLessThanOrEqual(pageW - m);
    }
  });

  it('stacks the swatches up from the drawing\'s foot without overlap', () => {
    const [, y, , h] = layout.drawing;
    const { swatchRadius } = CATALOG.page;
    expect(layout.swatches[0].y + swatchRadius).toBeCloseTo(y + h);
    layout.swatches.slice(1).forEach(({ y: above }, i) => expect(layout.swatches[i].y - above).toBeGreaterThan(2 * swatchRadius));
  });
});

describe('the most variants the schema admits', () => {
  const schema = JSON.parse(readFileSync(new URL('../tools/validate/flatpack.schema.json', import.meta.url), 'utf8'));
  const most: number = schema.properties.identity.properties.variants.maxItems;

  it('still leaves the drawing room, its frame clear of the heading rule', () => {
    const at = itemPageLayout(most);
    const [, drawingTop, , drawingH] = at.drawing;
    expect(drawingTop).toBeGreaterThan(at.thinRule);
    expect(drawingH).toBeGreaterThan(0);
    expect(drawingTop + drawingH).toBeLessThan(at.nameBaseline);
  });
});

describe('the part count', () => {
  it('keeps clear space from the rows above it and from the tag below it', () => {
    const { detailSize, capHeight, countGap, tagGap } = CATALOG.page;
    const at = itemPageLayout(2);
    const lastRule = at.rows[1].rule + CATALOG.page.thinRule;
    expect(at.partCountBaseline - detailSize * capHeight - lastRule).toBeGreaterThanOrEqual(countGap);
    expect(tagTop - at.partCountBaseline).toBeGreaterThanOrEqual(tagGap);
  });
});

describe('a second variant row', () => {
  it('takes its height from the drawing, never from the tag', () => {
    const one = itemPageLayout(1);
    const two = itemPageLayout(2);
    expect(two.partCountBaseline).toBe(one.partCountBaseline);
    expect(two.drawing[1]).toBe(one.drawing[1]);
    expect(two.drawing[3]).toBeLessThan(one.drawing[3]);
  });
});

describe('the tag', () => {
  const [x, , w, h] = CATALOG.page.action;
  const { tagHole, tagInset } = CATALOG.page;

  it('stays centred on the page and inside the margins', () => {
    expect(x + w / 2).toBe(pageW / 2);
    expect(x).toBeGreaterThanOrEqual(m);
    expect(x + w).toBeLessThanOrEqual(pageW - m);
  });

  it('centres its words between the hole and the right edge, the same clear space each side', () => {
    const { centre, width } = tagWords(CATALOG.page.action, tagHole, tagInset);
    const holeRight = x + h / 2 + tagHole;
    expect(centre - width / 2 - holeRight).toBeCloseTo(tagInset);
    expect(x + w - (centre + width / 2)).toBeCloseTo(tagInset);
  });

  it('gives OWN IT NOW! room at its natural width: the type size times a heavy cap run stays under the space', () => {
    const { width } = tagWords(CATALOG.page.action, tagHole, tagInset);
    // 11 glyphs at a generous 0.75 em each, the widest a heavy sans caps run is likely to be.
    expect(CATALOG.words.build.length * 0.75 * CATALOG.page.actionTextSize).toBeLessThanOrEqual(width);
  });
});

// 1.9.1.5: the number and corner arrows every catalog page prints.
describe('pageMarks', () => {
  it('leaves the cover unnumbered, with only a next arrow', () => {
    expect(pageMarks(0, 4)).toEqual({ number: null, prev: false, next: true });
  });

  it('numbers item pages from 2 and gives a middle page both arrows', () => {
    expect(pageMarks(1, 4)).toEqual({ number: '2', prev: true, next: true });
    expect(pageMarks(2, 4)).toEqual({ number: '3', prev: true, next: true });
  });

  it('drops the next arrow on the last page', () => {
    expect(pageMarks(3, 4)).toEqual({ number: '4', prev: true, next: false });
  });
});

describe('the corner arrows and page number', () => {
  const { prev, next, action, pageNumberSize, pageNumberFoot } = CATALOG.page;
  const overlaps = ([ax, ay, aw, ah]: readonly number[], [bx, by, bw, bh]: readonly number[]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;

  it.each([
    ['prev', prev],
    ['next', next],
  ])('keeps the %s rect inside the page margins and at least 88 page px square (44 CSS px at half scale)', (_, [x, y, w, h]) => {
    expect(x).toBeGreaterThanOrEqual(m);
    expect(x + w).toBeLessThanOrEqual(pageW - m);
    expect(y + h).toBeLessThanOrEqual(pageH - m);
    expect(Math.min(w, h)).toBeGreaterThanOrEqual(88);
  });

  it('puts ‹ in the lower left and › in the lower right, level with the tag, and overlaps neither the tag nor the part count', () => {
    expect(prev[0] + prev[2]).toBeLessThan(pageW / 2);
    expect(next[0]).toBeGreaterThan(pageW / 2);
    expect(prev[1]).toBe(next[1]);
    expect(overlaps(prev, action)).toBe(false);
    expect(overlaps(next, action)).toBe(false);
    const { partCountBaseline } = itemPageLayout(1);
    expect(partCountBaseline).toBeLessThan(prev[1]);
  });

  it('prints the number in the margin under the tag, centred', () => {
    const baseline = pageH - pageNumberFoot;
    expect(baseline - pageNumberSize * CATALOG.page.capHeight).toBeGreaterThan(action[1] + action[3]);
    expect(baseline).toBeLessThan(pageH);
  });

  it('draws each chevron inside its rect, pointing away from the page it leaves', () => {
    for (const [rect, direction] of [[prev, 'prev'], [next, 'next']] as const) {
      const points = arrowChevron(rect, direction);
      const [x, y, w, h] = rect;
      for (const [px, py] of points) {
        expect(px).toBeGreaterThan(x);
        expect(px).toBeLessThan(x + w);
        expect(py).toBeGreaterThan(y);
        expect(py).toBeLessThan(y + h);
      }
      // The tip is the middle point: left of the ends for ‹, right of them for ›.
      const [first, tip] = points;
      expect(Math.sign(tip[0] - first[0])).toBe(direction === 'next' ? 1 : -1);
    }
  });
});
