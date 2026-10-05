import { BOOKLET, BOOKLET_UI, COLORS } from '../constants.js';

// The booklet in hand: a bottom sheet over the room. Collapsed, it is a thumbnail of the
// open page in the corner — the only thing it puts under a finger, so the room stays
// free. Tapped, it opens: one page at a time, flipped by a horizontal swipe, the arrow
// buttons or the arrow keys, closed by its handle, a swipe down, or Escape. It flips
// freely, front to back and back again: reference, never a checklist. Follows the src/ui
// pattern (own element, own style, colours from COLORS).

const STYLE_ID = 'skruv-booklet';
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .booklet-thumb {
      position: fixed;
      left: calc(16px + env(safe-area-inset-left));
      bottom: calc(16px + env(safe-area-inset-bottom));
      width: ${BOOKLET_UI.thumbWidth}px;
      aspect-ratio: ${pageW} / ${pageH};
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 8px;
      background: ${css(COLORS.bookletPaper)};
      box-shadow: 0 4px 14px #0006;
      overflow: hidden;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .booklet-thumb canvas { display: block; width: 100%; height: 100%; }
    .booklet-thumb:focus-visible, .booklet button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
    .booklet {
      position: fixed;
      left: 50%;
      bottom: 0;
      transform: translate(-50%, 100%);
      width: min(100vw, ${BOOKLET_UI.maxWidth}px);
      max-height: ${BOOKLET_UI.maxHeight * 100}dvh;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-sizing: border-box;
      padding: 8px 16px calc(14px + env(safe-area-inset-bottom));
      border-radius: 18px 18px 0 0;
      background: ${css(COLORS.uiSurface)};
      color: ${css(COLORS.uiText)};
      font: 600 15px/1 system-ui, -apple-system, sans-serif;
      box-shadow: 0 -8px 30px #0008;
      transition: transform 220ms ease-out, visibility 0s linear 220ms;
      visibility: hidden;
    }
    .booklet[data-open='true'] {
      transform: translate(-50%, 0);
      transition: transform 220ms ease-out;
      visibility: visible;
    }
    @media (prefers-reduced-motion: reduce) {
      .booklet, .booklet[data-open='true'] { transition: none; }
    }
    .booklet-handle {
      align-self: center;
      width: 64px;
      height: 28px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      touch-action: manipulation;
    }
    .booklet-handle::before {
      content: '';
      display: block;
      width: 44px;
      height: 5px;
      margin: 0 auto;
      border-radius: 3px;
      background: ${css(COLORS.uiText)}66;
    }
    .booklet-page {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      justify-content: center;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .booklet-page canvas {
      display: block;
      max-width: 100%;
      max-height: calc(${BOOKLET_UI.maxHeight * 100}dvh - 120px);
      aspect-ratio: ${pageW} / ${pageH};
      border-radius: 6px;
      background: ${css(COLORS.bookletPaper)};
    }
    .booklet-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .booklet-controls button {
      min-width: 44px;
      min-height: 44px;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 22px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 20px;
      cursor: pointer;
      touch-action: manipulation;
    }
    .booklet-controls button:disabled { opacity: 0.3; cursor: default; }
    .booklet-count { font-variant-numeric: tabular-nums; }
  `;
  document.head.append(style);
}

/**
 * The booklet sheet for `pages` (`{ count, canvas(index) }`, src/scene/bookletPages.js).
 * Returns `{ thumb, element, currentPage, expanded, onChange(fn) }`: mount both elements;
 * `onChange(fn)` calls `fn({ page, expanded })` whenever either changes. State is the
 * module's own and read-only outside it.
 */
export function createBookletSheet({ pages }) {
  injectStyle();
  const listeners = new Set();
  let page = 0;
  let open = false;

  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'booklet-thumb';
  thumb.setAttribute('aria-label', 'Open the instructions');
  const thumbCanvas = pageCanvas(Math.round(pageW / 4), Math.round(pageH / 4));
  thumb.append(thumbCanvas);

  const element = document.createElement('section');
  element.className = 'booklet';
  element.setAttribute('aria-label', 'Instructions');

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'booklet-handle';
  handle.setAttribute('aria-label', 'Close the instructions');

  const view = document.createElement('div');
  view.className = 'booklet-page';
  const viewCanvas = pageCanvas(pageW, pageH);
  viewCanvas.setAttribute('role', 'img');
  view.append(viewCanvas);

  const controls = document.createElement('div');
  controls.className = 'booklet-controls';
  const prev = button('‹', 'Previous page');
  const next = button('›', 'Next page');
  const count = document.createElement('span');
  count.className = 'booklet-count';
  count.setAttribute('aria-live', 'polite');
  controls.append(prev, count, next);
  element.append(handle, view, controls);

  function render() {
    const source = pages.canvas(page);
    for (const target of open ? [viewCanvas, thumbCanvas] : [thumbCanvas]) {
      const ctx = target.getContext('2d');
      ctx.drawImage(source, 0, 0, target.width, target.height);
    }
    count.textContent = `${page + 1} / ${pages.count}`;
    viewCanvas.setAttribute('aria-label', `Page ${page + 1} of ${pages.count}`);
    prev.disabled = page === 0;
    next.disabled = page === pages.count - 1;
    element.dataset.open = String(open);
    thumb.hidden = open;
    for (const fn of listeners) fn({ page, expanded: open });
  }

  const flip = (by) => {
    const to = Math.min(pages.count - 1, Math.max(0, page + by));
    if (to === page) return;
    page = to;
    render();
  };

  function setOpen(value) {
    if (open === value) return;
    open = value;
    render();
    (open ? next : thumb).focus({ preventScroll: true });
  }

  thumb.addEventListener('click', () => setOpen(true));
  handle.addEventListener('click', () => setOpen(false));
  prev.addEventListener('click', () => flip(-1));
  next.addEventListener('click', () => flip(1));

  // Swipe on the page: across flips, down closes.
  let swipe = null;
  view.addEventListener('pointerdown', (event) => {
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    view.setPointerCapture(event.pointerId);
  });
  const endSwipe = (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (event.type !== 'pointerup') return;
    if (Math.abs(dx) >= BOOKLET_UI.swipeDistance && Math.abs(dx) > Math.abs(dy)) flip(dx < 0 ? 1 : -1);
    else if (dy >= BOOKLET_UI.swipeDistance) setOpen(false);
  };
  view.addEventListener('pointerup', endSwipe);
  view.addEventListener('pointercancel', endSwipe);

  window.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'ArrowLeft') flip(-1);
    else if (event.key === 'ArrowRight') flip(1);
    else if (event.key === 'Escape') setOpen(false);
  });

  render();

  return {
    thumb,
    element,
    get currentPage() {
      return page;
    },
    get expanded() {
      return open;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function pageCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function button(label, name) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-label', name);
  return element;
}
