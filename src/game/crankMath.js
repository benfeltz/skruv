// Crank gesture math: circular finger motion around an engaged fastener's on-screen centre
// becomes signed turn. Pure: screen points [x, y] in CSS px (y down), radians out.

import { FASTENER } from '../constants.js';
import { arcDelta } from './dragMath.js';

/**
 * Accumulates the clockwise-positive angle a pointer sweeps about a centre that may move
 * between calls (the fastener sags, the part settles): each step is measured about the
 * centre given with it. Motion within `deadzone` px of the centre is dropped — the angle
 * swings wildly there — and the sweep picks up afresh once the pointer leaves it.
 */
export function createCrank(deadzone = FASTENER.crankDeadzone) {
  let last = null;
  let total = 0;

  return {
    /** Radians swept since the previous point (clockwise on screen positive). */
    move(center, point) {
      if (Math.hypot(point[0] - center[0], point[1] - center[1]) < deadzone) {
        last = null;
        return 0;
      }
      const delta = last ? -arcDelta(center, last, point) : 0;
      last = point;
      total += delta;
      return delta;
    },
    get total() {
      return total;
    },
  };
}

/**
 * +1 when a clockwise sweep on screen tightens: the camera looks along the fastener's
 * into-the-hole direction, so screen clockwise is clockwise seen from the head (a right-hand
 * thread). −1 when it looks from the far side. Both directions are world [x, y, z].
 */
export function tightenSign(intoHole, viewDirection) {
  const d = intoHole[0] * viewDirection[0] + intoHole[1] * viewDirection[1] + intoHole[2] * viewDirection[2];
  return d >= 0 ? 1 : -1;
}
