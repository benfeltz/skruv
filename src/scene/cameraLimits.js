// Pure orbit-limit geometry — no Three, no DOM — so Vitest covers it headlessly.
//
// The orbit target may go anywhere over the floor — down to the parts lying on it, out to
// `targetMargin` inside the walls — so a pinch can bring the camera right up to any dowel
// and its hole. The camera itself is clamped every frame: `wallMargin` inside the walls
// horizontally, `floorClearance` above the floor, unbounded above (zoomed out it rises over
// the wall tops — the dollhouse view).

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The orbit target, held over the floor and inside the walls. */
export function clampTarget([x, y, z], room, limits) {
  const reachX = room.width / 2 - limits.targetMargin;
  const reachZ = room.depth / 2 - limits.targetMargin;
  const [low, high] = limits.targetHeight;
  return [clamp(x, -reachX, reachX), clamp(y, low, high), clamp(z, -reachZ, reachZ)];
}

/** The camera, held inside the walls horizontally and above the floor. */
export function clampCamera([x, y, z], room, limits) {
  const reachX = room.width / 2 - limits.wallMargin;
  const reachZ = room.depth / 2 - limits.wallMargin;
  return [clamp(x, -reachX, reachX), Math.max(limits.floorClearance, y), clamp(z, -reachZ, reachZ)];
}

/**
 * Pan speed multiplier at `distance` from the orbit target. OrbitControls pans in
 * proportion to that distance, which crawls once zoomed in on hardware; closer than
 * `panReference` the pan is boosted by panReference / distance, up to `maxPanBoost`.
 */
export function panSpeedAt(distance, { panReference, maxPanBoost }) {
  if (!(distance > 0)) return maxPanBoost;
  return Math.min(maxPanBoost, Math.max(1, panReference / distance));
}
