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
 * Clamps a lifted part's centre height so its bottom stays on or above the floor and its
 * top stays `margin` below the walls' tops. A part taller than that range sits on the floor.
 */
export function clampLift(y, halfHeight, room, margin) {
  const ceiling = Math.max(halfHeight, room.height - margin - halfHeight);
  return Math.min(ceiling, Math.max(halfHeight, y));
}

/**
 * How far (CSS px) a pointer has travelled from `start` to `point` along the on-screen
 * direction `axis` — negative when moving against it, 0 for a degenerate axis (one pointing
 * straight at the camera cannot be pulled along from this view).
 */
export function pullAlong([sx, sy], [x, y], [ax, ay]) {
  const length = Math.hypot(ax, ay);
  if (length < PARALLEL_EPSILON) return 0;
  return ((x - sx) * ax + (y - sy) * ay) / length;
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

/**
 * World-axis half-extents [x, y, z] of a box with half-sizes `half` turned by quaternion
 * [x, y, z, w] — the half-size of its world-aligned bounding box.
 */
export function rotatedHalfExtents([hx, hy, hz], [x, y, z, w]) {
  const rows = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  return rows.map(([a, b, c]) => Math.abs(a) * hx + Math.abs(b) * hy + Math.abs(c) * hz);
}

/**
 * True when a box centred at `position` with world half-extents [x, y, z] lies above the
 * floor and inside the walls of a room centred on the origin, give or take `tolerance`.
 */
export function fitsInRoom([x, y, z], [hx, hy, hz], room, tolerance = 0) {
  return (
    y - hy >= -tolerance &&
    Math.abs(x) + hx <= room.width / 2 + tolerance &&
    Math.abs(z) + hz <= room.depth / 2 + tolerance
  );
}
