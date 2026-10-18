import { CLUSTER, MENU } from '../constants.js';

// The control cluster: one row in the upper right that lays out the screen's small
// controls — the menu button in the corner (first added, at the right), the ?tune gear to
// its left. The controls size themselves and never position themselves; this element owns
// the corner, so the catalog's thumbnail has the upper left alone and the bottom corners
// are free for the manual's strip. Follows the src/ui pattern (own element, own style).

const STYLE_ID = 'skruv-control-cluster';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .control-cluster {
      position: fixed;
      /* Above an open manual page (3) so the menu's drop is reachable over it; below the ?tune drawer (10). */
      z-index: 4;
      right: calc(${CLUSTER.inset}px + env(safe-area-inset-right));
      top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));
      display: flex;
      flex-direction: row-reverse;
      align-items: flex-start;
      gap: ${CLUSTER.gap}px;
    }
    /* Landscape, with the manual's band down one edge: the controls go to the other side, a column
       centred in the notch's margin (--rail-x, set when there is a notch) or, with no notch, in the
       corner. The band's side is html[data-strip]. */
    html[data-strip='right'] .control-cluster {
      right: auto;
      left: calc(var(--rail-x, ${CLUSTER.inset + MENU.size / 2}px) - ${MENU.size / 2}px);
      flex-direction: column;
    }
    html[data-strip='left'] .control-cluster {
      right: calc(100vw - var(--rail-x, 100vw) - ${MENU.size / 2}px);
      flex-direction: column;
    }
  `;
  document.head.append(style);
}

/** `{ element, add(control) }`: mount `element` once; `add` appends a control to the left of the rest. */
export function createControlCluster() {
  injectStyle();
  const element = document.createElement('div');
  element.className = 'control-cluster';
  return {
    element,
    add(control: HTMLElement) {
      element.append(control);
    },
  };
}
