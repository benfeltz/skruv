import { COLORS, MENU } from '../constants.js';

// The src/ui pattern: a module builds its own element with plain DOM calls, owns the
// <style> it needs (injected once), takes colours from COLORS, and returns a small API.
// The menu button: a hamburger that opens a drop under it holding the controls added to it
// (Repack and Snap rotate, in the game). The caller decides where to mount it (the control
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
    /* Stacks within the control cluster, which sits above the manual's pages. */
    .menu-drop {
      position: absolute;
      top: calc(100% + ${MENU.drop.gap}px);
      right: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: ${MENU.drop.gap}px;
      padding: ${MENU.drop.pad}px;
      border-radius: ${MENU.drop.radius}px;
      background: ${css(COLORS.uiSurface)}e6;
    }
    /* The cluster on the screen's left (the band down the right edge, or along the bottom in
       portrait): the drop opens into the room. */
    html[data-strip='right'] .menu-drop, html[data-strip='bottom'] .menu-drop {
      right: auto;
      left: 0;
    }
    .menu-drop[hidden] {
      display: none;
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
