import { BOOKLET, BOOKLET_UI, CLUSTER, COLORS, FAN, GESTURE, RENDER } from '../constants.js';
import { fanLabel, rowLength, spineEdges } from '../game/manualFan.js';
import { fanBox, type Rect } from '../game/screenLayout.js';
import { BAND } from './booklet.js';

// The manuals' pocket (1.9.9.3, option B; Ben, 2026-10-23): the manual's band's far end — the right
// end upright, the foot in landscape — holds every world's manual. At rest it is a spine, only the
// covers' edges, the open manual's on top in gold. A tap on it brings every cover out as a row (above
// the band upright, leftward into the room in landscape), the open one nearest the pocket; a tap on
// another cover is the caller's pick, and the row folds back. Two states, spine and spread; no timers.
// It draws the covers the worlds hand out and asks nothing else of them: a kept world is never touched.

const STYLE_ID = 'skruv-manual-fan';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;
const coverHeight = Math.round((FAN.cover * pageH) / pageW);
const { pocket, name, rule } = BOOKLET_UI.strip;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  const landscape = "html[data-strip='right']";
  const upright = "html:not([data-strip='right'])";
  style.textContent = `
    .manual-fan[hidden] { display: none; }
    /* The spine: the band's last ${pocket} px behind an ink rule, on off-white paper. Over the band (0),
       under a blocking sheet's scrim (2) and an open page (3). */
    .manual-fan-spine {
      position: fixed;
      z-index: 1;
      bottom: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: ${css(COLORS.uiText)};
      box-shadow: inset ${rule}px ${rule}px 0 ${css(COLORS.bookletInk)};
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    ${upright} .manual-fan-spine {
      right: 0;
      width: calc(${pocket}px + env(safe-area-inset-right));
      height: calc(${BAND.bottom}px + env(safe-area-inset-bottom));
    }
    ${landscape} .manual-fan-spine {
      right: env(safe-area-inset-right);
      width: ${BAND.right}px;
      height: calc(${pocket}px + env(safe-area-inset-bottom));
    }
    .manual-fan-spine:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: -4px;
    }
    /* One edge per manual, offset across the spine (left upright, top in landscape: set inline), the
       open one's last, on top, gold. Centred along the band's lane, past the name row. */
    .manual-fan-edge {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid ${css(COLORS.bookletInk)}4d;
      border-radius: 2px;
      background: ${css(COLORS.bookletPaper)};
      pointer-events: none;
    }
    .manual-fan-edge[data-open='true'] { border-color: ${css(COLORS.uiAccent)}; }
    ${upright} .manual-fan-edge {
      top: ${name.row + (BAND.bottom - name.row - coverHeight) / 2}px;
      width: ${FAN.edge}px;
      height: ${coverHeight}px;
    }
    ${landscape} .manual-fan-edge {
      left: ${name.row + (BAND.right - name.row - coverHeight) / 2}px;
      width: ${coverHeight}px;
      height: ${FAN.edge}px;
    }
    /* The row of covers, spread: placed from the measured cluster and pocket (place()). Folded it sinks
       back into the band and is gone — unseen, untouchable, out of the tab order. */
    .manual-fan-row {
      position: fixed;
      z-index: 1;
      display: flex;
      gap: ${FAN.gap}px;
      height: ${coverHeight}px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      touch-action: pan-x;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
      transition: opacity ${FAN.motionMs}ms ease-out, transform ${FAN.motionMs}ms ease-out;
    }
    .manual-fan-row::-webkit-scrollbar { display: none; }
    .manual-fan[data-expanded='false'] .manual-fan-row {
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      transition: opacity ${FAN.motionMs}ms ease-in, transform ${FAN.motionMs}ms ease-in, visibility 0s linear ${FAN.motionMs}ms;
    }
    ${upright} .manual-fan[data-expanded='false'] .manual-fan-row { transform: translateY(${FAN.rise}px); }
    ${landscape} .manual-fan[data-expanded='false'] .manual-fan-row { transform: translateX(${FAN.rise}px); }
    .manual-fan-cover {
      flex: none;
      width: ${FAN.cover}px;
      height: ${coverHeight}px;
      padding: 0;
      border: 2px solid ${css(COLORS.bookletInk)}33;
      border-radius: 6px;
      background: ${css(COLORS.bookletPaper)};
      box-shadow: 0 4px 14px #0007;
      overflow: hidden;
      cursor: pointer;
      box-sizing: border-box;
      scroll-snap-align: end;
    }
    .manual-fan-cover[aria-current='true'] {
      border-color: ${css(COLORS.uiAccent)};
      box-shadow: 0 0 0 1px ${css(COLORS.uiAccent)}, 0 4px 14px #0007;
    }
    .manual-fan-cover canvas { display: block; width: 100%; height: 100%; }
    .manual-fan-cover:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .manual-fan-row, .manual-fan[data-expanded='false'] .manual-fan-row { transition: none; }
    }
  `;
  document.head.append(style);
}

