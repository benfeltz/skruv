import { COLORS, MENU } from '../constants.js';

// The src/ui pattern: a module builds its own element with plain DOM calls, owns the
// <style> it needs (injected once), takes colours from COLORS, and returns a small API.
// The menu button: a hamburger that opens a card hung from it holding the controls added to it
// as rows (Repack and Snap rotate, in the game). The caller decides where to mount it (the control
// cluster); the drop is placed against the button's own wrapper.

const STYLE_ID = 'skruv-menu-button';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .menu {
      position: relative;
    }
    .menu-button {
      width: ${MENU.size}px;
      height: ${MENU.size}px;
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 50%;
      background: ${css(COLORS.uiSurface)}e6;
      color: ${css(COLORS.uiText)};
      font: 600 ${MENU.glyph}px/1 system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }
    .menu-button[aria-expanded='true'] {
      border-color: ${css(COLORS.uiAccent)};
      color: ${css(COLORS.uiAccent)};
    }
    .menu-button:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
    /* One card hung from the button, its left edge on the button's: downward upright; to the right in
       landscape, where the lift line hangs under the menu, so it never covers it (Ben, 2026-10-23).
       Stacks within the control cluster, which sits above the manual's pages. */
    .menu-drop {
      position: absolute;
      top: calc(100% + ${MENU.drop.gap}px);
      left: 0;
      width: ${MENU.drop.width}px;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      overflow: hidden;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: ${MENU.drop.radius}px;
      background: ${css(COLORS.uiSurface)}f0;
    }
    html[data-strip='right'] .menu-drop {
      top: 0;
      left: calc(100% + ${MENU.drop.gap}px);
    }
    .menu-drop[hidden] {
      display: none;
    }
    /* Each control a full-width row of the card, a divider between: no pill of its own. */
    .menu-drop .reset-button, .menu-drop .toggle-button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: ${MENU.drop.row}px;
      padding: 0 ${MENU.drop.pad}px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: ${css(COLORS.uiText)};
      text-align: left;
    }
    .menu-drop > * + * {
      border-top: 1px solid ${css(COLORS.uiText)}24;
    }
    /* Repack's hold fills the row from its left edge. */
    .menu-drop .reset-button { position: relative; }
    .menu-drop .reset-fill { position: absolute; left: 0; top: 0; bottom: 0; margin: 0; }
    /* Snap rotate is a switch: a track at the row's end, gold when on. */
    .menu-drop .toggle-button::after {
      content: '';
      flex: none;
      width: ${MENU.drop.track.width}px;
      height: ${MENU.drop.track.height}px;
      border-radius: ${MENU.drop.track.height / 2}px;
      background: radial-gradient(circle at ${MENU.drop.track.height / 2}px 50%, ${css(COLORS.uiText)} 0 ${MENU.drop.track.height / 2 - 2}px, transparent ${MENU.drop.track.height / 2 - 1}px), ${css(COLORS.uiText)}40;
    }
    .menu-drop .toggle-button[aria-pressed='true'] {
      color: ${css(COLORS.uiText)};
    }
    .menu-drop .toggle-button[aria-pressed='true']::after {
      background: radial-gradient(circle at ${MENU.drop.track.width - MENU.drop.track.height / 2}px 50%, ${css(COLORS.uiText)} 0 ${MENU.drop.track.height / 2 - 2}px, transparent ${MENU.drop.track.height / 2 - 1}px), ${css(COLORS.uiAccent)};
    }
  `;
  document.head.append(style);
}

/**
 * `{ element, add(control), open, close, isOpen, dispose }`: mount `element` once; `add`
 * appends a control to the drop. The drop closes on a tap outside the menu, on Escape, and
 * after a click on a control in it — except one marked `data-menu-stay='true'` (Repack, a
 * hold: its tap leaves the menu open, and the completed hold closes it through the caller).
 * `add(control, { onClose })` runs `onClose` whenever the drop closes, so a control can drop
 * state it holds (Repack's hold in progress) rather than carry it across a close and reopen.
 */
export function createMenuButton({ name }: { name: string }) {
  injectStyle();
  const element = document.createElement('div');
  element.className = 'menu';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button';
  button.textContent = '☰';
  button.setAttribute('aria-label', name);
  button.setAttribute('aria-haspopup', 'menu');
  const drop = document.createElement('div');
  drop.className = 'menu-drop';
  drop.id = 'menu-drop';
  drop.setAttribute('role', 'menu');
  button.setAttribute('aria-controls', drop.id);
  element.append(button, drop);

  let opened = false;
  const closers: Array<() => void> = [];
  const render = () => {
    drop.hidden = !opened;
    button.setAttribute('aria-expanded', String(opened));
  };
  const open = () => {
    opened = true;
    render();
  };
  const close = () => {
    const wasOpen = opened;
    opened = false;
    render();
    if (wasOpen) for (const onClose of closers) onClose();
  };

  const onPointerDown = (event: { target: unknown }) => {
    if (opened && !element.contains(event.target as Node | null)) close();
  };
  const onKeyDown = (event: { key: string }) => {
    if (opened && event.key === 'Escape') close();
  };
  button.addEventListener('click', () => (opened ? close() : open()));
  drop.addEventListener('click', (event) => {
    const clicked = (event.target as Element | null)?.closest('button');
    if (clicked && (clicked as HTMLElement).dataset.menuStay !== 'true') close();
  });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeyDown);
  render();

  return {
    element,
    add(control: HTMLElement, { onClose }: { onClose?: () => void } = {}) {
      drop.append(control);
      if (onClose) closers.push(onClose);
    },
    open,
    close,
    isOpen: () => opened,
    dispose() {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      element.remove();
    },
  };
}
