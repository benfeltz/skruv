import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUSTER } from '../src/constants.js';
import { createControlCluster } from '../src/ui/controlCluster.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.1.2: the upper-right column that lays out Repack, Snap rotate and the ?tune gear.
let dom: FakeDom;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => vi.unstubAllGlobals());

describe('the control cluster', () => {
  it('stacks what is added in the order added: Repack, Snap rotate, the gear', () => {
    const cluster = createControlCluster() as unknown as { element: FakeElement; add(control: FakeElement): void };
    const [repack, snap, gear] = ['Repack', 'Snap rotate', 'gear'].map((text) => Object.assign(new FakeElement('button', dom), { textContent: text }));
    cluster.add(repack);
    cluster.add(snap);
    cluster.add(gear);
    expect(cluster.element.children.map((child) => child.textContent)).toEqual(['Repack', 'Snap rotate', 'gear']);
  });

  it('is one fixed column in the upper right, at the safe-area inset', () => {
    createControlCluster();
    const css = dom.head.children.find((node) => node.id === 'skruv-control-cluster')!.textContent;
    expect(css).toContain('position: fixed;');
    expect(css).toContain(`right: calc(${CLUSTER.inset}px + env(safe-area-inset-right));`);
    expect(css).toContain(`top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));`);
    expect(css).toContain('flex-direction: column;');
    expect(css).toContain(`gap: ${CLUSTER.gap}px;`);
  });
});
