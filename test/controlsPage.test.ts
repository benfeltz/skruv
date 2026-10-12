import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLS } from '../src/game/controlsPage.js';
import type { PictogramId } from '../src/game/controlsPage.js';

// 1.8.3.3: the booklet's controls page, one scheme per device. The rows are what the code
// does (Shift holds; Shift + scroll is height; a Shift-drag is a plain drag), so a gesture
// that changes and a page that doesn't fail here.

const pictograms = (scheme: keyof typeof CONTROLS) => CONTROLS[scheme].map((row) => row.pictogram);

describe('CONTROLS', () => {
  it.each(['touch', 'desktop'] as const)('gives %s rows, each once, each labelled in one to three words', (scheme) => {
    const rows = CONTROLS[scheme];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(pictograms(scheme)).size).toBe(rows.length);
    for (const { label } of rows) {
      expect(label.trim()).toBe(label);
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('puts Shift on the desktop as a hold, and Shift + scroll as the height — no lift by dragging', () => {
    expect(pictograms('desktop')).toEqual(expect.arrayContaining<PictogramId>(['hold', 'height']));
    expect(pictograms('desktop')).not.toContain('lift');
    expect(CONTROLS.desktop.map((row) => row.label).join(' ')).not.toMatch(/drag to lift/i);
  });

  it('gives touch the lift line and its own camera, and no keys or mouse', () => {
    expect(pictograms('touch')).toContain('lift');
    expect(pictograms('touch')).toContain('zoomPan');
    for (const desktopOnly of ['hold', 'height', 'pan', 'zoom'] as const) expect(pictograms('touch')).not.toContain(desktopOnly);
    expect(CONTROLS.touch.map((row) => row.label).join(' ')).not.toMatch(/click|shift|scroll/i);
  });

  it('shares the part, tool, booklet and repack rows between the schemes', () => {
    const shared: PictogramId[] = ['orbit', 'select', 'move', 'seat', 'pushHome', 'turnTool', 'pullApart', 'flip', 'repack'];
    for (const scheme of ['touch', 'desktop'] as const) expect(pictograms(scheme)).toEqual(expect.arrayContaining(shared));
  });

  it('is picked in the wiring by the pointer, and passed down to the pages', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/createBookletPages\(renderer, \{ scheme: matchMedia\('\(pointer: coarse\)'\)\.matches \? 'touch' : 'desktop' \}\)/);
    const pages = readFileSync(new URL('../src/scene/bookletPages.ts', import.meta.url), 'utf8');
    expect(pages).not.toMatch(/matchMedia/);
    expect(pages).toMatch(/gamePages: \[\{ kind: 'controls', scheme \}\]/);
  });
});