/** A world, as the pocket sees it: an id and the cover it drew for its strip. */
export interface FanWorld {
  id: string;
  cover(): CanvasImageSource;
}

/**
 * The pocket, hidden until the room holds a world. `worlds()` is the room's worlds, the active one last,
 * and the pocket shows them in that order: the open manual's edge on top, its cover nearest the pocket.
 * A tap on the spine spreads the row (and folds it again); a tap on a cover calls `onPick(id)` and folds
 * (on the open one's, it only folds); a pointer that travels past the tap distance (the row scrolling)
 * picks nothing. A tap outside, Escape and `fold()` put it away. `refresh()` follows the room.
 */
export function createManualFan({ worlds, nameOf, onPick }: { worlds(): readonly FanWorld[]; nameOf(id: string): string; onPick(id: string): void }) {
  injectStyle();
  const element = document.createElement('div');
  element.className = 'manual-fan';
  element.hidden = true;
  element.dataset.expanded = 'false';
  const spine = document.createElement('button');
  spine.type = 'button';
  spine.className = 'manual-fan-spine';
  spine.setAttribute('aria-expanded', 'false');
  spine.setAttribute('aria-controls', 'manual-fan-row');
  const row = document.createElement('div');
  row.className = 'manual-fan-row';
  row.id = 'manual-fan-row';
  row.setAttribute('role', 'group');
  element.append(spine, row);

  const ratio = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
  const covers = new Map<string, { button: HTMLButtonElement; canvas: HTMLCanvasElement; source: CanvasImageSource | null }>();
  let edges: HTMLElement[] = [];
  let ids: string[] = [];
  let activeId: string | null = null;
  let expanded = false;

  const band = (): 'bottom' | 'right' => (document.documentElement.dataset.strip === 'right' ? 'right' : 'bottom');

  // A control on screen, measured: null when it is not mounted (or there is no layout to ask).
  function measured(found: Element | null): Rect | null {
    if (!found || typeof found.getBoundingClientRect !== 'function') return null;
    const { left, top, right, bottom } = found.getBoundingClientRect();
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }

  // The row out of the pocket (src/game/screenLayout.ts), its end against the pocket's side; the spine is the CSS's.
  function place() {
    const cluster = typeof document.querySelector === 'function' ? measured(document.querySelector('.control-cluster')) : null;
    if (!cluster) return;
    const box = fanBox({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cluster,
      pocket: measured(spine),
      band: band(),
      height: coverHeight,
      gap: FAN.inset,
      margin: CLUSTER.inset,
    });
    const width = Math.min(rowLength(ids.length, FAN), box.right - box.left);
    row.style.left = `${box.right - width}px`;
    row.style.top = `${box.top}px`;
    row.style.width = `${width}px`;
  }

  // The spine's edges, across it: left upright, top in landscape.
  function lay() {
    const across = band() === 'right' ? 'top' : 'left';
    spineEdges(ids.length, pocket, FAN).forEach((at, i) => {
      const edge = edges[i];
      edge.style.left = across === 'left' ? `${at}px` : '';
      edge.style.top = across === 'top' ? `${at}px` : '';
    });
  }

  function apply() {
    element.dataset.expanded = String(expanded);
    spine.setAttribute('aria-expanded', String(expanded));
    lay();
    place();
  }

  function cover(id: string, world: FanWorld) {
    let entry = covers.get(id);
    if (!entry) {
      const button = document.createElement('button');
      button.type = 'button';
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
    entry.button.setAttribute('aria-label', id === activeId ? `${nameOf(id)}, open` : `Switch to ${nameOf(id)}`);
    if (id === activeId) entry.button.setAttribute('aria-current', 'true');
    else entry.button.removeAttribute('aria-current');
    return entry.button;
  }

  function spread() {
    if (expanded) return;
    expanded = true;
    document.addEventListener('pointerdown', outside, true);
    apply();
    // The open manual's cover, nearest the pocket at the row's end: in view and in focus.
    row.scrollLeft = row.scrollWidth;
    covers.get(activeId ?? ids[0])?.button.focus({ preventScroll: true });
  }

  function fold() {
    if (!expanded) return;
    expanded = false;
    document.removeEventListener('pointerdown', outside, true);
    // Focus in the row would be lost as it goes: back to the spine.
    const focused = typeof document.activeElement === 'undefined' ? null : document.activeElement;
    if (focused && row.contains(focused)) spine.focus({ preventScroll: true });
    apply();
  }

  // A press outside the spread row folds it and does nothing else (Ben's spec, 2026-10-23): caught on the
  // document's capture, before the room's canvas or the strip hear it, so nothing is grabbed, orbited or
  // flipped, and the click it ends in is swallowed too (a tap on the catalog thumb or the menu included).
  function outside(event: PointerEvent) {
    if (element.contains(event.target as Node | null)) return;
    event.preventDefault();
    event.stopPropagation();
    fold();
    document.addEventListener('click', swallow, true);
    // A press that never ends in a click (a drag) leaves no swallow armed for a later tap.
    document.addEventListener('pointerdown', disarm, true);
  }
  function swallow(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    disarm();
  }
  function disarm() {
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('pointerdown', disarm, true);
  }

  function choose(id: string) {
    if (!expanded) return;
    // The open manual's own cover is no switch.
    if (id !== activeId) onPick(id);
    fold();
  }

  spine.addEventListener('click', () => (expanded ? fold() : spread()));

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
  // A resize moves the row's box; a turn moves the band to the other edge, and the spine's edges cross
  // the other way. Not every browser says a turn end over end with a resize, and the insets may settle a frame later.
  const onResize = () => apply();
  window.addEventListener('resize', onResize);
  const orientation = typeof screen === 'undefined' ? undefined : screen.orientation;
  const onTurn = () => {
    apply();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  };
  orientation?.addEventListener('change', onTurn);

  return {
    element,
    /** Follows the room: one cover and one edge per world, in the room's order, the last world the open one; hidden with none. */
    refresh() {
      const all = worlds();
      ids = all.map((world) => world.id);
      activeId = all.at(-1)?.id ?? null;
      for (const [id, { button }] of covers) {
        if (ids.includes(id)) continue;
        button.remove();
        covers.delete(id);
      }
      const buttons = all.map((world) => cover(world.id, world));
      for (const button of buttons) button.remove();
      row.append(...buttons);
      for (const edge of edges) edge.remove();
      edges = ids.map((id) => {
        const edge = document.createElement('span');
        edge.className = 'manual-fan-edge';
        edge.dataset.open = String(id === activeId);
        return edge;
      });
      spine.append(...edges);
      const label = fanLabel(ids.length);
      spine.setAttribute('aria-label', label);
      row.setAttribute('aria-label', label);
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
      orientation?.removeEventListener('change', onTurn);
      document.removeEventListener('pointerdown', outside, true);
      disarm();
      element.remove();
    },
  };
}
