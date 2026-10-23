import { BOOKLET, CLUSTER, COLORS, FAN, GESTURE, MENU, RENDER } from '../constants.js';
import { fanCovers, fanLabel, fanLayout, fanWidth } from '../game/manualFan.js';
import { fanBox, type Rect } from '../game/screenLayout.js';

// The manual fan (1.9.9.3): the kept worlds' manuals as a stack of covers across the top, between the
// menu and the catalog's thumb. A tap on the stack spreads it; a tap on a cover is the caller's pick.
// It draws the covers the worlds hand out and asks for nothing else of them — a kept world is never touched.

const STYLE_ID = 'skruv-manual-fan';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;
const coverHeight = Math.round((FAN.cover * pageH) / pageW);

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Level with the control cluster, to its right; placed from the measured cluster and thumb (refresh). */
    .manual-fan {
      position: fixed;
      /* Under a blocking sheet's scrim (2) and an open page (3), as the catalog's thumb. */
      z-index: 1;
      left: calc(${CLUSTER.inset + MENU.size + FAN.inset}px + env(safe-area-inset-left));
      top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));
      height: ${coverHeight}px;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
    }
    .manual-fan[hidden] { display: none; }
    .manual-fan[data-expanded='true'] { touch-action: pan-x; }
    .manual-fan-row {
      position: relative;
      width: 100%;
      height: 100%;
      scrollbar-width: none;
    }
    .manual-fan-row::-webkit-scrollbar { display: none; }
    .manual-fan[data-expanded='true'] .manual-fan-row {
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
    }
    .manual-fan-cover {
      position: absolute;
      left: 0;
      top: 0;
      width: ${FAN.cover}px;
      height: ${coverHeight}px;
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 6px;
      background: ${css(COLORS.bookletPaper)};
      box-shadow: 0 3px 10px #0006;
      overflow: hidden;
      cursor: pointer;
      box-sizing: border-box;
      transform-origin: 50% 100%;
      scroll-snap-align: start;
      transition: transform ${FAN.motionMs}ms ease-out;
    }
    .manual-fan-cover canvas { display: block; width: 100%; height: 100%; }
    .manual-fan-cover:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .manual-fan-cover { transition: none; }
    }
  `;
  document.head.append(style);
}

/** A world, as the fan sees it: an id and the cover it drew for its strip. */
export interface FanWorld {
  id: string;
  cover(): CanvasImageSource;
}

/**
 * The fan, hidden until the room holds a kept world. `worlds()` is the room's worlds in order, the
 * active one last: the fan holds every one but that. A tap on the folded stack spreads it; a tap on
 * a spread cover calls `onPick(id)` and folds, a pointer that travels past the tap distance (the row
 * scrolling) picks nothing. A tap outside, Escape and `fold()` put it away. `refresh()` follows the room.
 */
export function createManualFan({ worlds, nameOf, onPick }: { worlds(): readonly FanWorld[]; nameOf(id: string): string; onPick(id: string): void }) {
  injectStyle();
  const element = document.createElement('div');
  element.className = 'manual-fan';
  element.hidden = true;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-expanded', 'false');
  element.dataset.expanded = 'false';
  const row = document.createElement('div');
  row.className = 'manual-fan-row';
  element.append(row);

  const ratio = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
  const covers = new Map<string, { button: HTMLButtonElement; canvas: HTMLCanvasElement; source: CanvasImageSource | null }>();
  let ids: string[] = [];
  let expanded = false;

  // A control on screen, measured: null when it is not mounted (or there is no layout to ask).
  function measured(selector: string): Rect | null {
    if (typeof document.querySelector !== 'function') return null;
    const found = document.querySelector(selector);
    if (!found || typeof found.getBoundingClientRect !== 'function') return null;
    const { left, top, right, bottom } = found.getBoundingClientRect();
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }

  // Between the control cluster and the catalog's thumb (src/game/screenLayout.ts); else where the CSS puts it.
  function place() {
    const cluster = measured('.control-cluster');
    if (!cluster) return;
    const box = fanBox({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cluster,
      thumb: measured(".booklet-thumb[data-corner='topLeft']"),
      height: coverHeight,
      gap: FAN.inset,
    });
    element.style.left = `${box.left}px`;
    element.style.top = `${box.top}px`;
    element.style.width = `${Math.min(fanWidth(ids.length, expanded, FAN), box.right - box.left)}px`;
  }

  // Each cover to its place in the row, folded or spread (src/game/manualFan.ts).
  function apply() {
    element.dataset.expanded = String(expanded);
    element.setAttribute('aria-expanded', String(expanded));
    fanLayout(ids.length, expanded, FAN).forEach(({ x, angle }, i) => {
      const { button } = covers.get(ids[i])!;
      button.style.transform = `translateX(${x}px) rotate(${angle}deg)`;
      // One tab stop while folded: the stack; each cover once spread.
      button.tabIndex = expanded || i === 0 ? 0 : -1;
    });
    place();
  }

  function cover(id: string, world: FanWorld) {
    let entry = covers.get(id);
    if (!entry) {
      const button = document.createElement('button');
      button.className = 'manual-fan-cover';
      button.dataset.id = id;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(FAN.cover * ratio);
      canvas.height = Math.round(coverHeight * ratio);
      button.append(canvas);
      entry = { button, canvas, source: null };
      covers.set(id, entry);
    }
    // Drawn once per cover: again only if the world handed out a different canvas (a rebuilt world).
    const source = world.cover();
    if (entry.source !== source) {
      entry.canvas.getContext('2d')!.drawImage(source, 0, 0, entry.canvas.width, entry.canvas.height);
      entry.source = source;
    }
    entry.button.setAttribute('aria-label', `Switch to ${nameOf(id)}`);
    return entry.button;
  }

  function spread() {
    if (expanded) return;
    expanded = true;
    document.addEventListener('pointerdown', outside, true);
    apply();
    covers.get(ids[0])?.button.focus();
  }

  function fold() {
    if (!expanded) return;
    expanded = false;
    document.removeEventListener('pointerdown', outside, true);
    apply();
  }

  function outside(event: PointerEvent) {
    if (!element.contains(event.target as Node | null)) fold();
  }

  function choose(id: string) {
    if (!expanded) return spread();
    onPick(id);
    fold();
  }

  // A tap, by the thresholds the rest of the screen uses; a press that travels is the row's scroll
  // (the browser takes a touch for a pan and cancels it), never a pick.
  let press: { pointerId: number; x: number; y: number; t: number } | null = null;
  row.addEventListener('pointerdown', (event) => {
    if (press === null) press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
  });
  row.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { x, y, t } = press;
    press = null;
    const tapped = Math.hypot(event.clientX - x, event.clientY - y) <= GESTURE.tapMaxDistance && event.timeStamp - t <= GESTURE.tapMaxMs;
    const id = (event.target as Element | null)?.closest('button')?.dataset.id;
    if (tapped && id) choose(id);
  });
  row.addEventListener('pointercancel', () => {
    press = null;
  });
  // A key press on a focused cover arrives as a click with no pointer (detail 0); a pointer's own click is handled above.
  row.addEventListener('click', (event) => {
    const id = (event.target as Element | null)?.closest('button')?.dataset.id;
    if (event.detail === 0 && id) choose(id);
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') fold();
  };
  window.addEventListener('keydown', onKey);
  const onResize = () => place();
  window.addEventListener('resize', onResize);

  return {
    element,
    /** Follows the room: one cover per kept world (the last world is the active one), hidden with none. */
    refresh() {
      const all = worlds();
      const byId = new Map(all.map((world) => [world.id, world]));
      ids = fanCovers(all.map((world) => world.id), all.at(-1)?.id ?? null);
      for (const [id, { button }] of covers) {
        if (ids.includes(id)) continue;
        button.remove();
        covers.delete(id);
      }
      const buttons = ids.map((id) => cover(id, byId.get(id)!));
      for (const button of buttons) button.remove();
      row.append(...buttons);
      element.setAttribute('aria-label', fanLabel(ids.length));
      element.hidden = ids.length === 0;
      if (ids.length === 0) fold();
      apply();
    },
    fold,
    get expanded() {
      return expanded;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', outside, true);
      element.remove();
    },
  };
}
