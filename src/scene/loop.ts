import { RENDER } from '../constants.js';
import { clampDelta } from './clamp.js';

const MS_PER_SECOND = 1000;

/**
 * rAF loop calling `onFrame(deltaSeconds, rawDeltaSeconds)`: the delta clamped (what the
 * game steps by), and the true one (what a frame-rate measurement needs).
 */
export function createLoop(onFrame: (delta: number, rawDelta: number) => void) {
  let frameId: number | null = null;
  let lastTime: number | null = null;

  function tick(time: number) {
    const delta = lastTime === null ? 0 : (time - lastTime) / MS_PER_SECOND;
    lastTime = time;
    // Schedule before calling out, so stop()/start() inside onFrame act on the live frame id.
    frameId = requestAnimationFrame(tick);
    onFrame(clampDelta(delta, RENDER.maxFrameDelta), delta);
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
