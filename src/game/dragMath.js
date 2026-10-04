// Drag and rotation math for part manipulation. Pure: plain [x, y, z] arrays in and out,
// no Three vector types, so Vitest covers it headlessly.

const PARALLEL_EPSILON = 1e-9;

/**
 * Where a ray meets the horizontal plane y = planeY, as [x, planeY, z]; null when the ray
 * runs parallel to the plane or points away from it.
 */
export function intersectDragPlane([ox, oy, oz], [dx, dy, dz], planeY) {
  if (Math.abs(dy) < PARALLEL_EPSILON) return null;
  const t = (planeY - oy) / dy;
  if (t < 0) return null;
  return [ox + t * dx, planeY, oz + t * dz];
}

/**
 * Clamps a part's centre so its [halfX, halfZ] footprint stays `margin` inside the walls
 * of a room centred on the origin. A part wider than the room is held at the centre line.
 */
export function clampToRoom([x, y, z], [halfX, halfZ], room, margin) {
  const limitX = Math.max(0, room.width / 2 - margin - halfX);
  const limitZ = Math.max(0, room.depth / 2 - margin - halfZ);
  return [Math.min(limitX, Math.max(-limitX, x)), y, Math.min(limitZ, Math.max(-limitZ, z))];
}

/**
 * Nearest detent to `angle` for detents every `step` radians; exact halfway points round
 * away from zero, so ±45° goes to ±90° symmetrically. A falsy step (free rotation)
 * returns the angle unchanged.
 */
export function quantizeAngle(angle, step) {
  if (!step) return angle;
  const detents = Math.round(Math.abs(angle) / step);
  return Math.sign(angle) * detents * step || 0;
}

/**
 * Signed angle swept around screen point `center` going from `from` to `to`, in
 * (-π, π]. Screen y grows downward, so a counter-clockwise sweep as seen is positive.
 */
export function arcDelta([cx, cy], [fx, fy], [tx, ty]) {
  const a0 = Math.atan2(cy - fy, fx - cx);
  const a1 = Math.atan2(cy - ty, tx - cx);
  let delta = a1 - a0;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}
