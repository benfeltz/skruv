import { COLORS, RESET } from '../constants.js';

// The repack button, top right: everything of the player's back in the box. A first tap
// only arms it ("Tap again to repack"); a second within RESET.confirmMs repacks, and the
// arm lapses on its own. Follows the src/ui pattern (own element, own style).

const STYLE_ID = 'skruv-reset-button';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const LABEL = 'Repack';
const ARMED_LABEL = 'Tap again to repack';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .reset-button {
      position: fixed;
      right: calc(16px + env(safe-area-inset-right));
      top: calc(16px + env(safe-area-inset-top));
      min-height: 44px;
      padding: 0 16px;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 22px;
      background: ${css(COLORS.uiSurface)}e6;
      color: ${css(COLORS.uiText)};
      font: 600 15px/1 system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }
    .reset-button[data-armed='true'] {
      border-color: ${css(COLORS.uiAccent)};
      color: ${css(COLORS.uiAccent)};
    }
    .reset-button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
  `;
  document.head.append(style);
}

/** `{ element }`; `onReset()` runs on the confirming second tap. */
export function createResetButton({ onReset }: { onReset: () => void }) {
  injectStyle();
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'reset-button';
  let timer: ReturnType<typeof setTimeout> | null = null;

  function arm(armed: boolean) {
    clearTimeout(timer ?? undefined);
    timer = armed ? setTimeout(() => arm(false), RESET.confirmMs) : null;
    element.dataset.armed = String(armed);
    element.textContent = armed ? ARMED_LABEL : LABEL;
    element.setAttribute('aria-label', armed ? 'Tap again to put every part back in the box' : 'Repack: put every part back in the box');
  }

  element.addEventListener('click', () => {
    if (element.dataset.armed !== 'true') return arm(true);
    arm(false);
    onReset();
  });
  arm(false);

  return { element };
}
