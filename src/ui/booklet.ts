import { BOOKLET, BOOKLET_UI, CATALOG, CLUSTER, COLORS, GESTURE, RENDER, RESET } from '../constants.js';
import { pageMarks } from '../game/catalogLayout.js';
import { centreSlot, tapOn, visibleCount, windowOf } from '../game/carouselModel.js';
import { peekNext } from '../game/peekGesture.js';
import type { PeekEvent, PeekState } from '../game/peekGesture.js';

// One sheet module for both booklets (the catalog and the manual), in the one page look:
// the page alone — no surface, handle or control bar — over the room, its frame shadowed, its
// number and arrows printed on it. It differs between the two only in how it is docked and
// whether it blocks the room. Docked as a thumb (the catalog, upper left) it is a thumbnail
// the page grows out of and shrinks back to; docked as a strip (the manual, bottom centre)
// it is a carousel of three or five pages, the centre one larger and current, an arrow at
// each end, and the page grows out of the centre slot. It flips freely, front to back and
// back again: reference, never a checklist. Open, a page is flipped by a horizontal swipe,
// the corner arrows or the arrow keys, and put down by a tap on the page, a swipe down, or
// Escape; the strip is moved by a swipe, its arrows, a tap on a side page or the arrow keys,
// opened by a click on the centre page (a mouse) or by holding it (a touch: the release puts
// it back). A blocking sheet puts a scrim over the room while it is open, which takes any
// tap outside the page, puts the booklet down with it and swallows it whole; a non-blocking
// one has no scrim, so only the strip and the open page take input and the room keeps every
// gesture. Follows the src/ui pattern (own element, own style, colours from COLORS).

