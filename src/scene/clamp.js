// Pure clamp logic — no Three, no DOM — so Vitest covers it headlessly.

/** Device pixel ratio to render at: the device's own, capped at `max`. */
export function clampPixelRatio(devicePixelRatio, max) {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, max);
}

/** Seconds since last frame, never negative and never above `max`. */
export function clampDelta(deltaSeconds, max) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return 0;
  return Math.min(deltaSeconds, max);
}
