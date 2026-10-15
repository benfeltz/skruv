import { BOOKLET, BOOKLET_UI, CATALOG, COLORS, GESTURE } from '../constants.js';
import { pageMarks } from '../game/catalogLayout.js';

// One sheet module for both booklets (the catalog and the manual), in the one page look:
// the page alone — no surface, handle or control bar — centred over the room, its frame
// shadowed, its number and arrows printed on it. Docked it is a thumbnail the page grows out
// of and shrinks back to; tapped, it opens: one page at a time, flipped by a horizontal
// swipe, the corner arrows or the arrow keys, put down by a tap on the page, a swipe down,
// or Escape. It flips freely, front to back and back again: reference, never a checklist.
// A blocking sheet (the catalog) puts a scrim over the room while it is open, which takes
// any tap outside the page, puts the booklet down with it and swallows it whole; a
// non-blocking one has no scrim, so the room keeps every gesture. Follows the src/ui
// pattern (own element, own style, colours from COLORS).

const STYLE_ID = 'skruv-booklet';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  const { shadow, gutter, growMs, radius } = BOOKLET_UI.page;
  style.textContent = `
    .booklet-thumb {
      position: fixed;
      left: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-left));
      bottom: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-bottom));
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
    .booklet-thumb[data-corner='topLeft'] {
      top: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-top));
      bottom: auto;
    }
    /* A mouse resting on the docked thumbnail grows it from its corner to a readable page,
       about a quarter of the screen, raised over its neighbours — still under the scrim (2) and the page (3).
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
    .booklet-thumb:focus-visible, .booklet-leaf button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
    /* The page: centred over the room at full size when open; closed, the element is scaled
       and moved onto the thumb's own rect by an inline transform (\`settle\`), and the
       transition between is the grow. */
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
      .booklet-thumb { transition: none; }
      .booklet-leaf, .booklet-leaf[data-open='true'] { transition: none; }
      /* No growing animation, but still the wait: a passing pointer grows nothing. */
      .booklet-thumb:hover { transition: width 0s ${BOOKLET_UI.thumbHoverDelayMs}ms, z-index 0s ${BOOKLET_UI.thumbHoverDelayMs}ms; }
    }
    /* Still a button, for a keyboard or a screen reader to put the page down; unseen. And the
       live region that says which page it is, since the number is printed, not text. */
    .booklet-close, .booklet-status {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      border: 0;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .booklet-page {
      position: relative;
      display: flex;
      justify-content: center;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .booklet-page canvas {
      display: block;
      max-width: 100%;
      aspect-ratio: ${pageW} / ${pageH};
      border-radius: 6px;
      background: ${css(COLORS.bookletPaper)};
    }
    /* A line that says something went wrong (a pick that would not build), laid over the
       head of the page rather than added to it, so it never pushes anything off a short
       screen; there until the page flips or the sheet closes. At the head it is rows away
       from the only thing on a page that takes a tap (BUILD IT, near the foot), and it takes
       no pointer itself, so even a page drawn tiny never has it swallow a tap. */
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
    /* The page and, over the part of it a control is drawn on, a clear button placed in page
       fractions. The frame is sized exactly as the page and the canvas fills it, so those
       fractions land on the drawn page at any size. */
    .booklet-frame {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: ${pageW} / ${pageH};
      line-height: 0;
      border-radius: ${radius}px;
      box-shadow: ${shadow};
    }
    .booklet-frame canvas { width: 100%; height: 100%; }
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
export interface BookletSheetOptions<Blocking extends boolean = boolean> {
  pages: { count: number; canvas(index: number): CanvasImageSource };
  /** What the sheet is, for its accessible names: 'instructions' by default, 'catalog'. */
  name?: string;
  /** Whether it starts open, on its cover (default) — or docked as a thumb. */
  open?: boolean;
  /** Whether it takes the room's taps while open (default): a scrim over the room, and a tap on it puts the booklet down. False: no scrim, so the room keeps every gesture around the page. */
  blocking?: Blocking;
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
 * onChange(fn), setOpen(value), dispose() }`: mount the scrim (null when not `blocking`),
 * thumb and element; `onChange(fn)` calls `fn({ page, expanded })` whenever either changes;
 * `setOpen` opens or docks it from outside; `dispose()` takes it all back off the page.
 * Starts open on page 0, the cover, unless told otherwise — or another sheet is open: one
 * sheet is open at a time. State is the module's own and read-only outside it.
 */
