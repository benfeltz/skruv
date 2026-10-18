import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUSTER } from '../src/constants.js';
import { createControlCluster } from '../src/ui/controlCluster.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.7.1.1: the upper-right row — the menu button in the corner, the ?tune gear to its left.
let dom: FakeDom;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => vi.unstubAllGlobals());

describe('the control cluster', () => {
  it('takes what is added in the order added: the menu, then the gear (the row reverses them, so the gear lands to the left)', () => {
    const cluster = createControlCluster() as unknown as { element: FakeElement; add(control: FakeElement): void };
    const [menu, gear] = ['menu', 'gear'].map((text) => Object.assign(new FakeElement('button', dom), { textContent: text }));
    cluster.add(menu);
    cluster.add(gear);
    expect(cluster.element.children.map((child) => child.textContent)).toEqual(['menu', 'gear']);
  });

  it('is one fixed row in the upper right, at the safe-area inset', () => {
    createControlCluster();
    const css = dom.head.children.find((node) => node.id === 'skruv-control-cluster')!.textContent;
    expect(css).toContain('position: fixed;');
    // Left of the manual's band when it runs down the right edge; that variable already counts the notch, so the notch is not added again.
    expect(css).toContain(`right: calc(max(var(--strip-right, 0px), env(safe-area-inset-right)) + ${CLUSTER.inset}px);`);
    expect(css).toContain(`top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));`);
    expect(css).toContain('flex-direction: row-reverse;');
    // Above an open manual page (z-index 3), so the menu's drop is reachable over it.
    expect(css).toContain('z-index: 4;');
    expect(css).toContain(`gap: ${CLUSTER.gap}px;`);
  });
});
