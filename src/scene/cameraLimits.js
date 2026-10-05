// Pure orbit-limit geometry — no Three, no DOM — so Vitest covers it headlessly.
//
// The orbit target is confined to a sphere of `maxTargetRadius` around `pivot`; the camera
// sits `distance` from the target at a polar angle in [minPolarAngle, maxPolarAngle].
// Worst case horizontally:
//   |camera.xz| <= |pivot.xz| + maxTargetRadius + distance
// Height is deliberately unbounded above (1.4.1 dollhouse view): zoomed out, the camera
// rises over the wall tops and the inward-facing walls vanish from outside. The floor stays
// protected by maxPolarAngle and the pivot — see minCameraHeight.

/** Largest orbit distance that keeps the camera `wallMargin` inside the walls horizontally. */
export function maxOrbitDistance(room, limits) {
  const [pivotX, , pivotZ] = limits.pivot;
  const { maxTargetRadius, wallMargin } = limits;

  const horizontalReach = Math.min(
    room.width / 2 - Math.abs(pivotX),
    room.depth / 2 - Math.abs(pivotZ),
  );
  return horizontalReach - wallMargin - maxTargetRadius;
}

/** Lowest the camera can get: target at its lowest, camera at minDistance and maxPolarAngle. */
export function minCameraHeight(limits) {
  const [, pivotY] = limits.pivot;
  return pivotY - limits.maxTargetRadius + limits.minDistance * Math.cos(limits.maxPolarAngle);
}