export function createBookletSheet<Blocking extends boolean = true>({ pages, name = 'instructions', open: startsOpen = true, canClose = () => true, action, thumbShows = 'page', corner = 'bottomLeft', blocking = true as Blocking }: BookletSheetOptions<Blocking>) {
  injectStyle();
  const listeners = new Set<(state: { page: number; expanded: boolean }) => void>();
  let page = 0;
  let open = startsOpen;
  // Asked to start open while another sheet is: it starts docked (one open at a time).
  if (anyOpen()) open = false;
  let lingering: ReturnType<typeof setTimeout> | null = null;

  // Over the whole room — canvas and buttons alike — and under the page, while a blocking
  // booklet is open; a non-blocking one has none.
  const scrim = blocking ? document.createElement('div') : null;
  if (scrim) {
    scrim.className = 'booklet-scrim';
    scrim.setAttribute('aria-hidden', 'true');
  }

  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'booklet-thumb';
  thumb.setAttribute('aria-label', `Open the ${name}`);
  thumb.dataset.corner = corner;
  // Full page resolution: hovered, the thumbnail is read at up to a quarter of the screen.
  const thumbCanvas = pageCanvas(pageW, pageH);
  thumb.append(thumbCanvas);

  const element = document.createElement('section');
  element.className = 'booklet-leaf';
  element.setAttribute('aria-label', name[0].toUpperCase() + name.slice(1));

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'booklet-close';
  close.setAttribute('aria-label', `Close the ${name}`);

  const view = document.createElement('div');
  view.className = 'booklet-page';
  const viewCanvas = pageCanvas(pageW, pageH);
  viewCanvas.setAttribute('role', 'img');
  // The arrows are printed in the page's corners. They ride on the canvas in a frame of its
  // own, with the page's control, if it has one. `showAction` shows the open page's control,
  // or hides it.
  const arrows = cornerArrows();
  const { prev, next } = arrows;
  let showAction = () => {};
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
  frame.append(prev, next);
  view.append(frame);

  // Over the head of the page, after the page itself, so the view's children keep their places.
  const notice = document.createElement('p');
  notice.className = 'booklet-notice';
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  view.append(notice);
  element.append(close, view, arrows.status);

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
    settle();
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

  // The scrim is up whenever a blocking booklet is open. Put down by a tap, on the room or the
  // sheet, it stays `linger` ms past the lift, so the click a touch synthesises lands on
  // it too rather than on a button underneath.
  function showScrim(shown: boolean, linger = 0) {
    if (!scrim) return;
    clearTimeout(lingering ?? undefined);
    if (shown || linger === 0) scrim.hidden = !shown;
    else lingering = setTimeout(() => (scrim.hidden = true), linger);
  }

  function setOpen(value: boolean, { byRoomTap = false } = {}) {
    if (open === value || (!value && !canClose())) return;
    // One sheet open at a time: another one open keeps this one docked.
    if (value && anyOpen(self)) return;
    if (value) dock();
    open = value;
    notify(null);
    showScrim(open, byRoomTap ? BOOKLET_UI.scrimLingerMs : 0);
    render();
    // Onto the page's next arrow (aria-disabled at the last page, never `disabled`, so focus
    // is not lost there), back to the thumb on close — unless the close was a tap.
    if (byRoomTap) return;
    (open ? next : thumb).focus({ preventScroll: true });
  }

  // The tap that puts the booklet down. Captured, so a finger that slides onto the sheet
  // still ends here; the room never sees its pointerdown, so nothing is grabbed or orbited.
  // Only a press that began on the scrim counts: a mouse pressed on the sheet and released
  // off it lifts over the scrim too, uncaptured. A tap while the scrim lingers over the
  // closed booklet is swallowed and does nothing.
  const pressed = new Set<number>();
  scrim?.addEventListener('pointerdown', (event) => {
    pressed.add(event.pointerId);
    scrim.setPointerCapture(event.pointerId);
  });
  scrim?.addEventListener('pointercancel', (event) => pressed.delete(event.pointerId));
  scrim?.addEventListener('pointerup', (event) => {
    if (!pressed.delete(event.pointerId) || !open) return;
    setOpen(false, { byRoomTap: true });
  });

  // A tap on the page puts it down too, exactly as a tap on the room does: a primary press
  // off its buttons (close, arrows — they keep their own job, inert or not) that lifts
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
  close.addEventListener('click', () => setOpen(false));
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

  // The page's pose (the grow). Open: centred at full size. Docked: scaled to the thumb's
  // width and moved so the page's top-left lands on the thumb's — both measured from the
  // layout, the page's own box and the thumb's rect as it is now (a mouse-enlarged thumb
  // included), so the grow starts from what is on screen whatever the viewport. `dock` puts
  // the docked pose on before an open, so the transition has a start even for a page first
  // opened from a sheet that was built before it was mounted.
  const dockedPose = () => {
    const { left, top, width: thumbWidth } = thumb.getBoundingClientRect();
    // The layout box, before any transform: a hidden or unmounted element has none.
    const width = element.offsetWidth || 0;
    const scale = width > 0 ? thumbWidth / width : 1;
    return `translate(${left - element.offsetLeft}px, ${top - element.offsetTop}px) scale(${scale})`;
  };
  const dock = () => {
    element.style.transform = dockedPose();
    // Flushed, so the open pose that follows has this one to grow from.
    element.getBoundingClientRect();
  };
  const settle = () => {
    element.style.transform = open ? 'translate(-50%, -50%)' : dockedPose();
  };
  // A resize or a turn of the phone moves both boxes; the docked page follows.
  window.addEventListener('resize', settle);

  const self: LiveSheet = { isOpen: () => open, thumb };
  sheets.add(self);

  /** Takes the booklet off the page: its elements, its place among the live sheets, its window key listener and any lingering scrim timer. */
  function dispose() {
    clearTimeout(lingering ?? undefined);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', settle);
    sheets.delete(self);
    syncSheets();
    listeners.clear();
    scrim?.remove();
    thumb.remove();
    element.remove();
  }

  // The first render draws the open page (a WebGL render for a cover). If it throws, the
  // sheet takes itself back out — registry entry and key listener — before the error goes on,
  // since the caller never got a sheet to dispose.
  try {
    showScrim(open);
    render();
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    // A blocking sheet's scrim; null when it is not.
    scrim: scrim as Blocking extends true ? HTMLDivElement : HTMLDivElement | null,
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

/**
 * The page's controls: a clear button over each arrow printed in a lower corner of the
 * page (CATALOG.page.prevHit / .nextHit, src/scene/catalogPages.ts draws the arrows), none
 * of its own to show, and a live region for the page's number, which is printed, not text. At an end the arrow is not drawn but its button stays, inert (aria-disabled): a tap
 * there is the button's own, never a tap on the page that would put the catalog down, and
 * focus on it is not lost. The page's own marks say which (src/game/catalogLayout.ts `pageMarks`).
 */
function cornerArrows() {
  const { prevHit, nextHit } = CATALOG.page;
  const prev = button('', CATALOG.words.prev);
  const next = button('', CATALOG.words.next);
  for (const [control, rect] of [[prev, prevHit], [next, nextHit]] as const) {
    control.className = 'booklet-action';
    overlay(control, rect, 0);
  }
  const status = document.createElement('span');
  status.className = 'booklet-status';
  status.setAttribute('aria-live', 'polite');
  return {
    status,
    prev,
    next,
    paint(page: number, total: number) {
      const marks = pageMarks(page, total);
      prev.setAttribute('aria-disabled', String(!marks.prev));
      next.setAttribute('aria-disabled', String(!marks.next));
      status.textContent = `Page ${page + 1} of ${total}`;
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
