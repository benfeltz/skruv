import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.9.1.5: the ?tune gear leaves the upper left to the catalog's thumb and sits under the
// Repack button, upper right. Its offset is named in TUNE from Repack's own box (src/ui/
// resetButton.ts, RESET's) so the two cannot drift; these keep them reading it.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const reset = read('src/ui/resetButton.ts');
const panel = read('src/ui/tunePanel.ts');

describe('the tune gear under Repack', () => {
  it("is named from Repack's inset and height", () => {
    expect(reset).toContain('top: calc(${RESET.inset}px + env(safe-area-inset-top));');
    expect(reset).toContain('right: calc(${RESET.inset}px + env(safe-area-inset-right));');
    expect(reset).toContain('min-height: ${RESET.height}px;');
  });

  it('sits at its right edge, a gap below it, and leaves the upper left alone', () => {
    const tab = panel.slice(panel.indexOf('.tune-tab {'), panel.indexOf(".tune-tab[aria-expanded='true']"));
    expect(tab).toContain('right: calc(${RESET.inset}px + env(safe-area-inset-right));');
    expect(tab).toContain('top: calc(${RESET.inset + RESET.height + TUNE.tabGap}px + env(safe-area-inset-top));');
    expect(tab).not.toMatch(/left:/);
  });
});
