import { COLORS } from '../constants.js';

// The src/ui pattern: a module builds its own element with plain DOM calls, owns the
// <style> it needs (injected once), takes colours from COLORS, and returns a small API.
// No framework; the caller decides where to mount it.

const STYLE_ID = 'skruv-toggle-button';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .toggle-button {
      position: fixed;
      right: calc(16px + env(safe-area-inset-right));
      bottom: calc(16px + env(safe-area-inset-bottom));
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
    .toggle-button[aria-pressed='true'] {
      border-color: ${css(COLORS.uiAccent)};
      background: ${css(COLORS.uiAccent)};
      color: ${css(COLORS.uiSurface)};
    }
    .toggle-button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
  `;
  document.head.append(style);
}

/**
 * A pressed/unpressed button. `onChange(pressed)` fires on every toggle; the pressed
 * state shows as the accent fill and `aria-pressed`.
 */
export function createToggleButton({ label, pressed = false, onChange }: { label: string; pressed?: boolean; onChange?: (pressed: boolean) => void }) {
  injectStyle();
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'toggle-button';
  element.textContent = label;

  let state = pressed;
  const render = () => element.setAttribute('aria-pressed', String(state));
  render();

  element.addEventListener('click', () => {
    state = !state;
    render();
    onChange?.(state);
  });

  return {
    element,
    get pressed() {
      return state;
    },
  };
}
