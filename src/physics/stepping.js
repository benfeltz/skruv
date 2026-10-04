/**
 * Fixed-timestep accumulator. `consume(delta)` banks frame time and returns how many
 * `fixedDt` steps to run now; the remainder carries into the next frame. Steps per frame
 * are capped so a long stall cannot spiral — time beyond the cap is dropped, not owed.
 */
export function createAccumulator(fixedDt, maxStepsPerFrame) {
  let banked = 0;

  return {
    consume(delta) {
      banked += delta;
      const steps = Math.min(Math.floor(banked / fixedDt), maxStepsPerFrame);
      banked -= steps * fixedDt;
      if (steps === maxStepsPerFrame && banked >= fixedDt) banked = 0;
      return steps;
    },
  };
}
