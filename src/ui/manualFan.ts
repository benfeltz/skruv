import { BOOKLET, BOOKLET_UI, CLUSTER, COLORS, FAN, GESTURE, RENDER } from '../constants.js';
import { fanLabel, pressOutcome, rowLength, spineEdges } from '../game/manualFan.js';
import { fanBox, type Rect } from '../game/screenLayout.js';
import { BAND } from './booklet.js';

// The manuals' pocket (1.9.9.3, option B; Ben, 2026-10-23): the manual's band's far end — the right
// end upright, the foot in landscape — holds every world's manual. At rest it is a spine, only the
// covers' edges, the open manual's on top in gold. A tap on it brings every cover out as a row (above
// the band upright, leftward into the room in landscape), the open one nearest the pocket; a tap on
// another cover is the caller's pick, and the row folds back. Two states, spine and spread.
// It draws the covers the worlds hand out and asks nothing else of them: a kept world is never touched.
//
// The clear (1.9.9.6; Ben, 2026-10-23): the open cover, spread, wears an X badge (a marker, never a
// button) and the whole cover takes a hold. One press, three outcomes (src/game/manualFan.ts's
// pressOutcome): released inside GESTURE.tapMaxMs it is a tap and folds; released later it is a cancel
// and the row stays spread; held for FAN.clearHoldMs it is the caller's clear. While held the border runs
// gold to red and the badge's ring fills, both only after the tap time, so a tap never flashes red.
// The hold's one timer is the only timer here.

const STYLE_ID = 'skruv-manual-fan';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;
const coverHeight = Math.round((FAN.cover * pageH) / pageW);
const { pocket, name, rule } = BOOKLET_UI.strip;
// The hold's red fill: it waits out the tap time, then runs to the clear, so it is full the moment the
// item goes (as Repack's bar is full at its timer).
const fillMs = FAN.clearHoldMs - GESTURE.tapMaxMs;
// The badge sits this far in from the cover's corner, its ring as far out around it.
const badgeInset = 4;
// The ring's circle (r 16 in a 36 viewBox): its circumference, the dash it fills along.
const RING = (2 * Math.PI * 16).toFixed(1);
// The X and its ring, drawn once per badge.
const BADGE_SVG =
  '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>' +
  '<svg class="manual-fan-ring" aria-hidden="true" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg>';

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
      position: relative;
      border-color: ${css(COLORS.uiAccent)};
      box-shadow: 0 0 0 1px ${css(COLORS.uiAccent)}, 0 4px 14px #0007;
      -webkit-touch-callout: none;
      transition: border-color 120ms, box-shadow 120ms;
    }
    /* Held: gold to red over the hold, starting after the tap time, so a tap never flashes red, and red
       the moment it clears; let go and it snaps back (the 120 ms above). */
    .manual-fan-cover[aria-current='true'][data-holding='true'] {
      border-color: ${css(COLORS.uiDanger)};
      box-shadow: 0 0 0 1px ${css(COLORS.uiDanger)}, 0 4px 14px #0007;
      transition: border-color ${fillMs}ms linear ${GESTURE.tapMaxMs}ms, box-shadow ${fillMs}ms linear ${GESTURE.tapMaxMs}ms;
    }
    /* The X badge, at the open cover's outer corner: top-right upright, top-left in landscape. Inside the
       cover's box, which clips. A marker: the whole cover is the target. */
    .manual-fan-badge {
      position: absolute;
      top: ${badgeInset}px;
      right: ${badgeInset}px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${FAN.badge}px;
      height: ${FAN.badge}px;
      border-radius: 50%;
      background: ${css(COLORS.uiText)};
      color: ${css(COLORS.bookletInk)};
      box-shadow: 0 0 0 2px ${css(COLORS.bookletInk)};
      pointer-events: none;
    }
    ${landscape} .manual-fan-badge { right: auto; left: ${badgeInset}px; }
    .manual-fan-badge svg { display: block; }
    .manual-fan-ring {
      position: absolute;
      inset: -${badgeInset}px;
      width: ${FAN.badge + 2 * badgeInset}px;
      height: ${FAN.badge + 2 * badgeInset}px;
      transform: rotate(-90deg);
    }
    .manual-fan-ring circle {
      fill: none;
      stroke: ${css(COLORS.uiDanger)};
      stroke-width: 3;
      stroke-dasharray: ${RING};
      stroke-dashoffset: ${RING};
      transition: stroke-dashoffset 120ms;
    }
    .manual-fan-cover[data-holding='true'] .manual-fan-badge { color: ${css(COLORS.uiDanger)}; }
    .manual-fan-cover[data-holding='true'] .manual-fan-ring circle {
      stroke-dashoffset: 0;
      transition: stroke-dashoffset ${fillMs}ms linear ${GESTURE.tapMaxMs}ms;
    }
    .manual-fan-cover canvas { display: block; width: 100%; height: 100%; }
    .manual-fan-cover:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .manual-fan-row, .manual-fan[data-expanded='false'] .manual-fan-row { transition: none; }
      /* The border still turns red on a hold, at once; the ring shows it full. */
      .manual-fan-cover[aria-current='true'], .manual-fan-cover[aria-current='true'][data-holding='true'],
      .manual-fan-ring circle, .manual-fan-cover[data-holding='true'] .manual-fan-ring circle { transition: none; }
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
 * A hold on the open cover (pointer, or Enter / Space held) calls `onHold(id, true)` as it starts and
 * `onHold(id, false)` as it ends however it ends, and `onClear(id)` when it runs the full FAN.clearHoldMs
 * (the row folds first); a hold on a kept cover does nothing.
 */
