import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI, CATALOG, COLORS } from '../src/constants.js';
import { catalogEntries, createCatalog } from '../src/game/catalogModel.js';
import { pickableSet } from '../src/game/pickable.js';
import { ITEM_IDS } from '../src/game/item.js';

// 1.6.1, re-pinned for 1.9.1 (the catalog is the splash): index.html's pre-splash is plain
// CSS, so it can't import the constants the real catalog sheet is built from — these checks
// keep the two from drifting, or the handoff would visibly jump. The handoff itself is a
// manual device check.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const main = read('src/main.ts');
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;

describe('pre-splash: the catalog cover (1.6.1, 1.9.1)', () => {
  it('sits where the open sheet sits, at its size', () => {
    expect(html).toMatch(new RegExp(`width: min\\(100vw, ${BOOKLET_UI.maxWidth}px\\);`));
    expect(html).toMatch(new RegExp(`max-height: ${BOOKLET_UI.maxHeight * 100}dvh;`));
    expect(html).toMatch(
      new RegExp(`width: min\\(100%, ${pageW}px, calc\\(\\(${BOOKLET_UI.maxHeight * 100}dvh - ${BOOKLET_UI.chromeHeight}px\\) \\* ${pageW} / ${pageH}\\)\\);`),
    );
    expect(html).toMatch(new RegExp(`aspect-ratio: ${pageW} / ${pageH};`));
  });

  it("draws in the sheet's and the page's colours", () => {
    expect(html).toMatch(new RegExp(`background: ${css(COLORS.uiSurface)};`));
    expect(html).toMatch(new RegExp(`color: ${css(COLORS.uiText)};`));
    expect(html).toMatch(new RegExp(`background: ${css(COLORS.bookletPaper)};`));
    expect(html).toMatch(new RegExp(`fill="${css(COLORS.bookletInk)}"`));
  });

  // As src/scene/catalogPages.ts draws the cover: SKRUV, then the tagline under it.
  it("prints the catalog cover's wordmark in the page's own coordinates and font", () => {
    const m = BOOKLET.margin;
    const { wordmarkSize, taglineSize, baseline: share, subtitleDrop, taglineIndent } = CATALOG.page;
    const baseline = m + wordmarkSize * share;
    expect(html).toContain(`viewBox="0 0 ${pageW} ${pageH}"`);
    expect(html).toContain(`font-family='${BOOKLET.font}'`);
    expect(html).toContain(`<text x="${m}" y="${baseline}" font-size="${wordmarkSize}" font-weight="800">${CATALOG.words.brand}</text>`);
    expect(html).toContain(
      `<text x="${m + taglineIndent}" y="${baseline + taglineSize * subtitleDrop}" font-size="${taglineSize}" font-weight="600">${CATALOG.words.tagline}</text>`,
    );
  });

  // The catalog as the sheet counts it: the cover and a page per item.
  it("counts the catalog's real pages", () => {
    const count = createCatalog(catalogEntries(), pickableSet(CATALOG.pickable, ITEM_IDS)).length;
    expect(html).toContain(`<span class="pre-splash-count">1 / ${count}</span>`);
  });

  // main mounts the catalog sheet at boot and removes the stand-in after.
  it('is removed in the frame that first paints the real catalog, once that sheet is mounted', () => {
    const mount = main.indexOf('document.body.append(catalog.scrim, catalog.thumb, catalog.element);');
    const remove = main.indexOf("requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());");
    expect(mount).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(mount);
  });

  // BUILD IT's hit target is placed in page fractions of the frame round the catalog's
  // canvas, so the frame must be exactly the page: the same fit as the pre-splash page.
  it("sizes the catalog's page frame by the page's own fit, so BUILD IT lands on the drawn tag", () => {
    const booklet = read('src/ui/booklet.ts');
    const frame = booklet.slice(booklet.indexOf('.booklet-frame {'), booklet.indexOf('.booklet-frame canvas'));
    expect(frame).toContain('width: min(100%, ${pageW}px, calc((${BOOKLET_UI.maxHeight * 100}dvh - ${BOOKLET_UI.chromeHeight}px) * ${pageW} / ${pageH}));');
    expect(frame).toContain('aspect-ratio: ${pageW} / ${pageH};');
    expect(booklet).toMatch(/\.booklet-frame canvas \{ width: 100%; height: 100%; max-height: none; \}/);
  });

  it('takes no input — the scrim and the real sheet own every touch', () => {
    expect(html).toMatch(/\.pre-splash \{[^}]*pointer-events: none;/);
  });
});
