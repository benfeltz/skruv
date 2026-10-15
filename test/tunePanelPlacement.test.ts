import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.9.1.2: Repack, Snap rotate and the ?tune gear stack in the control cluster, upper right
// (src/ui/controlCluster.ts); none of them places itself.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
// The style text a module injects for its own button.
const buttonRule = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to));

describe('the cluster buttons place nothing themselves', () => {
  const rules = {
    repack: buttonRule(read('src/ui/resetButton.ts'), '.reset-button {', ".reset-button[data-armed='true']"),
    snapRotate: buttonRule(read('src/ui/toggleButton.ts'), '.toggle-button {', ".toggle-button[aria-pressed='true']"),
    gear: buttonRule(read('src/ui/tunePanel.ts'), '.tune-tab {', ".tune-tab[aria-expanded='true']"),
  };
  for (const [name, rule] of Object.entries(rules)) {
    it(`${name} has a rule, with no position of its own`, () => {
      expect(rule).toContain('border-radius: 22px;');
      expect(rule).not.toMatch(/position:|\b(left|right|top|bottom):/);
    });
  }
});
