import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.9.7.1.1: the menu button (holding Repack and Snap rotate) and the ?tune gear sit in the
// control cluster's row, upper right (src/ui/controlCluster.ts); none of them places itself.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
// The style text a module injects for its own button.
const buttonRule = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to));

describe('the cluster buttons place nothing themselves', () => {
  const rules = {
    menu: buttonRule(read('src/ui/menuButton.ts'), '.menu-button {', '.menu-button[aria-expanded'),
    repack: buttonRule(read('src/ui/resetButton.ts'), '.reset-button {', ".reset-button[data-armed='true']"),
    snapRotate: buttonRule(read('src/ui/toggleButton.ts'), '.toggle-button {', ".toggle-button[aria-pressed='true']"),
    gear: buttonRule(read('src/ui/tunePanel.ts'), '.tune-tab {', ".tune-tab[aria-expanded='true']"),
  };
  for (const [name, rule] of Object.entries(rules)) {
    it(`${name} has a rule, with no position of its own`, () => {
      expect(rule).toMatch(/border-radius: (22px|50%);/);
      expect(rule).not.toMatch(/position:|\b(left|right|top|bottom):/);
    });
  }
});
