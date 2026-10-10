import { COLORS, LIFT_LINE } from '../constants.js';
import { pressOnKnob } from '../game/liftLine.js';

// The elevation line: a vertical line with a knob for the held part's height. It only
// reports touches and draws the knob — what a press does is the caller's (src/main.ts).

const STYLE_ID = 'skruv-lift-line';
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .lift-line {
      position: fixed;
      transform: translateX(-50%);
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
      cursor: ns-resize;
    }
    .lift-line[hidden] {
      display: none;
    }
    .lift-line__track {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      border-radius: 999px;
      background: ${css(COLORS.uiText)}66;
    }
    .lift-line__knob {
      position: absolute;
      left: 50%;
      transform: translate(-50%, -50%);
      box-sizing: border-box;
      border: 2px solid ${css(COLORS.uiText)};
      border-radius: 50%;
      background: ${css(COLORS.uiAccent)};
      box-shadow: 0 1px 4px #0006;
    }
    .lift-line[data-pressed='true'] .lift-line__knob {
      background: ${css(COLORS.uiText)};
      border-color: ${css(COLORS.uiAccent)};
    }
  `;
  document.head.append(style);
}

/** What the line reports: a press (on the knob or the line), its moves, and its end. */
export interface LiftLineHandlers {
  onPress(fraction: number, onKnob: boolean): void;
  onMove(fraction: number): void;
  onRelease(): void;
}

/**
 * The line and its knob, hidden until `show(fraction)` (0 = floor, 1 = ceiling). A press
 * captures its pointer and reports `onPress(fraction, onKnob)`, then `onMove(fraction)`;
 * `onRelease()` fires exactly once per press — on up, cancel or lost capture — so a hold
 * can never outlive the finger. One finger at a time; others are ignored. Placement reads
 * LIFT_LINE at use time, so the ?tune knobs move it live.
 */
export function createLiftLine({ onPress, onMove, onRelease }: LiftLineHandlers) {
  injectStyle();
  const element = document.createElement('div');
  element.className = 'lift-line';
  element.hidden = true;
  element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', 'Lift');
  element.setAttribute('aria-orientation', 'vertical');
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', '100');
  const track = document.createElement('div');
  track.className = 'lift-line__track';
  const knob = document.createElement('div');
  knob.className = 'lift-line__knob';
  element.append(track, knob);

  let shown = 0;
  let pointerId: number | null = null;

  // The line's place on screen, its whole touch band inside the safe area at either edge.
  function place() {
    const { x, top, bottom, knobRadius, lineWidth, hitWidth } = LIFT_LINE;
    const style = element.style;
    const half = hitWidth / 2;
    style.left = `clamp(calc(env(safe-area-inset-left) + ${half}px), ${x * 100}vw, calc(100vw - env(safe-area-inset-right) - ${half}px))`;
    style.top = `max(${top * 100}vh, calc(env(safe-area-inset-top) + ${knobRadius}px))`;
    style.height = `${(bottom - top) * 100}vh`;
    style.width = `${hitWidth}px`;
    track.style.width = `${lineWidth}px`;
    knob.style.width = knob.style.height = `${knobRadius * 2}px`;
  }

  // The fraction under a pointer: 1 at the line's top, 0 at its bottom.
  function fractionAt(clientY: number) {
    const { top, height } = element.getBoundingClientRect();
    return Math.min(1, Math.max(0, 1 - (clientY - top) / height));
  }

  function knobY() {
    const { top, height } = element.getBoundingClientRect();
    return top + (1 - shown) * height;
  }

  element.addEventListener('pointerdown', (event) => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    element.setPointerCapture(event.pointerId);
    element.dataset.pressed = 'true';
    onPress(fractionAt(event.clientY), pressOnKnob(event.clientY, knobY(), LIFT_LINE.knobRadius));
  });

  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) onMove(fractionAt(event.clientY));
  });

  function end(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    element.dataset.pressed = 'false';
    onRelease();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) element.addEventListener(type, end);

  return {
    element,
    show(fraction: number) {
      shown = fraction;
      place();
      knob.style.top = `${(1 - fraction) * 100}%`;
      element.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      element.hidden = false;
    },
    hide() {
      element.hidden = true;
    },
  };
}
