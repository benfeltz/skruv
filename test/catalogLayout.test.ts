import { readFileSync } from 'node:fs';
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

describe('a second variant row', () => {
  it('takes its height from the drawing, never from the tag', () => {
    const one = itemPageLayout(1);
    const two = itemPageLayout(2);
    expect(two.partCountBaseline).toBe(one.partCountBaseline);
    expect(two.drawing[1]).toBe(one.drawing[1]);
    expect(two.drawing[3]).toBeLessThan(one.drawing[3]);
  });
});
