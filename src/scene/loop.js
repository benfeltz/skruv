import { RENDER } from '../constants.js';
import { clampDelta } from './clamp.js';

const MS_PER_SECOND = 1000;

/** rAF loop calling `onFrame(deltaSeconds)` with the delta clamped. */
export function createLoop(onFrame) {
  let frameId = null;
  let lastTime = null;

  function tick(time) {
    const delta = lastTime === null ? 0 : (time - lastTime) / MS_PER_SECOND;
    lastTime = time;
    onFrame(clampDelta(delta, RENDER.maxFrameDelta));
    frameId = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (frameId !== null) return;
      lastTime = null;
      frameId = requestAnimationFrame(tick);
    },
    stop() {
      if (frameId === null) return;
      cancelAnimationFrame(frameId);
      frameId = null;
    },
  };
}
