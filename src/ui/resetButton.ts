import { COLORS, RESET } from '../constants.js';

// The repack button, in the menu (src/ui/menuButton.ts): everything of the player's back in
// the box. It is a hold: a bar fills inside the button over RESET.holdMs of unbroken press,
// and the repack runs when it is full. Letting go, sliding off or closing the menu empties
// the bar and repacks nothing. The button keeps its size and its label throughout — the
// fill is the only thing that changes. Follows the src/ui pattern (own element, own style).

const STYLE_ID = 'skruv-reset-button';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const LABEL = 'Repack';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .reset-button {
      display: grid;
      align-items: center;
      min-height: ${RESET.height}px;
      padding: 0 16px;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 22px;
      overflow: hidden;
      background: ${css(COLORS.uiSurface)}e6;
      color: ${css(COLORS.uiText)};
      font: 600 15px/1 system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }
    .reset-button > * {
      grid-area: 1 / 1;
    }
    .reset-fill {
      justify-self: start;
      align-self: stretch;
      width: 0;
      margin: 0 -16px;
      background: ${css(COLORS.uiAccent)}66;
      pointer-events: none;
    }
    .reset-label {
      position: relative;
      text-align: center;
    }
    .reset-button[data-holding='true'] {
      border-color: ${css(COLORS.uiAccent)};
    }
    .reset-button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
  `;
  document.head.append(style);
}

/**
 * `{ element, cancel }`; `onReset()` runs when a hold of RESET.holdMs completes. `cancel()`
 * drops a hold in progress (the menu calls it as it closes).
 */
export function createResetButton({ onReset }: { onReset: () => void }) {
  injectStyle();
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'reset-button';
  element.setAttribute('aria-label', 'Repack: hold to put every part back in the box');
  // A tap on the button leaves the menu open: only a completed hold closes it (the caller).
  element.dataset.menuStay = 'true';
  const fill = document.createElement('span');
  fill.className = 'reset-fill';
  const label = document.createElement('span');
  label.className = 'reset-label';
  label.textContent = LABEL;
  element.append(fill, label);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    element.dataset.holding = 'false';
    fill.style.transition = 'none';
    fill.style.width = '0';
  }

  function start() {
    if (timer !== null) return;
    element.dataset.holding = 'true';
    fill.style.transition = 'none';
    fill.style.width = '0';
    void element.offsetWidth; // flush the empty bar, so the fill below animates from it
    fill.style.transition = `width ${RESET.holdMs}ms linear`;
    fill.style.width = 'calc(100% + 32px)';
    timer = setTimeout(() => {
      stop();
      onReset();
    }, RESET.holdMs);
  }

  element.addEventListener('pointerdown', (event) => {
    if ((event as PointerEvent).button === 0) start();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) element.addEventListener(type, stop);
  element.addEventListener('keydown', (event) => {
    const { key, repeat } = event as KeyboardEvent;
    if ((key === 'Enter' || key === ' ') && !repeat) start();
  });
  element.addEventListener('keyup', stop);
  // A long press is a hold here, not a context menu.
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  element.dataset.holding = 'false';

  return { element, cancel: stop };
}
