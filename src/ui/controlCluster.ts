import { CLUSTER } from '../constants.js';

// The control cluster: one column in the upper right that lays out the screen's small
// buttons — Repack in the corner, Snap rotate below it, the ?tune gear below that. The
// buttons size themselves and never position themselves; this element owns the corner, so
// the catalog's thumbnail has the upper left alone and the bottom corners are free for the
// manual's strip. Follows the src/ui pattern (own element, own style).

const STYLE_ID = 'skruv-control-cluster';

/** The cluster's class, which the detail inset's panel finds it by to keep its controls clear. */
export const CLUSTER_CLASS = 'control-cluster';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${CLUSTER_CLASS} {
      position: fixed;
      right: calc(${CLUSTER.inset}px + env(safe-area-inset-right));
      top: calc(${CLUSTER.inset}px + env(safe-area-inset-top));
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: ${CLUSTER.gap}px;
    }
  `;
  document.head.append(style);
}

/** `{ element, add(control) }`: mount `element` once; `add` appends a control below the rest. */
export function createControlCluster() {
  injectStyle();
  const element = document.createElement('div');
  element.className = CLUSTER_CLASS;
  return {
    element,
    add(control: HTMLElement) {
      element.append(control);
    },
  };
}
