import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { METRICS } from '../src/constants.js';
import { createMetricsOverlay } from '../src/ui/metricsOverlay.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// The metrics readout on the fake DOM: its text and its removal. Where it sits and how it
// reads on a phone is the phone pass.
let dom: FakeDom;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => vi.unstubAllGlobals());

const mount = () => {
  const overlay = createMetricsOverlay();
  dom.body.append(overlay.element as unknown as FakeElement);
  return { overlay, element: overlay.element as unknown as FakeElement };
};

describe('the metrics overlay', () => {
  it('shows the frame count and the slow count once a readout period has passed', () => {
    const { overlay, element } = mount();
    // The readout redraws on the frame that reaches readoutSeconds: the 31st at 60 fps.
    for (let i = 0; i < 31; i++) overlay.frame(1 / 60);
    expect(element.textContent).toMatch(/^frames 31 {2}0\.5 s {2}>33ms 0\n/);
    expect(element.textContent).toMatch(/p50 16\.\d {2}p95 16\.\d {2}p99 16\.\d {2}max 16\.\d ms/);
  });

  it('counts a 50 ms frame as slow', () => {
    const { overlay, element } = mount();
    overlay.frame(0.05);
    for (let i = 0; i < 30; i++) overlay.frame(1 / 60);
    expect(element.textContent).toContain(`>${METRICS.slowFrameMs}ms 1`);
  });

  it('ignores the loop’s first, delta-less tick', () => {
    const { overlay, element } = mount();
    overlay.frame(0);
    for (let i = 0; i < 31; i++) overlay.frame(1 / 60);
    expect(element.textContent).toContain('frames 31 ');
  });

  it('is removed from its parent on dispose', () => {
    const { overlay, element } = mount();
    overlay.dispose();
    expect(element.parent).toBeNull();
    expect(dom.body.children).toEqual([]);
  });
});
