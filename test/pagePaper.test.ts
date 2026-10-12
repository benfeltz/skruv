import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageCache } from '../src/scene/pagePaper.js';

// The page cache both booklets share (1.9.1 review): a page is drawn once, on first ask or in
// idle time, and a disposed booklet stops drawing and releases its drawings' resources.

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function cache() {
  const drawn: number[] = [];
  const release = vi.fn();
  const pages = createPageCache(4, (index) => {
    drawn.push(index);
    return { index } as unknown as HTMLCanvasElement;
  }, release);
  return { pages, drawn, release };
}

describe('createPageCache', () => {
  it('draws a page on first ask and serves the same canvas after', () => {
    const { pages, drawn } = cache();
    expect(pages.canvas(2)).toBe(pages.canvas(2));
    expect(drawn).toEqual([2]);
  });

  it('prerenders the rest in idle time, never redrawing one already asked for', () => {
    const { pages, drawn } = cache();
    pages.canvas(1);
    pages.prerender();
    expect(drawn).toEqual([1]);
    vi.runAllTimers();
    expect(drawn).toEqual([1, 0, 2, 3]);
  });

  it('stops idle drawing and releases on dispose', () => {
    const { pages, drawn, release } = cache();
    pages.prerender();
    vi.advanceTimersToNextTimer();
    pages.dispose();
    vi.runAllTimers();
    expect(drawn).toEqual([0]);
    expect(release).toHaveBeenCalledOnce();
  });
});
