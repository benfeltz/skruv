import { COLORS, FASTENER, GESTURE, INSET } from '../constants.js';
import { createCrank } from '../game/crankMath.js';
import { ringRadians } from '../game/insetControls.js';
import { arcLength } from '../game/turnRing.js';
import { put } from './svgAttrs.js';
import type { ScreenPoint } from '../game/dragMath.js';
import type { Bubble } from '../game/insetControls.js';

// The controls on the detail inset: sub-bubbles attached to its circle as the manual's tool bubble is attached to its
// detail inset (a paper disc ringed in ink at the circle's own line weight, sitting partly on the rim and partly off
// it). The spinner holds a ring with a green arc of progress and an open chevron each way; the push control a down
// arrow, its bubble filled green once the dowel is home. They draw, and report the gestures made on them; which
// control shows, and what state it is in, are the panel's (src/scene/insetPanel.ts). The bubble is the whole grab; the
// rest of the circle is the picture's, and the SVG is not the canvas, so a press on a bubble never orbits the camera.

const STYLE_ID = 'skruv-inset-controls';
const SVG_NS = 'http://www.w3.org/2000/svg';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const { mark: MARK, arrow: ARROW } = INSET.controls;
// How far an arrowhead's two arms spread either side of the line, radians, as the manual's pictograms draw them.
const ARROWHEAD_SPREAD = 0.5;

/** What the spinner shows: how far in (0..1) and whether each way can still turn. */
export interface TurnLook {
  progress: number;
  tighten: boolean;
  loosen: boolean;
}

/** What the push control shows: filled green once the dowel is home, its arrowhead the way it can still go. */
export interface PushLook {
  seated: boolean;
  head: 'in' | 'out';
}

