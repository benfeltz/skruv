import { TUNE } from '../constants.js';

/**
 * Samples the loop's frame rate and decides, frame by frame, whether to render it. Under
 * sustained load (below `fpsFloor` for `fpsWindow` seconds) it renders every other frame;
 * once the rate holds at `fpsRecover` (or the floor, if higher) for `fpsWindow` it renders
 * every frame again. `frame(delta)` returns `{ render, sample }`, `sample` being
 * `{ fps, skipping }` once per `fpsSampleSeconds`, else null. Reads `config` (TUNE by
 * default) at use time, so its knobs tune live. Pure: no DOM, Three or Rapier.
 */
// Frame deltas summed over a sample fall a hair short of whole seconds.
const EPSILON = 1e-9;

export function createFpsGuard(config = TUNE) {
  let frames = 0;
  let elapsed = 0;
  // Seconds the rate has been past the threshold that would flip the mode.
  let held = 0;
  let skipping = false;
  let odd = false;

  function judge(fps, seconds) {
    const floor = config.fpsFloor;
    const flips = skipping ? floor <= 0 || fps >= Math.max(config.fpsRecover, floor) : floor > 0 && fps < floor;
    held = flips ? held + seconds : 0;
    if (held < config.fpsWindow - EPSILON) return;
    skipping = !skipping;
    held = 0;
  }

  function frame(delta) {
    frames++;
    elapsed += delta;
    let sample = null;
    if (elapsed >= config.fpsSampleSeconds - EPSILON) {
      const fps = frames / elapsed;
      judge(fps, elapsed);
      sample = { fps, skipping };
      frames = 0;
      elapsed = 0;
    }
    odd = !odd;
    return { render: !skipping || odd, sample };
  }

  return {
    frame,
    get skipping() {
      return skipping;
    },
  };
}
