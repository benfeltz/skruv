import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI, CATALOG, COLORS } from '../src/constants.js';
import { arrowChevron } from '../src/game/catalogLayout.js';

// 1.6.1, re-pinned for 1.9.1 (the catalog is the splash) and 1.9.1.5 (its page look):
// index.html's pre-splash is plain CSS, so it can't import the constants the real catalog
// sheet is built from — these checks keep the two from drifting, or the handoff would
// visibly jump. The handoff itself is a manual device check.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const main = read('src/main.ts');
const booklet = read('src/ui/booklet.ts');
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;
const { gutter, shadow, radius } = BOOKLET_UI.page;
// The page look's width, as booklet.ts's `.booklet-leaf` and index.html's `.pre-splash` both write it.
const FIT = `width: min(calc(100vw - ${2 * gutter}px), ${pageW}px, calc(${BOOKLET_UI.maxHeight * 100}dvh * ${pageW} / ${pageH}));`;

describe('pre-splash: the catalog cover (1.6.1, 1.9.1, 1.9.1.5)', () => {
  it("sits where the catalog's open page sits — centred over the room, at its fit", () => {
    const rule = html.slice(html.indexOf('.pre-splash {'), html.indexOf('}', html.indexOf('.pre-splash {')));
    expect(rule).toContain('left: 50%;');
    expect(rule).toContain('top: 50%;');
    expect(rule).toContain('transform: translate(-50%, -50%);');
    expect(rule).toContain(FIT);
    // The real page's own rules, which this copies.
    const leaf = booklet.slice(booklet.indexOf('.booklet-leaf {'), booklet.indexOf('\n    }', booklet.indexOf('.booklet-leaf {')));
    expect(leaf).toContain('left: 50%;');
    expect(leaf).toContain('top: 50%;');
    expect(leaf).toContain("width: min(calc(100vw - ${2 * gutter}px), ${pageW}px, calc(${BOOKLET_UI.maxHeight * 100}dvh * ${pageW} / ${pageH}));");
  });

  it('is the page alone: no sheet surface, handle or control bar, no counter', () => {
    expect(html).not.toMatch(/pre-splash-(handle|controls|count)/);
    expect(html).not.toContain(css(COLORS.uiSurface));
    expect(html).not.toMatch(/\d+ \/ \d+<\/span>/);
  });

  it("draws in the page's shape, paper and shadow", () => {
    const svg = html.slice(html.indexOf('.pre-splash svg {'), html.indexOf('}', html.indexOf('.pre-splash svg {')));
    expect(svg).toContain('width: 100%;');
    expect(svg).toContain(`aspect-ratio: ${pageW} / ${pageH};`);
    expect(svg).toContain(`background: ${css(COLORS.bookletPaper)};`);
    expect(svg).toContain(`box-shadow: ${shadow};`);
    // The corners and shadow of the real page's frame.
    expect(booklet).toContain('border-radius: ${radius}px;\n      box-shadow: ${shadow};');
    expect(svg).toContain(`border-radius: ${radius}px;`);
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

  // The cover has a next page and no previous one, and no number: only › is printed, as
  // src/scene/catalogPages.ts draws it from the same chevron.
  it("prints the cover's › in the corner as the page draws it, and no ‹ and no number", () => {
    const [start, ...rest] = arrowChevron(CATALOG.page.next, 'next');
    const d = `M${start.join(' ')} ${rest.map((point) => `L${point.join(' ')}`).join(' ')}`;
    const { arrowStroke } = CATALOG.page;
    expect(html).toContain(
      `<path d="${d}" fill="none" stroke="${css(COLORS.bookletInk)}" stroke-width="${arrowStroke}" stroke-linecap="round" stroke-linejoin="round" />`,
    );
    expect(html.match(/<path /g)).toHaveLength(1);
    expect(html.match(/<text /g)).toHaveLength(2);
  });

  it('has no build-time counter stamp left', () => {
    expect(read('vite.config.ts')).not.toMatch(/splash|stampCount/i);
    expect(() => read('src/game/splash.ts')).toThrow();
  });

  // main mounts the catalog sheet at boot and removes the stand-in after.
  it('is removed in the frame that first paints the real catalog, once that sheet is mounted', () => {
    const mount = main.indexOf('document.body.append(catalog.scrim, catalog.thumb, catalog.element);');
    const remove = main.indexOf("requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());");
    expect(mount).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(mount);
  });

  // BUILD IT's and the arrows' hit targets are placed in page fractions of the frame round
  // the catalog's canvas, so the frame must be exactly the page: the element's width, the
  // page's aspect ratio, the canvas filling it — the same fit the pre-splash page has.
  it("sizes the catalog's page frame as the page itself, so the corner buttons land on the drawn marks", () => {
    const frame = booklet.slice(booklet.indexOf('.booklet-frame {'), booklet.indexOf('.booklet-frame canvas'));
    expect(frame).toContain('width: 100%;');
    expect(frame).toContain('aspect-ratio: ${pageW} / ${pageH};');
    expect(booklet).toMatch(/\.booklet-frame canvas \{ width: 100%; height: 100%; \}/);
  });

  it('takes no input — the scrim and the real sheet own every touch', () => {
    expect(html).toMatch(/\.pre-splash \{[^}]*pointer-events: none;/);
  });
});
