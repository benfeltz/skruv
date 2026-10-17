import { COLORS, INSET } from '../constants.js';
import { put } from './svgAttrs.js';
import type { ScreenPoint } from '../game/dragMath.js';
import type { InsetFrame } from '../game/insetView.js';

// The detail inset's ink: the manual's ring round the circle (src/scene/inset.ts draws what is
// inside it) and a tail from the rim to the joint it shows. It only draws, in client px over
// the canvas; where the circle is and what state it is in are the panel's
// (src/scene/insetPanel.ts), so it never takes a pointer itself.

const STYLE_ID = 'skruv-inset';
const SVG_NS = 'http://www.w3.org/2000/svg';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** What to draw: the circle's `frame`, the joint's screen point (`anchor`, or null), and whether the inset is `active` rather than offered. */
export interface InsetMark {
  frame: InsetFrame;
  anchor: ScreenPoint | null;
  active: boolean;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .inset {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .inset[hidden],
    .inset__tail[hidden] {
      display: none;
    }
    .inset__mark {
      transition: opacity ${INSET.fadeMs}ms;
    }
    .inset[data-state='offered'] .inset__mark {
      opacity: ${INSET.ring.offeredAlpha};
    }
    .inset[data-state='active'] .inset__mark {
      opacity: ${INSET.ring.activeAlpha};
    }
    .inset__ring {
      fill: none;
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${INSET.ring.width};
    }
    .inset__tail {
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${INSET.tail.width};
      stroke-linecap: round;
    }
    .inset__dot {
      fill: ${css(COLORS.bookletInk)};
    }
  `;
  document.head.append(style);
}

const svg = (tag: string, className: string) => {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute('class', className);
  return node;
};

/**
 * The ring and tail overlay, appended to `container` and hidden until `show(mark)`. Built
 * once; a frame only rewrites attributes. The ring is faint while the inset is offered and
 * full ink once it is active. The tail runs from the rim point nearest the joint to the joint,
 * and is hidden when the joint's screen point is itself inside the circle.
 */
export function createInsetOverlay(container: HTMLElement) {
  injectStyle();
  const element = document.createElementNS(SVG_NS, 'svg');
  element.setAttribute('class', 'inset');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('hidden', '');
  const mark = svg('g', 'inset__mark');
  const ring = svg('circle', 'inset__ring');
  const tail = svg('g', 'inset__tail');
  const line = svg('line', 'inset__line');
  const dot = svg('circle', 'inset__dot');
  dot.setAttribute('r', String(INSET.tail.dot));
  tail.append(line, dot);
  mark.append(ring, tail);
  element.append(mark);
  container.append(element);

  return {
    element,
    show({ frame: { centre, radius }, anchor, active }: InsetMark) {
      put(element, 'data-state', active ? 'active' : 'offered');
      put(ring, 'cx', centre[0]);
      put(ring, 'cy', centre[1]);
      put(ring, 'r', radius);
      const reach = anchor ? Math.hypot(anchor[0] - centre[0], anchor[1] - centre[1]) : 0;
      if (!anchor || reach <= radius) tail.setAttribute('hidden', '');
      else {
        const rim: ScreenPoint = [centre[0] + ((anchor[0] - centre[0]) / reach) * radius, centre[1] + ((anchor[1] - centre[1]) / reach) * radius];
        put(line, 'x1', rim[0]);
        put(line, 'y1', rim[1]);
        put(line, 'x2', anchor[0]);
        put(line, 'y2', anchor[1]);
        put(dot, 'cx', anchor[0]);
        put(dot, 'cy', anchor[1]);
        tail.removeAttribute('hidden');
      }
      element.removeAttribute('hidden');
    },
    hide() {
      element.setAttribute('hidden', '');
    },
  };
}

export type InsetOverlay = ReturnType<typeof createInsetOverlay>;
