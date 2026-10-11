import { COLORS, TURN_RING } from '../constants.js';
import { arcLength } from '../game/turnRing.js';
import type { ScreenPoint } from '../game/dragMath.js';

// The turn ring: a flat dial over the head of each fastener a seated tool can still drive —
// a ring, two arrowheads the tightening way, and an arc filling as it goes home. It only
// draws, in client px over the canvas; where the dials are and what a press on one does are
// the router's (src/scene/gestureRouter.ts), so it never takes a pointer itself.

const STYLE_ID = 'skruv-turn-ring';
const SVG_NS = 'http://www.w3.org/2000/svg';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** One dial to draw: round `centre` (client px), `progress` 0..1 home, arrows clockwise or not. */
export interface Dial {
  centre: ScreenPoint;
  progress: number;
  clockwise: boolean;
  flashing: boolean;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .turn-ring {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .turn-ring[hidden],
    .turn-ring__dial[hidden] {
      display: none;
    }
    .turn-ring__track {
      fill: none;
      stroke: ${css(COLORS.uiText)};
      stroke-opacity: 0.55;
    }
    .turn-ring__arc {
      fill: none;
      stroke: ${css(COLORS.uiAccent)};
      stroke-linecap: round;
    }
    .turn-ring__arrow {
      fill: ${css(COLORS.uiText)};
      stroke: ${css(COLORS.uiSurface)};
      stroke-width: 1;
      stroke-linejoin: round;
    }
    .turn-ring__dial[data-flashing='true'] .turn-ring__track {
      stroke: ${css(COLORS.uiAccent)};
      stroke-opacity: 1;
    }
    .turn-ring__dial[data-flashing='true'] .turn-ring__arrow {
      fill: ${css(COLORS.uiAccent)};
    }
  `;
  document.head.append(style);
}

const svg = (tag: string, className: string) => {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute('class', className);
  return node;
};

// One dial's elements, built once and reused frame to frame. Drawn round the origin and
// moved by its group: the arc starts at twelve o'clock and runs clockwise (an anticlockwise
// dial is the same, mirrored); the arrowheads sit at three and nine, pointing along the ring.
function createDialElements() {
  const { radius, width, arcWidth, arrowSize: s } = TURN_RING;
  const group = svg('g', 'turn-ring__dial');
  const track = svg('circle', 'turn-ring__track');
  track.setAttribute('r', String(radius));
  track.setAttribute('stroke-width', String(width));
  const arc = svg('circle', 'turn-ring__arc');
  arc.setAttribute('r', String(radius));
  arc.setAttribute('stroke-width', String(arcWidth));
  const arrows = svg('g', 'turn-ring__arrows');
  const arrowAt3 = `${radius},${s / 2} ${radius - s / 2},${-s / 2} ${radius + s / 2},${-s / 2}`;
  for (const turn of [0, 180]) {
    const arrow = svg('polygon', 'turn-ring__arrow');
    arrow.setAttribute('points', arrowAt3);
    arrow.setAttribute('transform', `rotate(${turn})`);
    arrows.append(arrow);
  }
  group.append(track, arc, arrows);
  return { group, arc, arrows };
}

/**
 * The dial overlay, appended to `container` and hidden until `show(dials)`; one group per
 * dial, grown on demand and reused, so a frame only rewrites attributes. `hide()` hides them
 * all. Sizes read TURN_RING when a dial is first built.
 */
export function createTurnRing(container: HTMLElement) {
  injectStyle();
  const element = document.createElementNS(SVG_NS, 'svg');
  element.setAttribute('class', 'turn-ring');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('hidden', '');
  container.append(element);
  const pool: ReturnType<typeof createDialElements>[] = [];

  function hide() {
    element.setAttribute('hidden', '');
  }

  return {
    element,
    show(dials: readonly Dial[]) {
      if (dials.length === 0) return hide();
      while (pool.length < dials.length) {
        const made = createDialElements();
        element.append(made.group);
        pool.push(made);
      }
      const circumference = arcLength(1);
      pool.forEach(({ group, arc, arrows }, i) => {
        const dial = dials[i];
        if (!dial) return group.setAttribute('hidden', '');
        group.removeAttribute('hidden');
        group.setAttribute('transform', `translate(${dial.centre[0]} ${dial.centre[1]})`);
        group.setAttribute('data-flashing', String(dial.flashing));
        const mirror = dial.clockwise ? '' : 'scale(-1 1) ';
        arc.setAttribute('transform', `${mirror}rotate(-90)`);
        arc.setAttribute('stroke-dasharray', `${arcLength(dial.progress)} ${circumference}`);
        arrows.setAttribute('transform', mirror.trim());
      });
      element.removeAttribute('hidden');
    },
    hide,
  };
}
