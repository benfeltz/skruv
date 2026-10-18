import { BOOKLET, BOOKLET_UI, CATALOG, CLUSTER, COLORS, GESTURE, MENU, RENDER } from '../constants.js';
import { pageMarks } from '../game/catalogLayout.js';
import { centreSlot, clampTravel, pitch, restShift, slotCount, snapSteps, tapOn, visibleCount, windowOf } from '../game/carouselModel.js';
import { peekNext } from '../game/peekGesture.js';
import type { PeekEvent, PeekState } from '../game/peekGesture.js';

// One sheet module for both booklets (the catalog and the manual), in the one page look:
// the page alone — no surface, handle or control bar — over the room, its frame shadowed, its
// number and arrows printed on it. It differs between the two only in how it is docked and
// whether it blocks the room. Docked as a thumb (the catalog, upper left) it is a thumbnail
// the page grows out of and shrinks back to; docked as a strip (the manual) it is a band
// edge to edge — along the bottom of the screen in portrait, down the right edge in
// landscape — of pages all one small size, the centre one current and gold-bordered, and the
// page grows out of the centre slot. It flips freely, front to back and back again:
// reference, never a checklist. Open, a page is flipped by a horizontal swipe, the corner
// arrows or the arrow keys, and put down by a tap on the page, a swipe down, or Escape; the
// band is moved by the arrow keys or a tap on a side page, opened by a click on the centre
// page (a mouse) or, on a touch, by holding any of its pages: that page peeks in place, out
// of its own slot, and the release puts it back (the band does not move). The band mounts
// two root variables, `--strip-bottom` and `--strip-right`, that shrink the room's view
// (index.html's #app) and move the control cluster, so the canvas never lies under it. A
// blocking sheet puts a scrim over the room while it is open, which takes any tap outside the
// page, puts the booklet down with it and swallows it whole; a non-blocking one has no
// scrim, so only the strip and the open page take input and the room keeps every gesture.
// Follows the src/ui pattern (own element, own style, colours from COLORS).

const STYLE_ID = 'skruv-booklet';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const [pageW, pageH] = BOOKLET.pageSize;

// The band's thickness, all from the page ratio: a page's height and a gutter either side along
// the short axis (CSS px, before the safe-area inset).
const stripPageH = Math.round((BOOKLET_UI.strip.page * pageH) / pageW);
const bandBottom = stripPageH + 2 * BOOKLET_UI.page.gutter;
const bandRight = BOOKLET_UI.strip.page + 2 * BOOKLET_UI.page.gutter;
// The root variables the mounted band sets (index.html's #app and the manual's open page read them).
// `bottom`, `left` and `right` are how far the room's view is inset from that edge; `backdrop` is
// what shows where the view is not (black in landscape, beside the notch).
const STRIP_VARS = { bottom: '--strip-bottom', left: '--strip-left', right: '--strip-right', backdrop: '--backdrop' } as const;
// Which edge the band stands on, set on the root as data-strip for the CSS that moves with it.
type Band = 'bottom' | 'right';
type Axis = 'x' | 'y';
const env = (side: 'left' | 'right' | 'bottom') => `env(safe-area-inset-${side})`;
/**
 * What the room's view is inset by for a band on `band`. Upright, the band's height above the home
 * indicator's inset. In landscape the band always stands on the right and the menu and the lift line
 * always on the left (Ben, 2026-10-18): which side the notch is on cannot be told reliably (Safari
 * reports the same inset both sides, Chrome on iOS none), so both safe-area margins are kept, drawn
 * black — the band inside the right one, the room's view inside the left. Where a browser reports no
 * inset (Chrome keeps the page out of the notch itself) the margins are 0 and the band is flush.
 */
