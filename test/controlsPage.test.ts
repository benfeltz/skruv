import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLS, rowsFor } from '../src/game/controlsPage.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { itemById } from '../src/game/item.js';
import type { FastenerKind } from '../tools/validate/lib/vocabulary.js';
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
    expect(pages).toMatch(/gamePages: gamePagesFor\(scheme, item\.kinds\)/);
  });
});

// JOHNNY's page, restated independently (1.9.2): the rows its kinds must keep showing, word
// for word and in order, whatever the filter that follows learns about other items.
const JOHNNY_ROWS = {
  touch: [
    ['orbit', 'Turn view'], ['zoomPan', 'Zoom and pan'], ['select', 'Tap to turn'], ['move', 'Drag to move'], ['lift', 'Lift'],
    ['seat', 'Drop to seat'], ['pushHome', 'Push home'], ['turnTool', 'Circle or hold'], ['pullApart', 'Pull apart'],
    ['flip', 'Swipe pages'], ['repack', 'Repack: tap twice'],
  ],
  desktop: [
    ['orbit', 'Turn view'], ['pan', 'Pan'], ['zoom', 'Zoom'], ['select', 'Click to turn'], ['move', 'Drag to move'], ['hold', 'Hold up'],
    ['height', 'Set height'], ['seat', 'Drop to seat'], ['pushHome', 'Push home'], ['turnTool', 'Circle or hold'], ['pullApart', 'Pull apart'],
    ['flip', 'Flip pages'], ['repack', 'Repack: click twice'],
  ],
} as const;

describe("JOHNNY's controls page (regression pin)", () => {
  const johnny = itemById('johnny').kinds;

  it('derives JOHNNY\'s kinds from its pack: its five fasteners and its tools', () => {
    expect([...johnny].sort()).toEqual([KIND.BOLT, KIND.CAM, KIND.DOWEL, KIND.FITTING, KIND.PIN, KIND.TOOL].sort());
  });

  it.each(['touch', 'desktop'] as const)('lists exactly its %s rows, through the filter', (scheme) => {
    expect(rowsFor(scheme, johnny).map((row) => [row.pictogram, row.label])).toEqual(JOHNNY_ROWS[scheme]);
  });
});

describe('rowsFor', () => {
  const kinds = (...list: FastenerKind[]) => new Set<FastenerKind>(list);

  it.each(['touch', 'desktop'] as const)("adds one circle-a-leg row to an item with studs, after the tool row (%s)", (scheme) => {
    const rows = rowsFor(scheme, kinds(KIND.STUD, KIND.TOOL)).map((row) => row.pictogram);
    expect(rows.filter((id) => id === 'turnPart')).toHaveLength(1);
    expect(rows.indexOf('turnPart')).toBe(rows.indexOf('turnTool') + 1);
  });

  it('leaves leg screwing off JOHNNY\'s page, and the tool row off an item that uses no tool', () => {
    expect(rowsFor('touch', itemById('johnny').kinds).map((row) => row.pictogram)).not.toContain('turnPart');
    expect(rowsFor('touch', kinds(KIND.DOWEL)).map((row) => row.pictogram)).not.toContain('turnTool');
  });

  it('keeps the rows no kind gates, and the order', () => {
    const none = rowsFor('desktop', kinds()).map((row) => row.pictogram);
    expect(none).toEqual(CONTROLS.desktop.filter((row) => row.needs === undefined).map((row) => row.pictogram));
  });

  it('labels the new row in three words with no mouse in it, and BLANK shows it', () => {
    const row = CONTROLS.touch.find((r) => r.pictogram === 'turnPart')!;
    expect(row.label.split(' ').length).toBeLessThanOrEqual(3);
    expect(row.label).not.toMatch(/click|shift|scroll/i);
    expect(rowsFor('touch', itemById('blank').kinds).map((r) => r.pictogram)).toEqual(expect.arrayContaining(['turnTool', 'turnPart']));
  });
});
