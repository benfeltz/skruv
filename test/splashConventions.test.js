import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI, COLORS } from '../src/constants.js';
import { IDENTITY, MANUAL } from '../src/game/item.js';

// 1.6.1: index.html's pre-splash is plain CSS, so it can't import the constants the real
// booklet sheet is built from — these checks keep the two from drifting, or the handoff
// would visibly jump. The handoff itself is a manual device check.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const main = read('src/main.js');
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;

describe('pre-splash (1.6.1)', () => {
  it('sits where the open sheet sits, at its size', () => {
    expect(html).toMatch(new RegExp(`width: min\\(100vw, ${BOOKLET_UI.maxWidth}px\\);`));
    expect(html).toMatch(new RegExp(`max-height: ${BOOKLET_UI.maxHeight * 100}dvh;`));
    expect(html).toMatch(
      new RegExp(`width: min\\(100%, ${pageW}px, calc\\(\\(${BOOKLET_UI.maxHeight * 100}dvh - 120px\\) \\* ${pageW} / ${pageH}\\)\\);`),
    );
    expect(html).toMatch(new RegExp(`aspect-ratio: ${pageW} / ${pageH};`));
  });

  it("draws in the sheet's and the page's colours", () => {
    expect(html).toMatch(new RegExp(`background: ${css(COLORS.uiSurface)};`));
    expect(html).toMatch(new RegExp(`color: ${css(COLORS.uiText)};`));
    expect(html).toMatch(new RegExp(`background: ${css(COLORS.bookletPaper)};`));
    expect(html).toMatch(new RegExp(`fill="${css(COLORS.bookletInk)}"`));
  });

  it("prints the cover's wordmark in the page's own coordinates and font", () => {
    expect(html).toContain(`viewBox="0 0 ${pageW} ${pageH}"`);
    expect(html).toContain(`font-family='${BOOKLET.font}'`);
    expect(html).toMatch(new RegExp(`>${IDENTITY.product}</text>`));
    expect(html).toMatch(new RegExp(`>${IDENTITY.maker}</text>`));
  });

  it("counts the booklet's real pages", () => {
    expect(html).toContain(`<span class="pre-splash-count">1 / ${MANUAL.pages.length}</span>`);
  });

  it("is removed in the frame that first paints the real sheet, once that sheet is mounted", () => {
    const mount = main.indexOf('document.body.append(booklet.scrim, booklet.thumb, booklet.element);');
    const remove = main.indexOf("requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());");
    expect(mount).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(mount);
  });

  it('takes no input — the scrim and the real sheet own every touch', () => {
    expect(html).toMatch(/\.pre-splash \{[^}]*pointer-events: none;/);
  });
});
