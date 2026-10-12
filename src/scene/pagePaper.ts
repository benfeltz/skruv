import { BOOKLET, COLORS } from '../constants.js';

// The paper both booklets are drawn on (the manual, src/scene/bookletPages.ts; the catalog,
// src/scene/catalogPages.ts): its inks and type, a blank page, and the page cache the
// booklet sheet reads — drawn on first ask, the rest in idle time.

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
export const INK = css(COLORS.bookletInk);
export const FAINT = css(COLORS.bookletFaint);
export const PAPER = css(COLORS.bookletPaper);
export const font = (size: number, weight = 700) => `${weight} ${size}px ${BOOKLET.font}`;

/** A page being drawn: its canvas and that canvas's context. */
export interface Sheet {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** A blank page at BOOKLET.pageSize: paper filled, round line ends and joins. */
export function newPage(): Sheet {
  const [pageW, pageH] = BOOKLET.pageSize;
  const canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = pageH;
  // A canvas always gives a 2D context the first time it is asked.
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, pageW, pageH);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { canvas, ctx };
}

/**
 * `{ canvas(index), prerender(), dispose() }` over `count` pages drawn by `draw(index)`.
 * `canvas` draws a page the first time it is asked for and caches it; `prerender` draws the
 * rest one per idle slice, so the first frame never waits on the booklet; `dispose` stops
 * any idle drawing still to come and calls `release` (the drawings' GPU resources).
 */
export function createPageCache(count: number, draw: (index: number) => HTMLCanvasElement, release: () => void) {
  const cache = new Map<number, HTMLCanvasElement>();

  function canvas(index: number) {
    if (!cache.has(index)) cache.set(index, draw(index));
    return cache.get(index)!;
  }

  // Set by dispose(): a booklet put away for good stops drawing in idle time.
  let disposed = false;

  function prerender() {
    const idle: (fn: () => void) => unknown = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1));
    const next = (i: number) => {
      if (i >= count) return;
      idle(() => {
        if (disposed) return;
        canvas(i);
        next(i + 1);
      });
    };
    next(0);
  }

  function dispose() {
    disposed = true;
    release();
  }

  return { canvas, prerender, dispose };
}
