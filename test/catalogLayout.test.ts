import { describe, expect, it } from 'vitest';
import { BOOKLET, CATALOG } from '../src/constants.js';
import { itemPageLayout } from '../src/game/catalogLayout.js';

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

  it('keeps every line above the tag and the tag where it was', () => {
    const [, drawingTop, , drawingH] = layout.drawing;
    expect(layout.partCountBaseline).toBeLessThan(tagTop);
    expect(drawingTop + drawingH).toBeLessThan(tagTop);
    for (const { rule } of layout.rows) expect(rule).toBeLessThan(tagTop);
    expect(CATALOG.page.action).toEqual([180, 770, 360, 104]);
  });

  it('leaves the drawing at least half the page height less its margins', () => {
    const [, , , drawingH] = layout.drawing;
    expect(drawingH).toBeGreaterThanOrEqual(pageH / 2 - 2 * m);
  });

  it('stays inside the side margins', () => {
    const [x, , w] = layout.drawing;
    expect([layout.left, layout.right, x, x + w]).toEqual([m, pageW - m, m, pageW - m]);
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