/** What the controls report: a sweep of the spinner (positive tightens), a tap on the push bubble to push home, a tap to back out. */
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
      top: 0;
      left: var(--strip-left, 0px);
      width: calc(100% - var(--strip-left, 0px) - var(--strip-right, 0px));
      height: calc(100% - var(--strip-bottom, 0px));
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
    .inset-controls__bubble {
      fill: ${css(COLORS.bookletPaper)};
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${INSET.ring.width};
    }
    .inset-controls__control[data-seated='true'] .inset-controls__bubble {
      fill: ${css(COLORS.insetFill)};
    }
    .inset-controls__track {
      fill: none;
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${MARK.width};
    }
    .inset-controls__arc {
      fill: none;
      stroke: ${css(COLORS.insetFill)};
      stroke-width: ${MARK.arcWidth};
    }
    .inset-controls__head,
    .inset-controls__arrow {
      fill: none;
      stroke: ${css(COLORS.bookletInk)};
      stroke-width: ${MARK.width};
      stroke-linecap: round;
      stroke-linejoin: round;
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

// An open chevron with its tip at (x, y), pointing along `angle` (screen radians), arms `size` long: the manual's arrowhead.
function chevron(x: number, y: number, angle: number, size: number) {
  const arm = (turn: number) => `${x - size * Math.cos(angle + turn)},${y - size * Math.sin(angle + turn)}`;
  return `${arm(-ARROWHEAD_SPREAD)} ${x},${y} ${arm(ARROWHEAD_SPREAD)}`;
}

// The spinner, drawn round the bubble's centre (the group's origin): the paper disc, a thin ink track and the green
// arc of progress from twelve o'clock clockwise, the tighten chevron at three pointing clockwise and the loosen one at
// nine pointing anticlockwise. A press on the disc starts a sweep about its centre. The centre is in the overlay's px,
// which start where the view does, so a press reads where the overlay stands (`origin`) once and brings each client point into them.
function createTurn({ onTurn }: InsetControlHandlers, origin: () => ScreenPoint) {
  const group = svg('g', 'inset-controls__control inset-controls__turn');
  const disc = svg('circle', 'inset-controls__bubble');
  const track = svg('circle', 'inset-controls__track');
  const arc = svg('circle', 'inset-controls__arc');
  const tighten = svg('polyline', 'inset-controls__head');
  const loosen = svg('polyline', 'inset-controls__head');
  arc.setAttribute('transform', 'rotate(-90)');
  group.append(disc, track, arc, tighten, loosen);

  let centre: ScreenPoint = [0, 0];
  let crank: ReturnType<typeof createCrank> | null = null;
  let from: ScreenPoint = [0, 0];
  const inOverlay = (event: PointerEvent): ScreenPoint => [event.clientX - from[0], event.clientY - from[1]];
  const end = () => {
    crank = null;
  };
  group.addEventListener('pointerdown', (event) => {
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    from = origin();
    crank = createCrank(FASTENER.crankDeadzone);
    crank.move(centre, inOverlay(event));
  });
  group.addEventListener('pointermove', (event) => {
    const sweep = crank?.move(centre, inOverlay(event));
    if (sweep) onTurn(ringRadians(sweep));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) group.addEventListener(type, end);

  return {
    group,
    show(at: ScreenPoint, radius: number, { progress, tighten: canTighten, loosen: canLoosen }: TurnLook) {
      centre = at;
      const ring = radius * MARK.radius;
      put(group, 'transform', `translate(${at[0]} ${at[1]})`);
      put(disc, 'r', radius);
      put(track, 'r', ring);
      put(arc, 'r', ring);
      put(arc, 'stroke-dasharray', `${arcLength(progress, ring)} ${arcLength(1, ring)}`);
      put(tighten, 'points', chevron(ring, 0, Math.PI / 2, radius * MARK.arrowSize));
      put(loosen, 'points', chevron(-ring, 0, Math.PI / 2, radius * MARK.arrowSize));
      for (const [head, shown] of [[tighten, canTighten], [loosen, canLoosen]] as const) {
        if (shown) head.removeAttribute('hidden');
        else head.setAttribute('hidden', '');
      }
    },
  };
}

// The push bubble, drawn round its centre: the paper disc (green once seated) and a down arrow, flipped to point up
// once the dowel is home and can only come out. A tap on the disc is the button.
function createPush({ onPush, onPull }: InsetControlHandlers) {
  const group = svg('g', 'inset-controls__control inset-controls__push');
  const disc = svg('circle', 'inset-controls__bubble');
  const arrow = svg('polyline', 'inset-controls__arrow');
  const base = svg('line', 'inset-controls__arrow');
  group.append(disc, arrow, base);

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
    show(at: ScreenPoint, radius: number, look: PushLook) {
      pointing = look.head;
      put(group, 'transform', `translate(${at[0]} ${at[1]})`);
      put(group, 'data-seated', String(look.seated));
      put(disc, 'r', radius);
      // The shaft down from the top, the chevron at its foot, over a baseline: the surface it presses onto. Only the arrow
      // flips to point up once home; the baseline stays under it.
      const half = (radius * ARROW.length) / 2;
      const size = radius * ARROW.head;
      const floor = (half * 2 + radius * ARROW.base.gap) / 2;
      put(arrow, 'transform', `translate(0 ${-radius * ARROW.base.gap / 2})${look.head === 'out' ? ' scale(1 -1)' : ''}`);
      put(arrow, 'points', `0,${-half} 0,${half} ${chevron(0, half, Math.PI / 2, size)}`);
      put(base, 'x1', -radius * ARROW.base.width / 2);
      put(base, 'x2', radius * ARROW.base.width / 2);
      put(base, 'y1', floor);
      put(base, 'y2', floor);
    },
  };
}

/**
 * The controls overlay, appended to `container` and hidden until `showTurn` or `showPush`: the spinner or the push
 * bubble, drawn in the bubble it is given, the other hidden. Built once; a frame only rewrites attributes.
 */
export function createInsetControls(container: HTMLElement, handlers: InsetControlHandlers) {
  injectStyle();
  const element = document.createElementNS(SVG_NS, 'svg');
  element.setAttribute('class', 'inset-controls');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('hidden', '');
  const turn = createTurn(handlers, () => {
    const { left, top } = element.getBoundingClientRect();
    return [left, top];
  });
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
    /** The spinner drawn in `bubble` (where the panel attached it to the circle, whatever its size), with `look`; the push bubble away. */
    showTurn({ centre, radius }: Bubble, look: TurnLook) {
      toggle(turn.group, true);
      toggle(push.group, false);
      turn.show(centre, radius, look);
      element.removeAttribute('hidden');
    },
    /** The push bubble drawn in `bubble`, with `look`; the spinner away. */
    showPush({ centre, radius }: Bubble, look: PushLook) {
      toggle(turn.group, false);
      toggle(push.group, true);
      push.show(centre, radius, look);
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
