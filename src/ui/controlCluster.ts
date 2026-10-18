import { CLUSTER } from '../constants.js';

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
    /* Portrait, with the manual's band along the bottom: the upper left, the menu in the corner and
       the ?tune gear to its right, so the lift line under the menu falls to the left thumb (Ben,
       2026-10-18); the catalog's thumb takes the upper right (src/ui/booklet.ts). */
    html[data-strip='bottom'] .control-cluster {
      right: auto;
      left: calc(${CLUSTER.inset}px + env(safe-area-inset-left));
      flex-direction: row;
    }
    /* Landscape, with the manual's band down one edge: the controls go to the other side, a column
       just inside the room's view — past the notch's margin, never in it (Ben's phone, 2026-10-18:
       in Safari the Dynamic Island covered the menu and the lift line in the margin). Where the
       browser reports no inset (Chrome on iOS keeps the page out of the notch itself) that is the
       page's edge. The band's side is html[data-strip]. */
    html[data-strip='right'] .control-cluster {
      right: auto;
      left: calc(${CLUSTER.inset}px + env(safe-area-inset-left));
      flex-direction: column;
    }
    html[data-strip='left'] .control-cluster {
      right: calc(${CLUSTER.inset}px + env(safe-area-inset-right));
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
