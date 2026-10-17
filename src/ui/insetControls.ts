import { COLORS, FASTENER, GESTURE, INSET } from '../constants.js';
import { createCrank } from '../game/crankMath.js';
import { ringGeometry, ringGrab, ringRadians } from '../game/insetControls.js';
import { arcLength } from '../game/turnRing.js';
import { put } from './svgAttrs.js';
import type { ScreenPoint } from '../game/dragMath.js';
import type { InsetFrame } from '../game/insetView.js';

// The controls beside the detail inset's circle: the turn ring (grabbed and swept to turn the tool, its arc at the
// fastener's progress, an arrowhead gone from each way that is at its stop) and the push arrow (a button: a tap
// seats the dowel home and turns it green, a second backs it out). They draw, and report the gestures made on
// them; which control shows, where, and what state it is in are the panel's (src/scene/insetPanel.ts). The SVG
// is not the canvas, so a press on a control never reaches the camera's orbit.

const STYLE_ID = 'skruv-inset-controls';
const SVG_NS = 'http://www.w3.org/2000/svg';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const { ring: RING, arrow: ARROW } = INSET.controls;
// How far an arrowhead's two arms spread either side of the line, radians, as the manual's pictograms draw them.
const ARROWHEAD_SPREAD = 0.5;

/** What the ring shows: how far in (0..1) and whether each way can still turn. */
export interface TurnLook {
  progress: number;
  tighten: boolean;
  loosen: boolean;
}

/** What the arrow shows: green once the dowel is home, its head the way it can still go. */
export interface PushLook {
  seated: boolean;
  head: 'in' | 'out';
}

