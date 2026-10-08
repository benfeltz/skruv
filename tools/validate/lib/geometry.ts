// Pose maths shared by the game and the validator: quaternions as [x, y, z, w], vectors
// as [x, y, z], poses as `{ position, rotation }`. Pure and dependency-free.

/** A vector or point `[x, y, z]`, metres (the schema's `vector`). */
export type Vec3 = [number, number, number];
/** A box's full extents `[x, y, z]`, metres (the schema's `size`). */
export type Size = Vec3;
/** A rotation quaternion `[x, y, z, w]` (the schema's `quaternion`). */
export type Quat = [number, number, number, number];
/** Where something sits: a position and a rotation. */
export interface Pose {
  position: Vec3;
  rotation: Quat;
}
/** A part-local or world connector frame: where it is and the way it points. */
export interface Frame {
  position: Vec3;
  axis: Vec3;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const conjugate = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];

export function normalizeQuaternion(q: Quat): Quat {
  const n = Math.hypot(...q);
  // map keeps the length; TS widens a mapped tuple to number[].
  return q.map((c) => c / n) as Quat;
}

/** Hamilton product a·b: rotation b, then a. */
export function multiplyQuaternions([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): Quat {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector([qx, qy, qz, qw]: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [qx, qy, qz];
  // map keeps the length; TS widens a mapped tuple to number[].
  const t = cross(u, v).map((c) => 2 * c) as Vec3;
  return add(add(v, t.map((c) => qw * c) as Vec3), cross(u, t));
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d < -1 + 1e-9) {
    // Opposite: half turn about any axis perpendicular to `from`.
    const ortho = Math.abs(from[0]) < 0.9 ? cross(from, [1, 0, 0]) : cross(from, [0, 1, 0]);
    const n = Math.sqrt(dot(ortho, ortho));
    return [ortho[0] / n, ortho[1] / n, ortho[2] / n, 0];
  }
  return normalizeQuaternion([...cross(from, to), 1 + d]);
}

/** World-space `{ position, axis }` of a part-local connector at `pose`. */
export function connectorInWorld(connector: Frame, pose: Pose): Frame {
  return {
    position: add(rotateVector(pose.rotation, connector.position), pose.position),
    axis: rotateVector(pose.rotation, connector.axis),
  };
}

/** True when world `point` lies inside a box of `size` posed at `pose`. */
export function contains(size: Size, pose: Pose, point: Vec3, tolerance = 1e-9) {
  const local = rotateVector(conjugate(pose.rotation), sub(point, pose.position));
  return local.every((v, i) => Math.abs(v) <= size[i] / 2 + tolerance);
}

/** A layout's poses carried by a rigid placement `{ position, rotation }` — e.g. against a wall. */
export function placeLayout<T extends Pose>(parts: T[], { position, rotation }: Pose): T[] {
  return parts.map((part) => ({
    ...part,
    position: add(rotateVector(rotation, part.position), position),
    rotation: multiplyQuaternions(rotation, part.rotation),
  }));
}
