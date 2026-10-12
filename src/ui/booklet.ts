import { BOOKLET, BOOKLET_UI, CATALOG, COLORS, GESTURE } from '../constants.js';
import { fanOffset, STACK_SLOT } from '../game/cornerStack.js';

// The booklet in hand: a bottom sheet over the room. Collapsed, it is a thumbnail of the
// open page in the corner — the only thing it puts under a finger, so the room stays
// free. Tapped, it opens: one page at a time, flipped by a horizontal swipe, the arrow
// buttons or the arrow keys, closed by a tap on it, its handle, a swipe down, or Escape:
// swipe to flip, tap to put it down. It flips freely, front to back and back again:
// reference, never a checklist. The game opens with it in hand, on its cover. While it is
// open, a scrim over the room takes any tap outside the sheet, puts the booklet down with
// it and swallows it whole. Follows the src/ui pattern (own element, own style, colours
// from COLORS).

const STYLE_ID = 'skruv-booklet';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
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
      transition: width 160ms ease-out;
    }
    /* A mouse over the docked thumbnail grows it from its corner to a readable page,
       about a quarter of the screen, raised over the other thumb in the corner stack (the
       catalog's would grow behind the manual's) — still under the scrim (2) and the sheet (3).
       Hover-capable pointers only: a touch never hovers. */
    @media (hover: hover) {
      .booklet-thumb:hover {
        width: min(${BOOKLET_UI.thumbHoverShare * 100}vw, ${BOOKLET_UI.thumbHoverShare * 100}vh * ${pageW} / ${pageH});
        z-index: 1;
      }
    }
    .booklet-scrim {
      position: fixed;
      inset: 0;
      z-index: 2;
      touch-action: none;
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
      z-index: 3;
    }
    .booklet[data-open='true'] {
      transform: translate(-50%, 0);
      transition: transform 220ms ease-out;
      visibility: visible;
    }
    @media (prefers-reduced-motion: reduce) {
      .booklet, .booklet[data-open='true'], .booklet-thumb { transition: none; }
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
      max-height: calc(${BOOKLET_UI.maxHeight * 100}dvh - ${BOOKLET_UI.chromeHeight}px);
      aspect-ratio: ${pageW} / ${pageH};
      border-radius: 6px;
      background: ${css(COLORS.bookletPaper)};
    }
    .booklet-controls {
      order: 1;
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
    /* A line that says something went wrong (a pick that would not build): over the controls,
       in the sheet's own text colour, until the page flips or the sheet closes. */
    .booklet-notice { margin: 0; text-align: center; font-size: 14px; line-height: 1.3; }
    /* A page with a control on it (the catalog's BUILD IT): the canvas and, over the part of
       it the control is drawn on, a clear button placed in page fractions. The frame is sized
       exactly as the page (the pre-splash's own fit) and the canvas fills it, so those
       fractions land on the drawn page at any size. */
    .booklet-frame {
      position: relative;
      display: block;
      width: min(100%, ${pageW}px, calc((${BOOKLET_UI.maxHeight * 100}dvh - ${BOOKLET_UI.chromeHeight}px) * ${pageW} / ${pageH}));
      aspect-ratio: ${pageW} / ${pageH};
      line-height: 0;
    }
    .booklet-frame canvas { width: 100%; height: 100%; max-height: none; }
    .booklet-action {
      position: absolute;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
  `;
  document.head.append(style);
}

// Every sheet on the page (the catalog and the current manual): one is open at a time. While
// any is open, every docked thumb is inert — out of the tab order and deaf to clicks — so the
// keyboard can't open a second sheet under the first's scrim, and a key never drives two.
const sheets = new Set<{ isOpen(): boolean; thumb: HTMLButtonElement }>();
function syncSheets() {
  const anyOpen = [...sheets].some((sheet) => sheet.isOpen());
  for (const { thumb } of sheets) thumb.inert = anyOpen;
}

/** A control laid over a page — the catalog's BUILD IT: what it is called, and what it does. */
export interface PageAction {
  label: string;
  run(): void;
}

/** What `createBookletSheet` takes — see there. */
export interface BookletSheetOptions {
  pages: { count: number; canvas(index: number): CanvasImageSource };
  /** What the sheet is, for its accessible names: 'instructions' by default, 'catalog'. */
  name?: string;
  /** Whether it starts open, on its cover (default) — or docked as a thumb. */
  open?: boolean;
  /** Its place in the corner stack (STACK_SLOT): the manual in front by default, each further one fanned out behind it (CATALOG.stack). */
  slot?: number;
  /** Whether it may be put down now. While false, every way of closing it does nothing. */
  canClose?: () => boolean;
  /** A control on a page: `at(page)` names it, or null for none; it sits over `rect`, its corners rounded by `radius` (page pixels). */
  action?: { rect: readonly [number, number, number, number]; radius: number; at(page: number): PageAction | null };
}

/**
 * The booklet sheet for `pages` (`{ count, canvas(index) }`, src/scene/bookletPages.ts or
 * src/scene/catalogPages.ts). Returns `{ scrim, thumb, element, currentPage, expanded,
 * onChange(fn), setOpen(value), place(), dispose() }`: mount all three elements;
 * `onChange(fn)` calls `fn({ page, expanded })` whenever either changes; `setOpen` opens or
 * docks it from outside; `place()` re-applies its stack slot after a ?tune change;
 * `dispose()` takes it all back off the page. Starts open on page 0, the cover, unless told
 * otherwise — or another sheet is open: one sheet is open at a time. State is the module's own and read-only outside it.
 */
export function createBookletSheet({ pages, name = 'instructions', open: startsOpen = true, slot = STACK_SLOT.manual, canClose = () => true, action }: BookletSheetOptions) {
  injectStyle();
  const listeners = new Set<(state: { page: number; expanded: boolean }) => void>();
  let page = 0;
  let open = startsOpen;
  // Asked to start open while another sheet is: it starts docked (one open at a time).
  if ([...sheets].some((sheet) => sheet.isOpen())) open = false;
  let lingering: ReturnType<typeof setTimeout> | null = null;

  // Over the whole room — canvas and buttons alike — and under the sheet, while the
  // booklet is open.
  const scrim = document.createElement('div');
  scrim.className = 'booklet-scrim';
  scrim.setAttribute('aria-hidden', 'true');

  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'booklet-thumb';
  thumb.setAttribute('aria-label', `Open the ${name}`);
  // Full page resolution: hovered, the thumbnail is read at up to a quarter of the screen.
  const thumbCanvas = pageCanvas(pageW, pageH);
  thumb.append(thumbCanvas);

  const element = document.createElement('section');
  element.className = 'booklet';
  element.setAttribute('aria-label', name[0].toUpperCase() + name.slice(1));

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'booklet-handle';
  handle.setAttribute('aria-label', `Close the ${name}`);

  const view = document.createElement('div');
  view.className = 'booklet-page';
  const viewCanvas = pageCanvas(pageW, pageH);
  viewCanvas.setAttribute('role', 'img');
  // A page control rides on the canvas in a frame of its own; a sheet without one keeps the
  // canvas straight in the view.
  const actionButton = action ? button('', '') : null;
  if (action && actionButton) {
    const frame = document.createElement('div');
    frame.className = 'booklet-frame';
    actionButton.className = 'booklet-action';
    const [x, y, w, h] = action.rect;
    // Its corners as the drawn tag's: the radius as a share of the button's own width and height.
    const r = action.radius;
    Object.assign(actionButton.style, {
      left: `${(100 * x) / pageW}%`,
      top: `${(100 * y) / pageH}%`,
      width: `${(100 * w) / pageW}%`,
      height: `${(100 * h) / pageH}%`,
      borderRadius: `${(100 * r) / w}% / ${(100 * r) / h}%`,
    });
    actionButton.addEventListener('click', () => action.at(page)?.run());
    frame.append(viewCanvas, actionButton);
    view.append(frame);
  } else view.append(viewCanvas);

  const controls = document.createElement('div');
  controls.className = 'booklet-controls';
  const prev = button('‹', 'Previous page');
  const next = button('›', 'Next page');
  const count = document.createElement('span');
  count.className = 'booklet-count';
  count.setAttribute('aria-live', 'polite');
  controls.append(prev, count, next);
  // Last in the DOM, so the sheet's children keep their places; shown above the controls (CSS order).
  const notice = document.createElement('p');
  notice.className = 'booklet-notice';
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  element.append(handle, view, controls, notice);

  /** Shows `text` on the sheet, or takes it away (null). */
  function notify(text: string | null) {
    notice.textContent = text ?? '';
    notice.hidden = text === null;
  }

  function render() {
    const source = pages.canvas(page);
    for (const target of open ? [viewCanvas, thumbCanvas] : [thumbCanvas]) {
      // A canvas always gives a 2D context the first time it is asked.
      const ctx = target.getContext('2d')!;
      ctx.drawImage(source, 0, 0, target.width, target.height);
    }
    count.textContent = `${page + 1} / ${pages.count}`;
    viewCanvas.setAttribute('aria-label', `Page ${page + 1} of ${pages.count}`);
    prev.disabled = page === 0;
    next.disabled = page === pages.count - 1;
    element.dataset.open = String(open);
    thumb.hidden = open;
    if (action && actionButton) {
      const control = action.at(page);
      actionButton.hidden = !control;
      actionButton.setAttribute('aria-label', control?.label ?? '');
    }
    syncSheets();
    for (const fn of listeners) fn({ page, expanded: open });
  }

  const flip = (by: number) => {
    const to = Math.min(pages.count - 1, Math.max(0, page + by));
    if (to === page) return;
    page = to;
    notify(null);
    render();
  };

  // The scrim is up whenever the booklet is open. Put down by a tap, on the room or the
  // sheet, it stays `linger` ms past the lift, so the click a touch synthesises lands on
  // it too rather than on a button underneath.
  function showScrim(shown: boolean, linger = 0) {
    clearTimeout(lingering ?? undefined);
    if (shown || linger === 0) scrim.hidden = !shown;
    else lingering = setTimeout(() => (scrim.hidden = true), linger);
  }

  function setOpen(value: boolean, { byRoomTap = false } = {}) {
    if (open === value || (!value && !canClose())) return;
    // One sheet open at a time: another one open keeps this one docked.
    if (value && [...sheets].some((sheet) => sheet !== self && sheet.isOpen())) return;
    open = value;
    notify(null);
    showScrim(open, byRoomTap ? BOOKLET_UI.scrimLingerMs : 0);
    render();
    // Into the sheet on a control that can take focus (a disabled one can't, on the last
    // or first page), back to the thumb on close — unless the close was a tap.
    if (byRoomTap) return;
    const inside = [next, prev, handle].find((control) => !control.disabled);
    // The handle is never disabled, so there is always one.
    (open ? inside! : thumb).focus({ preventScroll: true });
  }

  // The tap that puts the booklet down. Captured, so a finger that slides onto the sheet
  // still ends here; the room never sees its pointerdown, so nothing is grabbed or orbited.
  // Only a press that began on the scrim counts: a mouse pressed on the sheet and released
  // off it lifts over the scrim too, uncaptured. A tap while the scrim lingers over the
  // closed booklet is swallowed and does nothing.
  const pressed = new Set<number>();
  scrim.addEventListener('pointerdown', (event) => {
    pressed.add(event.pointerId);
    scrim.setPointerCapture(event.pointerId);
  });
  scrim.addEventListener('pointercancel', (event) => pressed.delete(event.pointerId));
  scrim.addEventListener('pointerup', (event) => {
    if (!pressed.delete(event.pointerId) || !open) return;
    setOpen(false, { byRoomTap: true });
  });

  // A tap on the sheet puts it down too, exactly as a tap on the room does: a primary press
  // off its buttons (handle, arrows — they keep their own job, disabled or not) that lifts
  // within the GESTURE tap thresholds. Anything that travels further is a swipe — a flip, a
  // close, or nothing — never a tap.
  let sheetPress: { id: number; x: number; y: number; t: number } | null = null;
  element.addEventListener('pointerdown', (event) => {
    // A pointer event on the sheet comes from an element inside it.
    const onButton = (event.target as Element).closest('button');
    sheetPress = event.button === 0 && !onButton
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp }
      : null;
  });
  const endSheetPress = (event: PointerEvent) => {
    if (!sheetPress || event.pointerId !== sheetPress.id) return;
    const { x, y, t } = sheetPress;
    sheetPress = null;
    if (event.type !== 'pointerup' || !open) return;
    const still = Math.hypot(event.clientX - x, event.clientY - y) <= GESTURE.tapMaxDistance;
    if (still && event.timeStamp - t <= GESTURE.tapMaxMs) setOpen(false, { byRoomTap: true });
  };
  element.addEventListener('pointerup', endSheetPress);
  element.addEventListener('pointercancel', endSheetPress);

  thumb.addEventListener('click', () => setOpen(true));
  handle.addEventListener('click', () => setOpen(false));
  prev.addEventListener('click', () => flip(-1));
  next.addEventListener('click', () => flip(1));

  // Swipe on the page: across flips, down closes.
  let swipe: { id: number; x: number; y: number } | null = null;
  view.addEventListener('pointerdown', (event) => {
    // A press on a page control is that control's: no swipe, no capture that would take its click.
    if ((event.target as Element).closest('button')) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    view.setPointerCapture(event.pointerId);
  });
  const endSwipe = (event: PointerEvent) => {
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

  function onKey(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'ArrowLeft') flip(-1);
    else if (event.key === 'ArrowRight') flip(1);
    else if (event.key === 'Escape') setOpen(false);
  }
  window.addEventListener('keydown', onKey);

  // Its place in the corner stack: the front one where the thumb has always sat, each one
  // behind it fanned up and over by CATALOG.stack, read at use time so ?tune moves it live.
  // Paint order is mount order: mount the back ones first.
  function place() {
    if (slot === STACK_SLOT.manual) return;
    const { x, y, turn } = fanOffset(slot, CATALOG.stack);
    thumb.style.transform = `translate(${x}px, ${y}px) rotate(${turn}rad)`;
  }

  const self = { isOpen: () => open, thumb };
  sheets.add(self);

  place();
  showScrim(open);
  render();

  return {
    scrim,
    thumb,
    element,
    get currentPage() {
      return page;
    },
    get expanded() {
      return open;
    },
    /** Opens it, or docks it — as its own controls do, focus and all; `canClose` still holds. */
    setOpen(value: boolean) {
      setOpen(value);
    },
    place,
    notify,
    onChange(fn: (state: { page: number; expanded: boolean }) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Takes the booklet off the page: its three elements, its window key listener and any lingering scrim timer. */
    dispose() {
      clearTimeout(lingering ?? undefined);
      window.removeEventListener('keydown', onKey);
      sheets.delete(self);
      syncSheets();
      listeners.clear();
      scrim.remove();
      thumb.remove();
      element.remove();
    },
  };
}

function pageCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function button(label: string, name: string) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-label', name);
  return element;
}