/** What the controls report: a sweep of the ring (positive tightens), a tap on the arrow to push home, a tap to back out. */
export interface InsetControlHandlers {
  onTurn(radians: number): void;
  onPush(): void;
  onPull(): void;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .inset-controls {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .inset-controls[hidden],
    .inset-controls__control[hidden],
    .inset-controls__head[hidden] {
      display: none;
    }
    .inset-controls__control {
      pointer-events: auto;
      touch-action: none;
    }
    .inset-controls[data-inert='true'] .inset-controls__control {
      pointer-events: none;
    }
    .inset-controls__grab {
      fill: none;
      stroke: transparent;
    }
    .inset-controls__hit {
      fill: transparent;
    }
    .inset-controls__track {
      fill: none;
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${RING.width};
    }
    .inset-controls__arc {
      fill: none;
      stroke: ${css(COLORS.insetFill)};
      stroke-width: ${RING.arcWidth};
    }
    .inset-controls__head {
      fill: none;
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${RING.width};
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .inset-controls__shaft,
    .inset-controls__point {
      fill: ${css(COLORS.bookletInk)};
    }
    .inset-controls__control[data-seated='true'] .inset-controls__shaft,
    .inset-controls__control[data-seated='true'] .inset-controls__point {
      fill: ${css(COLORS.insetFill)};
    }
  `;
  document.head.append(style);
}

const svg = (tag: string, className: string) => {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute('class', className);
  return node;
};

const pointOf = (event: PointerEvent): ScreenPoint => [event.clientX, event.clientY];

// The ring, in the manual's Turn style — ink line art, an open chevron at each end — drawn round the circle's centre
// (the group's origin): a thin ink track and the green arc of progress from twelve o'clock clockwise, the tighten
// chevron at three pointing clockwise and the loosen one at nine pointing anticlockwise. Its grab is a transparent
// stroke over the band, so the circle inside it stays the picture's.
function createTurn({ onTurn }: InsetControlHandlers) {
  const group = svg('g', 'inset-controls__control inset-controls__turn');
  const grab = svg('circle', 'inset-controls__grab');
  const track = svg('circle', 'inset-controls__track');
  const arc = svg('circle', 'inset-controls__arc');
  const tighten = svg('polyline', 'inset-controls__head');
  const loosen = svg('polyline', 'inset-controls__head');
  arc.setAttribute('transform', 'rotate(-90)');
  group.append(grab, track, arc, tighten, loosen);

  let ring: InsetFrame = { centre: [0, 0], radius: 0 };
  let crank: ReturnType<typeof createCrank> | null = null;
  const end = () => {
    crank = null;
  };
  // A press anywhere on the band is the ring's — it never reaches the camera — and starts a sweep about the circle's centre.
  group.addEventListener('pointerdown', (event) => {
    if (!ringGrab(pointOf(event), ring)) return;
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    crank = createCrank(FASTENER.crankDeadzone);
    crank.move(ring.centre, pointOf(event));
  });
  group.addEventListener('pointermove', (event) => {
    const sweep = crank?.move(ring.centre, pointOf(event));
    if (sweep) onTurn(ringRadians(sweep));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) group.addEventListener(type, end);

  // An open chevron with its tip at (x, 0), pointing along `angle` (screen radians): the manual's arrowhead.
  const chevron = (x: number, angle: number) => {
    const s = RING.arrowSize;
    const back = (turn: number): string => `${x - s * Math.cos(angle + turn)},${-s * Math.sin(angle + turn)}`;
    return `${back(-ARROWHEAD_SPREAD)} ${x},0 ${back(ARROWHEAD_SPREAD)}`;
  };

  return {
    group,
    show(frame: InsetFrame, { progress, tighten: canTighten, loosen: canLoosen }: TurnLook) {
      ring = frame;
      const { radius, inner, outer } = ringGeometry(frame);
      put(group, 'transform', `translate(${frame.centre[0]} ${frame.centre[1]})`);
      put(grab, 'r', (inner + outer) / 2);
      put(grab, 'stroke-width', outer - inner);
      put(track, 'r', radius);
      put(arc, 'r', radius);
      put(arc, 'stroke-dasharray', `${arcLength(progress, radius)} ${arcLength(1, radius)}`);
      put(tighten, 'points', chevron(radius, Math.PI / 2));
      put(loosen, 'points', chevron(-radius, Math.PI / 2));
      for (const [head, shown] of [[tighten, canTighten], [loosen, canLoosen]] as const) {
        if (shown) head.removeAttribute('hidden');
        else head.setAttribute('hidden', '');
      }
    },
  };
}

// The arrow, drawn round its origin pointing down (in): a shaft and a head, with a taller invisible hit box. Out is the same, flipped.
function createPush({ onPush, onPull }: InsetControlHandlers) {
  const group = svg('g', 'inset-controls__control inset-controls__push');
  const grab = svg('rect', 'inset-controls__hit');
  const shaft = svg('rect', 'inset-controls__shaft');
  const point = svg('polygon', 'inset-controls__point');
  const { length, width, head, band } = ARROW;
  const reach = Math.max(width, head) + 2 * band;
  grab.setAttribute('x', String(-reach / 2));
  grab.setAttribute('y', String(-length / 2 - band));
  grab.setAttribute('width', String(reach));
  grab.setAttribute('height', String(length + 2 * band));
  shaft.setAttribute('x', String(-width / 2));
  shaft.setAttribute('y', String(-length / 2));
  shaft.setAttribute('width', String(width));
  shaft.setAttribute('height', String(length - head));
  point.setAttribute('points', `${-head / 2},${length / 2 - head} ${head / 2},${length / 2 - head} 0,${length / 2}`);
  group.append(grab, shaft, point);

  let pointing: PushLook['head'] = 'in';
  let pressedAt: ScreenPoint | null = null;
  group.addEventListener('pointerdown', (event) => {
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    pressedAt = pointOf(event);
  });
  group.addEventListener('pointerup', (event) => {
    const from = pressedAt;
    pressedAt = null;
    if (from && Math.hypot(event.clientX - from[0], event.clientY - from[1]) <= GESTURE.tapMaxDistance) (pointing === 'in' ? onPush : onPull)();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    group.addEventListener(type, () => {
      pressedAt = null;
    });
  }

  return {
    group,
    show(at: ScreenPoint, look: PushLook) {
      pointing = look.head;
      put(group, 'transform', `translate(${at[0]} ${at[1]})${look.head === 'out' ? ' scale(1 -1)' : ''}`);
      put(group, 'data-seated', String(look.seated));
    },
  };
}

/**
 * The controls overlay, appended to `container` and hidden until `showTurn` or `showPush`: the one control for
 * the ring or the arrow, centred on `centre` (client px), the other hidden. Built once; a frame only rewrites attributes.
 */
export function createInsetControls(container: HTMLElement, handlers: InsetControlHandlers) {
  injectStyle();
  const element = document.createElementNS(SVG_NS, 'svg');
  element.setAttribute('class', 'inset-controls');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('hidden', '');
  const turn = createTurn(handlers);
  const push = createPush(handlers);
  turn.group.setAttribute('hidden', '');
  push.group.setAttribute('hidden', '');
  element.append(turn.group, push.group);
  container.append(element);

  const toggle = (group: Element, shown: boolean) => {
    if (shown) group.removeAttribute('hidden');
    else group.setAttribute('hidden', '');
  };

  return {
    element,
    /** The turn ring round the circle `frame` with `look`, the arrow away. */
    showTurn(frame: InsetFrame, look: TurnLook) {
      toggle(turn.group, true);
      toggle(push.group, false);
      turn.show(frame, look);
      element.removeAttribute('hidden');
    },
    /** The push arrow at `centre` with `look`, the ring away. */
    showPush(centre: ScreenPoint, look: PushLook) {
      toggle(turn.group, false);
      toggle(push.group, true);
      push.show(centre, look);
      element.removeAttribute('hidden');
    },
    /** While a press is on the canvas (a part carried, the camera orbited) the controls take no pointer: nothing under the finger steals its moves. */
    setInert(inert: boolean) {
      put(element, 'data-inert', String(inert));
    },
    hide() {
      element.setAttribute('hidden', '');
    },
  };
}

export type InsetControls = ReturnType<typeof createInsetControls>;
