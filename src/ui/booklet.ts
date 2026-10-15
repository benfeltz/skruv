import { BOOKLET, BOOKLET_UI, CATALOG, COLORS, GESTURE } from '../constants.js';
import { fanOffset, STACK_SLOT } from '../game/cornerStack.js';
import { pageMarks } from '../game/catalogLayout.js';

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
const LEAF_STYLE_ID = 'skruv-booklet-leaf';

// The page look's own rules, in a style element of their own so the sheet's stay as they
// were: the page alone — no surface, handle or control bar — centred over the room, its
// frame shadowed, the thumb it grows out of docked in the upper left. Closed, the element
// is scaled down to the thumb and moved onto its corner by an inline transform (`settle`);
// open it is centred at full size, and the transition between is the grow.
function injectLeafStyle() {
  if (document.getElementById(LEAF_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LEAF_STYLE_ID;
  const { shadow, gutter, growMs } = BOOKLET_UI.page;
  style.textContent = `
    .booklet-thumb[data-corner='topLeft'] {
      top: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-top));
      bottom: auto;
    }
    .booklet-leaf {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: 3;
      transform-origin: 0 0;
      width: min(calc(100vw - ${2 * gutter}px), ${pageW}px, calc(${BOOKLET_UI.maxHeight * 100}dvh * ${pageW} / ${pageH}));
      color: ${css(COLORS.uiText)};
      font: 600 15px/1 system-ui, -apple-system, sans-serif;
      transition: transform ${growMs}ms ease-out, visibility 0s linear ${growMs}ms;
      visibility: hidden;
    }
    .booklet-leaf[data-open='true'] {
      transition: transform ${growMs}ms ease-out;
      visibility: visible;
    }
    @media (prefers-reduced-motion: reduce) {
      .booklet-leaf, .booklet-leaf[data-open='true'] { transition: none; }
    }
    .booklet-leaf .booklet-frame {
      width: 100%;
      border-radius: 6px;
      box-shadow: ${shadow};
    }
    .booklet-leaf button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
    /* Still a button, for a keyboard or a screen reader to put the page down; unseen. */
    .booklet-close {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      border: 0;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `;
  document.head.append(style);
}

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
      transition: width 160ms ease-out, z-index 0s;
    }
    /* A mouse resting on the docked thumbnail grows it from its corner to a readable page,
       about a quarter of the screen, raised over the other thumb in the corner stack (the
       catalog's would grow behind the manual's) — still under the scrim (2) and the sheet (3).
       Grow and raise both wait thumbHoverDelayMs, so a pointer passing over on its way
       elsewhere changes nothing; leaving undoes them at once. Hover-capable pointers only: a
       touch never hovers. */
    @media (hover: hover) {
      .booklet-thumb:hover {
        width: min(${BOOKLET_UI.thumbHoverShare * 100}vw, ${BOOKLET_UI.thumbHoverShare * 100}vh * ${pageW} / ${pageH});
        z-index: 1;
        transition: width 160ms ease-out ${BOOKLET_UI.thumbHoverDelayMs}ms, z-index 0s ${BOOKLET_UI.thumbHoverDelayMs}ms;
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
      /* No growing animation, but still the wait: a passing pointer grows nothing. */
      .booklet-thumb:hover { transition: width 0s ${BOOKLET_UI.thumbHoverDelayMs}ms, z-index 0s ${BOOKLET_UI.thumbHoverDelayMs}ms; }
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
    /* A line that says something went wrong (a pick that would not build), laid over the
       head of the page rather than added to the sheet, so it never pushes the controls off a
       short screen; there until the page flips or the sheet closes. At the head it is rows
       away from the only thing on a page that takes a tap (BUILD IT, near the foot), and it
       takes no pointer itself, so even a page drawn tiny never has it swallow a tap. */
    .booklet-page { position: relative; }
    .booklet-notice {
      position: absolute;
      left: ${BOOKLET_UI.notice.inset}px;
      right: ${BOOKLET_UI.notice.inset}px;
      top: ${BOOKLET_UI.notice.inset}px;
      pointer-events: none;
      margin: 0;
      padding: ${BOOKLET_UI.notice.padding}px;
      border-radius: ${BOOKLET_UI.notice.radius}px;
      background: ${css(COLORS.uiSurface)};
      text-align: center;
      font-size: ${BOOKLET_UI.notice.size}px;
      line-height: ${BOOKLET_UI.notice.lineHeight};
    }
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
type LiveSheet = { isOpen(): boolean; thumb: HTMLButtonElement };
const sheets = new Set<LiveSheet>();
/** Whether any live sheet but `except` is open. */
const anyOpen = (except?: LiveSheet) => [...sheets].some((sheet) => sheet !== except && sheet.isOpen());
function syncSheets() {
  const inert = anyOpen();
  for (const { thumb } of sheets) thumb.inert = inert;
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
  /** Its place in the corner stack (STACK_SLOT): the manual in front by default, fanned toward the room; the catalog behind, in the corner (src/game/cornerStack.ts). */
  slot?: number;
  /** How it is shown open: 'sheet' (default, the manual) — a dark bottom sheet with a handle and a control bar — or 'page' (the catalog): the page alone, its number and arrows printed on it, growing out of its docked thumb. Every behaviour is the same in both. */
  look?: 'sheet' | 'page';
  /** Which screen corner its docked thumb sits in: 'bottomLeft' (default) or 'topLeft'. */
  corner?: 'bottomLeft' | 'topLeft';
  /** Whether it may be put down now. While false, every way of closing it does nothing. */
  canClose?: () => boolean;
  /** What its docked thumb shows: the open page (default, the manual), or always its cover (the catalog, a brand object in the corner). */
  thumbShows?: 'page' | 'cover';
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
export function createBookletSheet({ pages, name = 'instructions', open: startsOpen = true, slot = STACK_SLOT.manual, canClose = () => true, action, thumbShows = 'page', look = 'sheet', corner = 'bottomLeft' }: BookletSheetOptions) {
  injectStyle();
  // The look decides what is built and how it settles; every handler below is the same for both.
  const leaf = look === 'page';
  if (leaf) injectLeafStyle();
  const listeners = new Set<(state: { page: number; expanded: boolean }) => void>();
  let page = 0;
  let open = startsOpen;
  // Asked to start open while another sheet is: it starts docked (one open at a time).
  if (anyOpen()) open = false;
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
  thumb.dataset.corner = corner;
  // Full page resolution: hovered, the thumbnail is read at up to a quarter of the screen.
  const thumbCanvas = pageCanvas(pageW, pageH);
  thumb.append(thumbCanvas);

  const element = document.createElement('section');
  element.className = leaf ? 'booklet-leaf' : 'booklet';
  element.setAttribute('aria-label', name[0].toUpperCase() + name.slice(1));

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = leaf ? 'booklet-close' : 'booklet-handle';
  handle.setAttribute('aria-label', `Close the ${name}`);

  const view = document.createElement('div');
  view.className = 'booklet-page';
  const viewCanvas = pageCanvas(pageW, pageH);
  viewCanvas.setAttribute('role', 'img');
  // The arrows: a control bar under the page, or printed in the page's corners. A page
  // control rides on the canvas in a frame of its own; a sheet without one keeps the canvas
  // straight in the view. `showAction` shows the open page's control, or hides it.
  const arrows = leaf ? cornerArrows() : controlBar();
  const { prev, next } = arrows;
  let showAction = () => {};
  if (action || leaf) {
    const frame = document.createElement('div');
    frame.className = 'booklet-frame';
    frame.append(viewCanvas);
    if (action) {
      const actionButton = button('', '');
      actionButton.className = 'booklet-action';
      // Its corners as the drawn tag's: the radius as a share of the button's own width and height.
      overlay(actionButton, action.rect, action.radius);
      actionButton.addEventListener('click', () => action.at(page)?.run());
      frame.append(actionButton);
      showAction = () => {
        const control = action.at(page);
        actionButton.hidden = !control;
        actionButton.setAttribute('aria-label', control?.label ?? '');
      };
    }
    if (leaf) frame.append(prev, next);
    view.append(frame);
  } else view.append(viewCanvas);

  // Over the head of the page, after the page itself, so the view's children keep their places.
  const notice = document.createElement('p');
  notice.className = 'booklet-notice';
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  view.append(notice);
  element.append(handle, view);
  if (arrows.bar) element.append(arrows.bar);

  /** Shows `text` on the sheet, or takes it away (null). */
  function notify(text: string | null) {
    notice.textContent = text ?? '';
    notice.hidden = text === null;
  }

  function render() {
    // A canvas always gives a 2D context the first time it is asked.
    const draw = (target: HTMLCanvasElement, index: number) => target.getContext('2d')!.drawImage(pages.canvas(index), 0, 0, target.width, target.height);
    if (open) draw(viewCanvas, page);
    draw(thumbCanvas, thumbShows === 'cover' ? 0 : page);
    viewCanvas.setAttribute('aria-label', `Page ${page + 1} of ${pages.count}`);
    arrows.paint(page, pages.count);
    element.dataset.open = String(open);
    // A sheet takes the thumb's place; the page grows out of it and puts it back.
    thumb.hidden = open && !leaf;
    if (leaf) settle();
    showAction();
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
    if (value && anyOpen(self)) return;
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

  // The page look's pose (the grow): open, centred at full size; docked, shrunk to the
  // thumb's width and moved so its top-left corner lands on the thumb's — measured at each
  // render, so a resize is picked up by the next open or close.
  function settle() {
    const width = element.offsetWidth || 0;
    const scale = width > 0 ? BOOKLET_UI.thumbWidth / width : 1;
    const inset = `${BOOKLET_UI.cornerInset}px`;
    element.style.transform = open
      ? 'translate(-50%, -50%)'
      : `translate(calc(${inset} + env(safe-area-inset-left) - 50vw), calc(${inset} + env(safe-area-inset-top) - 50vh)) scale(${scale})`;
  }

  // Its place in the corner stack (src/game/cornerStack.ts): the front one fanned up and
  // right toward the room, the ones behind it in the corner, turned — read at use time so
  // ?tune moves it live. Paint order is mount order: mount the back ones first.
  function place() {
    const { x, y, turn } = fanOffset(slot, CATALOG.stack);
    thumb.style.transform = `translate(${x}px, ${y}px) rotate(${turn}rad)`;
  }

  const self: LiveSheet = { isOpen: () => open, thumb };
  sheets.add(self);

  /** Takes the booklet off the page: its three elements, its place among the live sheets, its window key listener and any lingering scrim timer. */
  function dispose() {
    clearTimeout(lingering ?? undefined);
    window.removeEventListener('keydown', onKey);
    sheets.delete(self);
    syncSheets();
    listeners.clear();
    scrim.remove();
    thumb.remove();
    element.remove();
  }

  // The first render draws the open page (a WebGL render for a cover). If it throws, the
  // sheet takes itself back out — registry entry and key listener — before the error goes on,
  // since the caller never got a sheet to dispose.
  try {
    place();
    showScrim(open);
    render();
  } catch (error) {
    dispose();
    throw error;
  }

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
    dispose,
  };
}

function pageCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Lays `control` over a page rect `[x, y, w, h]` in page fractions, its corners rounded by `radius` (page pixels) as a share of its own width and height. */
function overlay(control: HTMLElement, [x, y, w, h]: readonly [number, number, number, number], radius: number) {
  Object.assign(control.style, {
    left: `${(100 * x) / pageW}%`,
    top: `${(100 * y) / pageH}%`,
    width: `${(100 * w) / pageW}%`,
    height: `${(100 * h) / pageH}%`,
    borderRadius: `${(100 * radius) / w}% / ${(100 * radius) / h}%`,
  });
}

/** The sheet look's controls: ‹ n / N ›, a bar under the page; an arrow disabled at its end. */
function controlBar() {
  const bar = document.createElement('div');
  bar.className = 'booklet-controls';
  const prev = button('‹', 'Previous page');
  const next = button('›', 'Next page');
  const count = document.createElement('span');
  count.className = 'booklet-count';
  count.setAttribute('aria-live', 'polite');
  bar.append(prev, count, next);
  return {
    bar: bar as HTMLElement | null,
    prev,
    next,
    paint(page: number, total: number) {
      count.textContent = `${page + 1} / ${total}`;
      prev.disabled = page === 0;
      next.disabled = page === total - 1;
    },
  };
}

/**
 * The page look's controls: a clear button over each arrow printed in a lower corner of
 * the page (CATALOG.page.prev / .next, src/scene/catalogPages.ts draws them), none of its
 * own to show. At an end the arrow is not drawn and its button is hidden and disabled —
 * the page's own marks say which (src/game/catalogLayout.ts `pageMarks`).
 */
function cornerArrows() {
  const { prev: prevRect, next: nextRect } = CATALOG.page;
  const prev = button('', CATALOG.words.prev);
  const next = button('', CATALOG.words.next);
  for (const [control, rect] of [[prev, prevRect], [next, nextRect]] as const) {
    control.className = 'booklet-action';
    overlay(control, rect, 0);
  }
  return {
    bar: null as HTMLElement | null,
    prev,
    next,
    paint(page: number, total: number) {
      const marks = pageMarks(page, total);
      prev.hidden = prev.disabled = !marks.prev;
      next.hidden = next.disabled = !marks.next;
    },
  };
}

function button(label: string, name: string) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-label', name);
  return element;
}