const STYLE_ID = 'skruv-booklet';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  const { shadow, gutter, growMs, radius } = BOOKLET_UI.page;
  const { strip, stripShort } = BOOKLET_UI;
  // What the strip and the gap above it take off the bottom of the screen (CSS pixels), at
  // the full size and on a short viewport.
  const reserveFor = (centreWidth: number) => strip.inset + Math.round((centreWidth * pageH) / pageW) + strip.openGap;
  // A portrait phone's open page reaches up past the control cluster's buttons (Repack and
  // Snap rotate, in the upper right); its top is held below them. Elsewhere it is clear of
  // the cluster sideways, and only the gutter is kept.
  const clusterBottom = CLUSTER.inset + 2 * RESET.height + CLUSTER.gap + gutter;
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
    /* The strip: the manual's docked form, along the bottom centre — under the scrim (2) and
       the open page (3), over nothing but the room's lower edge. Its own box only takes
       input; the touch-action is none so a swipe along it is ours, not the browser's. */
    .booklet-strip {
      --slot-centre: ${strip.centreWidth}px;
      --slot-side: ${strip.sideWidth}px;
      position: fixed;
      left: 50%;
      bottom: calc(${strip.inset}px + env(safe-area-inset-bottom));
      z-index: 1;
      transform: translateX(-50%);
      display: flex;
      align-items: flex-end;
      gap: ${strip.gap}px;
      max-width: calc(100vw - ${2 * strip.gap}px);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .booklet-slots { display: flex; align-items: flex-end; justify-content: center; gap: ${strip.gap}px; min-width: 0; }
    .booklet-slot {
      flex: 0 1 var(--slot-side);
      min-width: 0;
      aspect-ratio: ${pageW} / ${pageH};
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 6px;
      background: ${css(COLORS.bookletPaper)};
      box-shadow: 0 4px 14px #0006;
      overflow: hidden;
      cursor: pointer;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
    }
    .booklet-slot[data-centre='true'] {
      flex: 0 0 var(--slot-centre);
      border-color: ${css(COLORS.uiAccent)};
    }
    .booklet-slot[data-empty='true'] { visibility: hidden; }
    .booklet-slot canvas { display: block; width: 100%; height: 100%; }
    .booklet-arrow {
      flex: none;
      width: ${strip.arrow}px;
      height: ${strip.arrow}px;
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: ${strip.arrow / 2}px;
      background: ${css(COLORS.uiSurface)}e6;
      color: ${css(COLORS.uiText)};
      font: 600 22px/1 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .booklet-arrow[aria-disabled='true'] { opacity: 0.3; cursor: default; }
    .booklet-strip button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
    /* A manual page opens above its strip, resting on it, as wide as the room above allows. */
    .booklet-leaf[data-docked='strip'] {
      --strip-reserve: ${reserveFor(strip.centreWidth)}px;
      --strip-top: ${gutter}px;
      top: auto;
      bottom: calc(var(--strip-reserve) + env(safe-area-inset-bottom));
      width: min(calc(100vw - ${2 * gutter}px), ${pageW}px, calc((100dvh - var(--strip-reserve) - var(--strip-top) - env(safe-area-inset-bottom)) * ${pageW} / ${pageH}));
    }
    @media (orientation: portrait) {
      .booklet-leaf[data-docked='strip'] { --strip-top: ${clusterBottom}px; }
    }
    @media (max-height: ${stripShort.maxHeight}px) {
      .booklet-strip { --slot-centre: ${stripShort.centreWidth}px; --slot-side: ${stripShort.sideWidth}px; }
      .booklet-leaf[data-docked='strip'] { --strip-reserve: ${reserveFor(stripShort.centreWidth)}px; }
    }
  `;
  document.head.append(style);
}

// Every sheet on the page (the catalog and the current manual): one is open at a time — the
// catalog wins, putting an open manual page down as it opens. A docked thumb is inert (out of
// the tab order and deaf to clicks) while its own page is open or another sheet that blocks
// the room is, so the keyboard can't open a second sheet under the first's scrim and a key
// never drives two. A strip stays live under its own open page (it is how the page is
// flipped) and under a non-blocking one.
type LiveSheet = { isOpen(): boolean; thumb: HTMLElement; blocking: boolean; strip: boolean; close(): void };
const sheets = new Set<LiveSheet>();
/** Whether any live sheet but `except` is open. */
const anyOpen = (except?: LiveSheet) => [...sheets].some((sheet) => sheet !== except && sheet.isOpen());
const inertFor = (sheet: LiveSheet) => [...sheets].some((other) => other.isOpen() && (other === sheet ? !sheet.strip : other.blocking));
function syncSheets() {
  for (const sheet of sheets) sheet.thumb.inert = inertFor(sheet);
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
  /** How it is docked: 'thumb' (default) — a thumbnail in a corner — or 'strip', the manual's carousel along the bottom centre: 3 or 5 pages (src/game/carouselModel.ts), the centre one larger and current, an arrow at each end. */
  docked?: 'thumb' | 'strip';
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
export function createBookletSheet<Blocking extends boolean = true>({ pages, name = 'instructions', open: startsOpen = true, canClose = () => true, action, thumbShows = 'page', corner = 'bottomLeft', docked = 'thumb', blocking = true as Blocking }: BookletSheetOptions<Blocking>) {
  injectStyle();
  const stripped = docked === 'strip';
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

  // The docked form: a thumbnail button, or the strip of pages. `thumb` is the element to
  // mount either way; `anchor()` is the box the open page grows out of and shrinks back to.
  const thumb: HTMLElement = document.createElement(stripped ? 'div' : 'button');
  thumb.className = stripped ? 'booklet-strip' : 'booklet-thumb';
  if (!stripped) {
    (thumb as HTMLButtonElement).type = 'button';
    thumb.setAttribute('aria-label', `Open the ${name}`);
    thumb.dataset.corner = corner;
  }
  // Full page resolution: hovered, the thumbnail is read at up to a quarter of the screen.
  // A strip draws into its slots' own, small canvases instead.
  const thumbCanvas = stripped ? null : pageCanvas(pageW, pageH);
  if (thumbCanvas) thumb.append(thumbCanvas);
  const carousel = stripped ? createStrip(name, pages.count, thumb) : null;
  const anchor = () => carousel?.centre() ?? thumb;

  const element = document.createElement('section');
  element.className = 'booklet-leaf';
  element.dataset.docked = docked;
  element.setAttribute('aria-label', name[0].toUpperCase() + name.slice(1));

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'booklet-close';
  close.setAttribute('aria-label', `Close the ${name}`);

  const view = document.createElement('div');
  view.className = 'booklet-page';
  const viewCanvas = pageCanvas(pageW, pageH);
  viewCanvas.setAttribute('role', 'img');
  // The arrows are printed in the page's corners — the catalog's. The manual's pages print
  // none (the strip flips them), so it lays no hit zones over its corners. They ride on the
  // canvas in a frame of its own, with the page's control, if it has one. `showAction` shows
  // the open page's control, or hides it.
  const arrows = cornerArrows(!stripped);
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
  if (arrows.prev && arrows.next) frame.append(arrows.prev, arrows.next);
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

  // A canvas always gives a 2D context the first time it is asked.
  const drawer = (target: HTMLCanvasElement, index: number) => target.getContext('2d')!.drawImage(pages.canvas(index), 0, 0, target.width, target.height);

  function render() {
    if (open) drawer(viewCanvas, page);
    if (carousel) carousel.paint(page, drawer, open);
    else if (thumbCanvas) drawer(thumbCanvas, thumbShows === 'cover' ? 0 : page);
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
    if (value) {
      // The catalog wins: a blocking sheet puts an open non-blocking page down first, without
      // moving focus. Any other sheet open keeps this one docked (one open at a time).
      if (blocking) for (const other of sheets) if (other !== self && !other.blocking && other.isOpen()) other.close();
      if (anyOpen(self)) return;
      dock();
    }
    open = value;
    notify(null);
    showScrim(open, byRoomTap ? BOOKLET_UI.scrimLingerMs : 0);
    render();
    // Onto the page's next arrow (aria-disabled at the last page, never `disabled`, so focus
    // is not lost there; a strip's page has none, and focus stays on the strip), back to the
    // docked form on close — unless the close was a tap.
    if (byRoomTap) return;
    (open ? arrows.next : (carousel?.centre() ?? thumb))?.focus({ preventScroll: true });
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

  if (!stripped) thumb.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  arrows.prev?.addEventListener('click', () => flip(-1));
  arrows.next?.addEventListener('click', () => flip(1));

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

  // The strip's own gestures. A press on a slot (or a gap) is tracked from its down to its up
  // or cancel: past the tap distance it is a swipe — one page, never a peek or a tap;
  // within it, on a side slot it moves there, on the centre slot a mouse toggles the page
  // and a touch holds it open: the peek state machine (src/game/peekGesture.ts) times that,
  // and its release — or a lost capture — puts the page back. The strip's arrows are plain buttons with their own
  // click; a keyboard's click on a slot (detail 0 — a pointer's was handled here) does what a
  // tap does.
  let peek: PeekState = 'idle';
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  const peekSend = (event: PeekEvent) => {
    const from = peek;
    peek = peekNext(from, event, GESTURE.tapMaxDistance);
    if (peek === from) return;
    clearTimeout(peekTimer ?? undefined);
    if (peek === 'pressing') peekTimer = setTimeout(() => peekSend({ type: 'delay' }), BOOKLET_UI.strip.peekDelayMs);
    if (peek === 'peeking') setOpen(true);
    if (from === 'peeking') setOpen(false);
  };
  const slotWindow = () => windowOf(page, pages.count, carousel!.visible());
  const tapSlot = (slot: number, touch: boolean) => {
    const meaning = tapOn(slotWindow(), slot);
    if (meaning === 'centre') {
      // A touch's hold is the peek's; a mouse or a key toggles.
      if (!touch) setOpen(!open);
    } else if (meaning !== null) flip(meaning - page);
  };
  if (carousel) {
    let stripPress: { id: number; x: number; y: number; slot: number | null; touch: boolean } | null = null;
    thumb.addEventListener('pointerdown', (event) => {
      const control = (event.target as Element).closest('button');
      const slot = control?.dataset.slot;
      // The arrows keep their own job; a right button or a second finger starts nothing.
      if (event.button !== 0 || stripPress || (control && slot === undefined)) return;
      const touch = event.pointerType !== 'mouse';
      stripPress = { id: event.pointerId, x: event.clientX, y: event.clientY, slot: slot === undefined ? null : Number(slot), touch };
      thumb.setPointerCapture(event.pointerId);
      if (touch && stripPress.slot === centreSlot(carousel.visible())) peekSend({ type: 'press' });
    });
    thumb.addEventListener('pointermove', (event) => {
      if (!stripPress || event.pointerId !== stripPress.id) return;
      peekSend({ type: 'move', distance: Math.hypot(event.clientX - stripPress.x, event.clientY - stripPress.y) });
    });
    const endStripPress = (event: PointerEvent) => {
      if (!stripPress || event.pointerId !== stripPress.id) return;
      const { x, y, slot, touch } = stripPress;
      stripPress = null;
      const wasPeeking = peek === 'peeking';
      if (touch) peekSend({ type: 'release' });
      if (event.type !== 'pointerup' || wasPeeking) return;
      const dx = event.clientX - x;
      const dy = event.clientY - y;
      if (Math.hypot(dx, dy) <= GESTURE.tapMaxDistance) {
        if (slot !== null) tapSlot(slot, touch);
      } else if (Math.abs(dx) >= BOOKLET_UI.swipeDistance && Math.abs(dx) > Math.abs(dy)) flip(dx < 0 ? 1 : -1);
    };
    thumb.addEventListener('pointerup', endStripPress);
    thumb.addEventListener('pointercancel', endStripPress);
    // A capture the browser takes back (the strip went inert under a finger, a second finger
    // opened the catalog) is the press ending: no tap, no flip, and a peek is put back.
    thumb.addEventListener('lostpointercapture', endStripPress);
    thumb.addEventListener('click', (event) => {
      const slot = (event.target as Element).closest('button')?.dataset.slot;
      if (event.detail === 0 && slot !== undefined) tapSlot(Number(slot), false);
    });
    carousel.prev.addEventListener('click', () => flip(-1));
    carousel.next.addEventListener('click', () => flip(1));
  }

  function onKey(event: KeyboardEvent) {
    // The browser's and the page's own: a chord (Alt+Left is back), a key something else has
    // taken, and a control that is not ours — a slider or a field, but also the cluster's
    // buttons and the tune drawer — has its own use of the arrow keys.
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const control = (event.target as Element | null)?.closest?.('input, textarea, select, button, a, [role="slider"]');
    if (control && !thumb.contains(control) && !element.contains(control)) return;
    if (event.key === 'Escape') {
      if (open) setOpen(false);
      return;
    }
    // A strip steps on the arrow keys docked too, unless another sheet is the one in hand.
    if (!open && !(stripped && !anyOpen(self))) return;
    if (event.key === 'ArrowLeft') flip(-1);
    else if (event.key === 'ArrowRight') flip(1);
  }
  window.addEventListener('keydown', onKey);

  // The page's pose (the grow). Open: centred at full size. Docked: scaled to the thumb's
  // width and moved so the page's top-left lands on the thumb's — both measured from the
  // layout, the page's own box and the thumb's rect as it is now (a mouse-enlarged thumb
  // included), so the grow starts from what is on screen whatever the viewport. `dock` puts
  // the docked pose on before an open, so the transition has a start even for a page first
  // opened from a sheet that was built before it was mounted.
  const dockedPose = () => {
    const { left, top, width: thumbWidth } = anchor().getBoundingClientRect();
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
    // A thumb's page is centred over the room; a strip's rests on the strip, centred across.
    element.style.transform = open ? (stripped ? 'translate(-50%, 0)' : 'translate(-50%, -50%)') : dockedPose();
  };
  // A resize or a turn of the phone moves both boxes (and may change how many pages the strip
  // shows); the docked page follows.
  const onResize = () => {
    carousel?.paint(page, drawer, open);
    settle();
  };
  window.addEventListener('resize', onResize);

  const self: LiveSheet = { isOpen: () => open, thumb, blocking, strip: stripped, close: () => setOpen(false, { byRoomTap: true }) };
  sheets.add(self);

  /** Takes the booklet off the page: its elements, its place among the live sheets, its window key listener and any lingering scrim timer. */
  function dispose() {
    clearTimeout(lingering ?? undefined);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    clearTimeout(peekTimer ?? undefined);
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
    /** Puts focus on its docked form: the thumb, or the strip's centre page. */
    focus() {
      (carousel?.centre() ?? thumb).focus({ preventScroll: true });
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

/**
 * The strip's DOM: an arrow at each end and, between them, a slot for each page the viewport
 * has room for (src/game/carouselModel.ts) — rebuilt when that count changes. `paint(page,
 * draw, open)` shows the pages round `page`, redrawing only a slot whose page changed.
 */
function createStrip(name: string, count: number, root: HTMLElement) {
  const prev = button('‹', 'Previous page');
  const next = button('›', 'Next page');
  prev.className = next.className = 'booklet-arrow';
  const box = document.createElement('div');
  box.className = 'booklet-slots';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `${name[0].toUpperCase()}${name.slice(1)} pages`);
  root.append(prev, box, next);

  // A slot shows a page at most `centreWidth` CSS px wide: its canvas is that at the device's
  // pixel ratio (as the room's renderer is capped), not the page's full resolution.
  const ratio = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
  const slotWidth = Math.round(BOOKLET_UI.strip.centreWidth * ratio);
  const slotHeight = Math.round((slotWidth * pageH) / pageW);
  let slots: { button: HTMLButtonElement; canvas: HTMLCanvasElement; shows: number | null | undefined }[] = [];
  const visible = () => visibleCount(window.innerWidth);
  function rebuild(total: number) {
    // A turn of the phone or a resized window may take away the slot that has focus.
    const hadFocus = slots.some(({ button: old }) => old === document.activeElement);
    for (const { button: old } of slots) old.remove();
    slots = Array.from({ length: total }, (_, index) => {
      const slot = button('', '');
      slot.className = 'booklet-slot';
      slot.dataset.slot = String(index);
      slot.dataset.centre = String(index === centreSlot(total));
      slot.tabIndex = index === centreSlot(total) ? 0 : -1;
      const canvas = pageCanvas(slotWidth, slotHeight);
      slot.append(canvas);
      box.append(slot);
      return { button: slot, canvas, shows: undefined };
    });
    if (hadFocus) slots[centreSlot(total)].button.focus({ preventScroll: true });
  }

  return {
    prev,
    next,
    visible,
    /** The centre slot's button: the page that is current, and what the open page grows from. */
    centre() {
      if (slots.length === 0) rebuild(visible());
      return slots[centreSlot(slots.length)].button;
    },
    paint(page: number, draw: (target: HTMLCanvasElement, index: number) => void, open: boolean) {
      const total = visible();
      if (total !== slots.length) rebuild(total);
      const shown = windowOf(page, count, total);
      shown.forEach((index, at) => {
        const slot = slots[at];
        slot.button.dataset.empty = String(index === null);
        slot.button.setAttribute('aria-hidden', String(index === null));
        const centred = at === centreSlot(total);
        const label = centred ? `Page ${(index ?? 0) + 1} of ${count}, ${open ? 'close' : 'open'} it` : `Go to page ${(index ?? 0) + 1} of ${count}`;
        slot.button.setAttribute('aria-label', index === null ? '' : label);
        if (at === centreSlot(total)) slot.button.setAttribute('aria-expanded', String(open));
        if (index !== null && slot.shows !== index) draw(slot.canvas, index);
        slot.shows = index;
      });
      prev.setAttribute('aria-disabled', String(page === 0));
      next.setAttribute('aria-disabled', String(page === count - 1));
    },
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
 * of its own to show — unless the page `printed` none (the manual's) — and a live region for
 * the page's number, which is printed, not text. At an end the arrow is not drawn but its button stays, inert (aria-disabled): a tap
 * there is the button's own, never a tap on the page that would put the catalog down, and
 * focus on it is not lost. The page's own marks say which (src/game/catalogLayout.ts `pageMarks`).
 */
function cornerArrows(printed: boolean) {
  const { prevHit, nextHit } = CATALOG.page;
  // A page that prints no arrows has no hit zones to put over them.
  const prev = printed ? button('', CATALOG.words.prev) : null;
  const next = printed ? button('', CATALOG.words.next) : null;
  if (prev && next) {
    for (const [control, rect] of [[prev, prevHit], [next, nextHit]] as const) {
      control.className = 'booklet-action';
      overlay(control, rect, 0);
    }
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
      prev?.setAttribute('aria-disabled', String(!marks.prev));
      next?.setAttribute('aria-disabled', String(!marks.next));
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