function viewVars(band: Band) {
  if (band === 'bottom') return { bottom: `calc(${bandBottom}px + ${env('bottom')})`, left: '0px', right: '0px', backdrop: null };
  return { bottom: '0px', left: env('left'), right: `calc(${bandRight}px + ${env('right')})`, backdrop: '#000' };
}
// In landscape the catalog's docked thumb sits at the top of the screen, in the room just beside the
// band: this far (px) from the band's edge, past the right safe-area margin.
const thumbBeside = bandRight + BOOKLET_UI.page.gutter;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  const { shadow, gutter, growMs, radius } = BOOKLET_UI.page;
  const { strip } = BOOKLET_UI;
  // A portrait phone's open page reaches up past the control cluster's row (the menu button
  // in the upper right); its top is held below it. Elsewhere it is clear of the cluster
  // sideways, and only the gutter is kept.
  const clusterBottom = CLUSTER.inset + MENU.size + gutter;
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
      /* Over the manual's band, which a landscape thumb sits on. */
      z-index: 1;
    }
    /* The catalog's thumb ('topLeft' is the corner it used to have) sits in the upper right, from the
       first load on: the menu and the lift line under it have the left, for the left thumb (Ben,
       2026-10-18). */
    .booklet-thumb[data-corner='topLeft'] {
      top: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-top));
      bottom: auto;
      left: auto;
      right: calc(${BOOKLET_UI.cornerInset}px + env(safe-area-inset-right));
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
    .booklet-thumb:focus-visible, .booklet-leaf button:focus-visible, .booklet-strip button:focus-visible {
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
      align-items: flex-start;
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
    /* The canvas's own width and height attributes are the page's proportions, so its height
       follows its width in any browser — never stretched to a box taller than the page. */
    .booklet-frame canvas { width: 100%; height: auto; }
    .booklet-action {
      position: absolute;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    /* The strip: the manual's docked form, a band edge to edge — along the bottom in portrait,
       down the right edge in landscape (JS sets data-axis 'x' | 'y' from the same test as CSS's
       orientation) — under the scrim (2) and the open page (3), the room's view ending where it
       begins (the root variables, index.html). It is its own box and its own hit area: paper, with an
       ink rule on its view side, no radius, no shadow. The slots past its edges are cut. The
       touch-action is none so a drag along it is ours, not the browser's. */
    .booklet-strip {
      position: fixed;
      z-index: 0;
      box-sizing: border-box;
      display: flex;
      overflow: hidden;
      background: ${css(COLORS.bookletPaper)};
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .booklet-strip[data-band='bottom'] {
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(${bandBottom}px + env(safe-area-inset-bottom));
      padding-bottom: env(safe-area-inset-bottom);
      box-shadow: inset 0 ${strip.rule}px 0 ${css(COLORS.bookletInk)};
    }
    /* Down the right edge (landscape), whichever side the notch is on: inside the right safe-area
       margin (drawn black, the notch's when it is on the right), the whole height. */
    .booklet-strip[data-band='right'] {
      top: 0;
      bottom: 0;
      right: env(safe-area-inset-right);
      width: ${bandRight}px;
      padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0;
      box-shadow: inset ${strip.rule}px 0 0 ${css(COLORS.bookletInk)};
    }
    /* Where the pages run, and are cut. */
    .booklet-lane {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    /* The catalog's thumb, put down from the open catalog, sits at the top of the screen in landscape,
       in the room beside the band with a gutter between (never on it or in its column). */
    html[data-strip='right'] .booklet-thumb[data-corner='topLeft'] {
      left: auto;
      right: calc(${thumbBeside}px + env(safe-area-inset-right));
    }
    /* The pages in a row (a column in landscape), centred in the band and moved as one by an
       inline transform: a drag follows the pointer (data-dragging, no transition) and a snap
       slides back. */
    .booklet-track {
      flex: none;
      display: flex;
      align-items: center;
      gap: ${strip.gap}px;
      transition: transform ${strip.snapMs}ms ease-out;
    }
    .booklet-track[data-axis='y'] { flex-direction: column; }
    .booklet-track[data-dragging='true'] { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      .booklet-track { transition: none; }
    }
    .booklet-slot {
      /* An explicit width, never a shrinking basis: Safari collapsed those to nothing. */
      flex: none;
      width: ${strip.page}px;
      aspect-ratio: ${pageW} / ${pageH};
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: ${strip.radius}px;
      background: ${css(COLORS.bookletPaper)};
      box-shadow: ${strip.shadow};
      overflow: hidden;
      cursor: pointer;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
    }
    .booklet-slot[data-centre='true'] { border-color: ${css(COLORS.uiAccent)}; }
    .booklet-slot[data-empty='true'] { visibility: hidden; }
    .booklet-slot canvas { display: block; width: 100%; height: 100%; }
    /* A manual page opens above its band, resting on it, as wide as the room above allows. Down the
       right edge (landscape) it is centred in the view the band leaves instead. */
    .booklet-leaf[data-docked='strip'] {
      --strip-reserve: calc(var(${STRIP_VARS.bottom}, 0px) + ${strip.openGap}px);
      --strip-top: ${gutter}px;
      top: auto;
      bottom: var(--strip-reserve);
      width: min(calc(100vw - ${2 * gutter}px), ${pageW}px, calc((100dvh - var(--strip-reserve) - var(--strip-top)) * ${pageW} / ${pageH}));
    }
    @media (orientation: portrait) {
      .booklet-leaf[data-docked='strip'] { --strip-top: ${clusterBottom}px; }
    }
    .booklet-leaf[data-docked='strip'][data-axis='y'] {
      left: calc((var(${STRIP_VARS.left}, 0px) + 100vw - var(${STRIP_VARS.right}, 0px)) / 2);
      top: 50%;
      bottom: auto;
      width: min(calc(100vw - var(${STRIP_VARS.left}, 0px) - var(${STRIP_VARS.right}, 0px) - ${2 * gutter}px), ${pageW}px, calc((100dvh - ${2 * gutter}px) * ${pageW} / ${pageH}));
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
 * thumb and element; `onChange(fn)` calls `fn({ page, expanded })` whenever either changes — `page` is the page on view: the current one, or a side page while a hold has it peeked (`currentPage` stays the current one);
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
  // The side (or centre) page a hold has peeked open, and the slot it was held in: the open
  // page shows it and grows from and shrinks back to that slot, while `page` — the band — stays.
  let peeked: number | null = null;
  let peekedAt: number | null = null;
  const viewPage = () => (open ? (peeked ?? page) : page);
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
  const element = document.createElement('section');
  element.className = 'booklet-leaf';
  element.dataset.docked = docked;
  element.setAttribute('aria-label', capitalised(name));
  const carousel = stripped ? createStrip(name, pages.count, thumb, element) : null;
  const anchor = () => (carousel && peekedAt !== null ? carousel.slot(peekedAt) : carousel?.centre()) ?? thumb;

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
    const shown = viewPage();
    if (open) drawer(viewCanvas, shown);
    if (carousel) carousel.paint(page, drawer, open);
    else if (thumbCanvas) drawer(thumbCanvas, thumbShows === 'cover' ? 0 : page);
    viewCanvas.setAttribute('aria-label', `Page ${shown + 1} of ${pages.count}`);
    arrows.paint(page, pages.count);
    element.dataset.open = String(open);
    settle();
    showAction();
    syncSheets();
    for (const fn of listeners) fn({ page: shown, expanded: open });
  }

  // Moves the page by `by`; the band slides the pages into place from where they stood, `travel`
  // px (along the band) off their slots when a drag let go — the tap, the keys and the drag's
  // release are all this one slide.
  const flip = (by: number, travel = 0) => {
    const to = Math.min(pages.count - 1, Math.max(0, page + by));
    if (to === page) return;
    const moved = to - page;
    page = to;
    notify(null);
    render();
    carousel?.slide(travel + moved * carousel.pitch());
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
  // or cancel: past the tap distance along the band it is a drag — the pages follow the pointer
  // and snap to the nearest page on release, never a peek or a tap; within it, on a side slot
  // it moves there, on the centre slot a mouse toggles the page and a touch holds it open: the
  // peek state machine (src/game/peekGesture.ts) times that, and its release — or a lost
  // capture — puts the page back. A keyboard's click on a slot (detail 0 — a pointer's was
  // handled here) does what a tap does.
  let stripPress: { id: number; x: number; y: number; slot: number | null; touch: boolean; travel: number; dragging: boolean } | null = null;
  let peek: PeekState = 'idle';
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  const peekSend = (event: PeekEvent) => {
    const from = peek;
    peek = peekNext(from, event, GESTURE.tapMaxDistance);
    if (peek === from) return;
    clearTimeout(peekTimer ?? undefined);
    if (peek === 'pressing') peekTimer = setTimeout(() => peekSend({ type: 'delay' }), BOOKLET_UI.strip.peekDelayMs);
    if (peek === 'peeking' && stripPress?.slot != null) {
      // The held slot's page, set before the open so the grow starts from that slot.
      peeked = slotWindow()[stripPress.slot];
      peekedAt = stripPress.slot;
      setOpen(true);
      // Refused (another sheet is open): nothing was peeked.
      if (!open) peeked = peekedAt = null;
    }
    if (from === 'peeking') {
      // Closed first, so the shrink targets the held slot; then the slot is let go.
      setOpen(false);
      peeked = peekedAt = null;
    }
  };
  const slotWindow = () => windowOf(page, pages.count, carousel!.total());
  const tapSlot = (slot: number, touch: boolean) => {
    const meaning = tapOn(slotWindow(), slot);
    if (meaning === 'centre') {
      // A touch's hold is the peek's; a mouse or a key toggles.
      if (!touch) setOpen(!open);
    } else if (meaning !== null) flip(meaning - page);
  };
  if (carousel) {
    thumb.addEventListener('pointerdown', (event) => {
      const slot = (event.target as Element).closest('button')?.dataset.slot;
      if (event.button !== 0) return;
      // The band has no two-finger gesture, so a second finger ends the first one's as a cancel
      // (no tap, no flip, a peek put back, a drag slid back) and starts nothing: a pinch here is
      // nobody's. The room is not told; fingers on the band were never the room's.
      if (stripPress) {
        if (event.pointerId !== stripPress.id) cancelStripPress();
        return;
      }
      const touch = event.pointerType !== 'mouse';
      stripPress = { id: event.pointerId, x: event.clientX, y: event.clientY, slot: slot === undefined ? null : Number(slot), touch, travel: 0, dragging: false };
      thumb.setPointerCapture(event.pointerId);
      // A hold peeks the page in any slot that has one — while the manual is docked. Open, only
      // the centre slot's hold is armed, as it always was: a side slot's hold is a tap that
      // flips the open page, and must never close it on the release.
      const holdable = stripPress.slot !== null && slotWindow()[stripPress.slot] != null && (!open || stripPress.slot === centreSlot(carousel.total()));
      if (touch && holdable) peekSend({ type: 'press' });
    });
    thumb.addEventListener('pointermove', (event) => {
      if (!stripPress || event.pointerId !== stripPress.id) return;
      const dx = event.clientX - stripPress.x;
      const dy = event.clientY - stripPress.y;
      peekSend({ type: 'move', distance: Math.hypot(dx, dy) });
      // While peeking, travel does nothing: the release only closes.
      if (peek === 'peeking') return;
      const along = carousel.axis() === 'x' ? dx : dy;
      if (!stripPress.dragging && Math.abs(along) <= GESTURE.tapMaxDistance) return;
      stripPress.dragging = true;
      stripPress.travel = clampTravel(along, page, pages.count, carousel.pitch(), BOOKLET_UI.strip.reach);
      carousel.drag(stripPress.travel);
    });
    // Lets the press go: a touch's peek is put back. Returns the press, for a drag to settle.
    function releaseStripPress() {
      const press = stripPress;
      stripPress = null;
      if (press?.touch) peekSend({ type: 'release' });
      return press;
    }
    // A press cut short: nothing is flipped and a drag slides back.
    function cancelStripPress() {
      const press = releaseStripPress();
      if (press?.dragging) carousel!.slide(press.travel);
    }
    const endStripPress = (event: PointerEvent) => {
      if (!stripPress || event.pointerId !== stripPress.id) return;
      const { x, y, slot, touch, dragging, travel } = stripPress;
      const wasPeeking = peek === 'peeking';
      if (wasPeeking || event.type !== 'pointerup') return cancelStripPress();
      releaseStripPress();
      if (dragging) {
        // To the nearest page, the pages sliding the rest of the way from where they were let go.
        const steps = snapSteps(travel, carousel.pitch());
        if (steps === 0) carousel.slide(travel);
        else flip(steps, travel);
      } else if (Math.hypot(event.clientX - x, event.clientY - y) <= GESTURE.tapMaxDistance && slot !== null) tapSlot(slot, touch);
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
    // Left and Right step the band either way up; Up and Down too when it stands on the right edge.
    const vertical = carousel?.axis() === 'y';
    if (event.key === 'ArrowLeft' || (vertical && event.key === 'ArrowUp')) flip(-1);
    else if (event.key === 'ArrowRight' || (vertical && event.key === 'ArrowDown')) flip(1);
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
    // A thumb's page is centred over the room; a strip's rests on the band, centred across, or on the right edge is centred in the view the band leaves.
    const restsOnBand = stripped && carousel?.axis() === 'x';
    element.style.transform = open ? (restsOnBand ? 'translate(-50%, 0)' : 'translate(-50%, -50%)') : dockedPose();
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
    carousel?.dispose();
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
 * The strip's DOM: a track of slots, one for each page the band's long side has room for
 * (src/game/carouselModel.ts) and the hidden ones past each end a drag needs — rebuilt when that count
 * changes. `paint(page, draw, open)` shows the pages round `page`, redrawing only a slot whose page
 * changed, and says the orientation to the band, the open page `leaf` and the root variables (the
 * one place any of them is written); `dispose()` gives the room's view back.
 */
function createStrip(name: string, count: number, root: HTMLElement, leaf: HTMLElement) {
  const { strip } = BOOKLET_UI;
  const lane = document.createElement('div');
  lane.className = 'booklet-lane';
  const track = document.createElement('div');
  track.className = 'booklet-track';
  lane.append(track);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `${capitalised(name)} pages`);
  root.append(lane);
  const rootElement = document.documentElement;

  // A slot shows a page `page` CSS px wide: its canvas is that at the device's pixel ratio (as
  // the room's renderer is capped), not the page's full resolution.
  const ratio = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
  const slotWidth = Math.round(strip.page * ratio);
  const slotHeight = Math.round((slotWidth * pageH) / pageW);
  let slots: { button: HTMLButtonElement; canvas: HTMLCanvasElement; shows: number | null | undefined }[] = [];
  // The band lies along the bottom in portrait and down the right in landscape: CSS's own test
  // for orientation (height at least width is portrait).
  const axis = (): Axis => (window.innerHeight >= window.innerWidth ? 'x' : 'y');
  // A slot's length along the band: a page's width on the bottom, its height down the right edge.
  const sizes = () => ({ slot: axis() === 'x' ? strip.page : stripPageH, gap: strip.gap });
  // Down an edge the pages run below the catalog's thumb, which sits at the top of the band.
  const extent = () => (axis() === 'x' ? window.innerWidth : window.innerHeight);
  /** Which edge the band stands on: the bottom upright, the right in landscape. */
  const band = (): Band => (axis() === 'x' ? 'bottom' : 'right');
  /** How many pages the band's long side has room for. */
  const visible = () => visibleCount(extent(), sizes(), BOOKLET_UI.page.gutter);
  /** How many slots are built: those, the hidden ones past each end a drag needs, and those the track's rest shift brings in at either end. */
  const total = () => slotCount(extent(), sizes(), BOOKLET_UI.page.gutter, strip.reach) + 2 * centreSlot(visible());
  const shift =(px: number) => `translate${axis() === 'x' ? 'X' : 'Y'}(${px}px)`;
  // Where the track rests (px along the band, restShift's slots), so the band never shows an empty
  // slot beside its pages; and where it rested before the last paint, which a slide starts from.
  let rest = 0;
  let restBefore = 0;
  function rebuild(built: number) {
    // A turn of the phone or a resized window may take away the slot that has focus.
    const hadFocus = slots.some(({ button: old }) => old === document.activeElement);
    for (const { button: old } of slots) old.remove();
    slots = Array.from({ length: built }, (_, index) => {
      const slot = button('', '');
      slot.className = 'booklet-slot';
      slot.dataset.slot = String(index);
      slot.dataset.centre = String(index === centreSlot(built));
      slot.tabIndex = index === centreSlot(built) ? 0 : -1;
      const canvas = pageCanvas(slotWidth, slotHeight);
      slot.append(canvas);
      track.append(slot);
      return { button: slot, canvas, shows: undefined };
    });
    if (hadFocus) slots[centreSlot(built)].button.focus({ preventScroll: true });
  }

  return {
    axis,
    visible,
    total,
    /** The distance from one slot to the next along the band, as it stands now. */
    pitch: () => pitch(sizes()),
    /** A slot's button, or undefined past the ones built: what a held page grows from. */
    slot(at: number) {
      return slots[at]?.button;
    },
    /** The centre slot's button: the page that is current, and what the open page grows from. */
    centre() {
      if (slots.length === 0) rebuild(total());
      return slots[centreSlot(slots.length)].button;
    },
    paint(page: number, draw: (target: HTMLCanvasElement, index: number) => void, open: boolean) {
      const built = total();
      if (built !== slots.length) rebuild(built);
      const now = axis();
      // The track rests where the band shows no empty slot (a turn of the phone leaves no stale
      // offset along the old axis); a drag in hand keeps its own place.
      restBefore = rest;
      rest = restShift(page, count, visible()) * pitch(sizes());
      if (track.dataset.dragging !== 'true') track.style.transform = shift(rest);
      const edge = band();
      root.dataset.axis = track.dataset.axis = leaf.dataset.axis = now;
      root.dataset.band = edge;
      rootElement.dataset.strip = edge;
      const vars = viewVars(edge);
      for (const key of ['bottom', 'left', 'right', 'backdrop'] as const) {
        const value = vars[key];
        if (value === null) rootElement.style.removeProperty(STRIP_VARS[key]);
        else rootElement.style.setProperty(STRIP_VARS[key], value);
      }
      const shown = windowOf(page, count, built);
      const centre = centreSlot(built);
      shown.forEach((index, at) => {
        const slot = slots[at];
        slot.button.dataset.empty = String(index === null);
        slot.button.setAttribute('aria-hidden', String(index === null));
        const centred = at === centre;
        const label = centred ? `Page ${(index ?? 0) + 1} of ${count}, ${open ? 'close' : 'open'} it` : `Go to page ${(index ?? 0) + 1} of ${count}`;
        slot.button.setAttribute('aria-label', index === null ? '' : label);
        if (centred) slot.button.setAttribute('aria-expanded', String(open));
        if (index !== null && slot.shows !== index) draw(slot.canvas, index);
        slot.shows = index;
      });
    },
    /** The track follows a drag: `travel` px along the band from where it rests, no transition. */
    drag(travel: number) {
      restBefore = rest;
      track.dataset.dragging = 'true';
      track.style.transform = shift(rest + travel);
    },
    /** The track slides to rest from `from` px off where it rested before the last paint (the pages stay put on screen as the page changes): set there without a transition, flushed, then let go. */
    slide(from: number) {
      track.dataset.dragging = 'true';
      track.style.transform = shift(restBefore + from);
      track.getBoundingClientRect();
      delete track.dataset.dragging;
      track.style.transform = shift(rest);
      restBefore = rest;
    },
    /** The room's view is whole again: the band is gone. */
    dispose() {
      for (const name of Object.values(STRIP_VARS)) rootElement.style.removeProperty(name);
      delete rootElement.dataset.strip;
    },
  };
}

const capitalised = (text: string) => text[0].toUpperCase() + text.slice(1);

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
