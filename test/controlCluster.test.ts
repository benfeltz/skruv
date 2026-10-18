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
    expect(css).toContain(`right: calc(${CLUSTER.inset}px + env(safe-area-inset-right));`);
    expect(css).toContain(`top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));`);
    expect(css).toContain('flex-direction: row-reverse;');
    // Above an open manual page (z-index 3), so the menu's drop is reachable over it.
    expect(css).toContain('z-index: 4;');
    expect(css).toContain(`gap: ${CLUSTER.gap}px;`);
  });

  it("goes to the side without the manual's band in landscape, a column just inside the room's view", () => {
    createControlCluster();
    const css = dom.head.children.find((node) => node.id === 'skruv-control-cluster')!.textContent;
    // Just inside the room's view, past the notch's margin and never in it (Ben's phone, 2026-10-18:
    // in Safari the Dynamic Island covered the menu in the margin). With no inset reported (Chrome on
    // iOS), CLUSTER.inset from the page's edge.
    expect(css).toContain(`html[data-strip='right'] .control-cluster {\n      right: auto;\n      left: calc(${CLUSTER.inset}px + env(safe-area-inset-left));`);
    expect(css).toContain(`html[data-strip='left'] .control-cluster {\n      right: calc(${CLUSTER.inset}px + env(safe-area-inset-right));`);
    expect(css).not.toContain('--rail-x');
    expect(css.match(/flex-direction: column;/g)).toHaveLength(2);
  });

  // Ben, 2026-10-18: the lift line hangs under the menu, so with the menu upper left it falls to the left thumb.
  it('goes to the upper left in portrait, with the band along the bottom: the menu in the corner, the gear to its right', () => {
    createControlCluster();
    const css = dom.head.children.find((node) => node.id === 'skruv-control-cluster')!.textContent;
    expect(css).toContain(`html[data-strip='bottom'] .control-cluster {\n      right: auto;\n      left: calc(${CLUSTER.inset}px + env(safe-area-inset-left));\n      flex-direction: row;`);
  });
});
