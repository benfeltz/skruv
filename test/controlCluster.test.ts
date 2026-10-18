import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUSTER } from '../src/constants.js';
import { createControlCluster } from '../src/ui/controlCluster.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.7.1.1, moved by 1.9.7.1.2: the upper-left row — the menu button in the corner, the ?tune gear
// to its right — so the lift line under the menu falls to the left thumb (Ben, 2026-10-18).
let dom: FakeDom;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => vi.unstubAllGlobals());

const rules = () => dom.head.children.find((node) => node.id === 'skruv-control-cluster')!.textContent;

describe('the control cluster', () => {
  it('takes what is added in the order added: the menu, then the gear (the row puts the gear to its right)', () => {
    const cluster = createControlCluster() as unknown as { element: FakeElement; add(control: FakeElement): void };
    const [menu, gear] = ['menu', 'gear'].map((text) => Object.assign(new FakeElement('button', dom), { textContent: text }));
    cluster.add(menu);
    cluster.add(gear);
    expect(cluster.element.children.map((child) => child.textContent)).toEqual(['menu', 'gear']);
  });

  // Ben's phone, 2026-10-18: the menu sat upper right on the first load, then swapped to the left when
  // a model was picked. It is upper left from the first load on, with or without the manual's band.
  it('is one fixed row in the upper left, at the safe-area inset, from the first load on', () => {
    createControlCluster();
    const css = rules();
    expect(css).toContain('position: fixed;');
    expect(css).toContain(`.control-cluster {\n      position: fixed;`);
    expect(css).toContain(`left: calc(${CLUSTER.inset}px + env(safe-area-inset-left));`);
    expect(css).toContain(`top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));`);
    expect(css).toContain('flex-direction: row;');
    expect(css).not.toContain('row-reverse');
    expect(css).not.toContain("html[data-strip='bottom']");
    // Above an open manual page (z-index 3), so the menu's drop is reachable over it.
    expect(css).toContain('z-index: 4;');
    expect(css).toContain(`gap: ${CLUSTER.gap}px;`);
  });

  // Ben, 2026-10-18: the band always stands on the right in landscape, so the cluster stays upper left,
  // a column just inside the room's view (past the safe-area margin: in Safari the Dynamic Island
  // covered the menu in the notch's margin). With no inset reported (Chrome on iOS), the page's edge.
  it('stays on the left in landscape, a column just inside the room\'s view', () => {
    createControlCluster();
    const css = rules();
    expect(css).toContain(`html[data-strip='right'] .control-cluster {\n      flex-direction: column;`);
    expect(css).not.toContain("data-strip='left'");
    expect(css).not.toContain('--rail-x');
    expect(css.match(/flex-direction: column;/g)).toHaveLength(1);
  });
});
