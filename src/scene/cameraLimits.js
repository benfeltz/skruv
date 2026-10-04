// Pure orbit-limit geometry — no Three, no DOM — so Vitest covers it headlessly.
//
// The orbit target is confined to a sphere of `maxTargetRadius` around `pivot`; the camera
// sits `distance` from the target at a polar angle in [minPolarAngle, maxPolarAngle].
// Worst cases:
//   horizontal  |camera.xz| <= |pivot.xz| + maxTargetRadius + distance
//   height       camera.y   <= pivot.y + maxTargetRadius + distance * cos(minPolarAngle)

/** Largest orbit distance that keeps the camera `wallMargin` inside the walls and below their tops. */
export function maxOrbitDistance(room, limits) {
  const [pivotX, pivotY, pivotZ] = limits.pivot;
  const { maxTargetRadius, wallMargin, minPolarAngle } = limits;

  const horizontalReach = Math.min(
    room.width / 2 - Math.abs(pivotX),
    room.depth / 2 - Math.abs(pivotZ),
  );
  const byWalls = horizontalReach - wallMargin - maxTargetRadius;
  const byWallTops =
    (room.height - wallMargin - (pivotY + maxTargetRadius)) / Math.cos(minPolarAngle);

  return Math.min(byWalls, byWallTops);
}

/** Lowest the camera can get: target at its lowest, camera at minDistance and maxPolarAngle. */
export function minCameraHeight(limits) {
  const [, pivotY] = limits.pivot;
  return pivotY - limits.maxTargetRadius + limits.minDistance * Math.cos(limits.maxPolarAngle);
}
