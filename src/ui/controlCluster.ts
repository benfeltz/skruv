import { CLUSTER } from '../constants.js';

// The control cluster: one row in the upper left that lays out the screen's small controls —
// the menu button in the corner (first added), the ?tune gear to its right; a column in
// landscape. The controls size themselves and never position themselves; this element owns
// the corner, so the catalog's thumbnail has the upper right alone and the bottom edge (the
// right edge in landscape) is free for the manual's band. Follows the src/ui pattern (own
// element, own style).

const STYLE_ID = 'skruv-control-cluster';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* The upper left, the menu in the corner and the ?tune gear to its right, so the lift line under
       the menu falls to the left thumb (Ben, 2026-10-18); the catalog's thumb takes the upper right
       (src/ui/booklet.ts). From the first load on, so nothing swaps sides when a model is picked. */
    .control-cluster {
      position: fixed;
      /* Above an open manual page (3) so the menu's drop is reachable over it; below the ?tune drawer (10). */
      z-index: 4;
      left: calc(${CLUSTER.inset}px + env(safe-area-inset-left));
      top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: ${CLUSTER.gap}px;
    }
    /* Landscape: the band always stands on the right, so the controls stay on the left as a column, just
       inside the room's view — past the safe-area margin, never in it (Ben's phone, 2026-10-18: in
       Safari the Dynamic Island covered the menu and the lift line in the notch's margin). */
    html[data-strip='right'] .control-cluster {
      flex-direction: column;
    }
  `;
  document.head.append(style);
}

/** `{ element, add(control) }`: mount `element` once; `add` appends a control after the rest (to the right, or below in landscape). */
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