export function createManualFan({
  worlds,
  nameOf,
  onPick,
  onClear = () => undefined,
  onHold = () => undefined,
}: {
  worlds(): readonly FanWorld[];
  nameOf(id: string): string;
  onPick(id: string): void;
  /** The full hold ran on the open cover: clear it (main's clearItem). */
  onClear?(id: string): void;
  /** A hold on the open cover began (true) or ended, however it ended (false): main dims the world's parts. */
  onHold?(id: string, holding: boolean): void;
}) {
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
  const covers = new Map<string, { button: HTMLButtonElement; canvas: HTMLCanvasElement; source: CanvasImageSource | null; badge: HTMLElement | null }>();
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
      entry = { button, canvas, source: null, badge: null };
      covers.set(id, entry);
    }
    // Drawn once per cover: again only if the world handed out a different canvas (a rebuilt world).
    const source = world.cover();
    if (entry.source !== source) {
      entry.canvas.getContext('2d')!.drawImage(source, 0, 0, entry.canvas.width, entry.canvas.height);
      entry.source = source;
    }
    entry.button.setAttribute('aria-label', id === activeId ? `${nameOf(id)}, open — hold to clear` : `Switch to ${nameOf(id)}`);
    if (id === activeId) {
      entry.button.setAttribute('aria-current', 'true');
      if (!entry.badge) {
        entry.badge = document.createElement('span');
        entry.badge.className = 'manual-fan-badge';
        entry.badge.setAttribute('aria-hidden', 'true');
        entry.badge.innerHTML = BADGE_SVG;
        entry.button.append(entry.badge);
      }
    } else {
      entry.button.removeAttribute('aria-current');
      entry.badge?.remove();
      entry.badge = null;
      delete entry.button.dataset.holding;
    }
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
    stopHold();
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

  // The hold on the open cover: one timer at a time (the Repack pattern, src/ui/resetButton.ts).
  let hold: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  function startHold(id: string) {
    if (hold || !expanded || id !== activeId) return;
    const button = covers.get(id)?.button;
    if (button) button.dataset.holding = 'true';
    onHold(id, true);
    hold = {
      id,
      timer: setTimeout(() => {
        stopHold();
        press = null;
        keyHold = null;
        fold();
        onClear(id);
      }, FAN.clearHoldMs),
    };
  }
  function stopHold() {
    if (!hold) return;
    const { id, timer } = hold;
    hold = null;
    clearTimeout(timer);
    const button = covers.get(id)?.button;
    if (button) button.dataset.holding = 'false';
    onHold(id, false);
  }
  const thresholds = { ...GESTURE, holdMs: FAN.clearHoldMs };
  const coverId = (event: Event) => (event.target as Element | null)?.closest('button')?.dataset.id;

  // A tap, by the thresholds the rest of the screen uses; a press that travels is the row's scroll
  // (the browser takes a touch for a pan and cancels it), never a pick, and never a clear.
  let press: { pointerId: number; x: number; y: number; t: number } | null = null;
  row.addEventListener('pointerdown', (event) => {
    if (press !== null) return;
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
    const id = coverId(event);
    if (id) startHold(id);
  });
  row.addEventListener('pointermove', (event) => {
    if (press && hold && Math.hypot(event.clientX - press.x, event.clientY - press.y) > GESTURE.tapMaxDistance) stopHold();
  });
  row.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { x, y, t } = press;
    press = null;
    const id = coverId(event);
    const outcome = pressOutcome({ heldMs: event.timeStamp - t, distance: Math.hypot(event.clientX - x, event.clientY - y) }, thresholds);
    // A cancel (or a swipe) leaves the row spread: the player backed out, nothing moves under the finger.
    stopHold();
    if (outcome === 'tap' && id) choose(id);
  });
  row.addEventListener('pointercancel', () => {
    press = null;
    stopHold();
  });
  // A long press is a hold here, not a context menu.
  row.addEventListener('contextmenu', (event) => event.preventDefault());

  // Enter or Space held on the open cover is the same hold. Its keydown is prevented, so the browser makes
  // no click of it (Enter would click at once, and again on every repeat); its keyup decides, as a pointer's
  // up does. `keyed` swallows the one keyboard click that may still follow a key hold.
  let keyHold: { t: number } | null = null;
  let keyed = false;
  const isActivation = (event: KeyboardEvent) => event.key === 'Enter' || event.key === ' ';
  row.addEventListener('keydown', (event) => {
    if (!isActivation(event) || coverId(event) !== activeId || !expanded) return;
    event.preventDefault();
    if (event.repeat || keyHold) return;
    keyed = true;
    keyHold = { t: event.timeStamp };
    startHold(activeId!);
  });
  row.addEventListener('keyup', (event) => {
    if (!isActivation(event) || !keyHold) return;
    const { t } = keyHold;
    keyHold = null;
    const outcome = pressOutcome({ heldMs: event.timeStamp - t, distance: 0 }, thresholds);
    stopHold();
    if (outcome === 'tap' && activeId) choose(activeId);
  });
  row.addEventListener('focusout', () => {
    keyHold = null;
    if (!press) stopHold();
  });
  // A key press on a focused cover arrives as a click with no pointer (detail 0); a pointer's own click is handled above.
  row.addEventListener('click', (event) => {
    const id = coverId(event);
    if (event.detail !== 0 || !id) return;
    if (id === activeId && keyed) {
      keyed = false;
      return;
    }
    choose(id);
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
      stopHold();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      orientation?.removeEventListener('change', onTurn);
      document.removeEventListener('pointerdown', outside, true);
      disarm();
      element.remove();
    },
  };
}
