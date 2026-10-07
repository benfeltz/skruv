// Pose maths shared by the game and the validator: quaternions as [x, y, z, w], vectors
// as [x, y, z], poses as `{ position, rotation }`. Pure and dependency-free.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const conjugate = ([x, y, z, w]) => [-x, -y, -z, w];

export function normalizeQuaternion(q) {
  const n = Math.hypot(...q);
  return q.map((c) => c / n);
}

/** Hamilton product a·b: rotation b, then a. */
export function multiplyQuaternions([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector([qx, qy, qz, qw], v) {
  const u = [qx, qy, qz];
  const t = cross(u, v).map((c) => 2 * c);
  return add(add(v, t.map((c) => qw * c)), cross(u, t));
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from, to) {
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
export function connectorInWorld(connector, pose) {
  return {
    position: add(rotateVector(pose.rotation, connector.position), pose.position),
    axis: rotateVector(pose.rotation, connector.axis),
  };
}

/** True when world `point` lies inside a box of `size` posed at `pose`. */
export function contains(size, pose, point, tolerance = 1e-9) {
  const local = rotateVector(conjugate(pose.rotation), sub(point, pose.position));
  return local.every((v, i) => Math.abs(v) <= size[i] / 2 + tolerance);
}

/** A layout's poses carried by a rigid placement `{ position, rotation }` — e.g. against a wall. */
export function placeLayout(parts, { position, rotation }) {
  return parts.map((part) => ({
    ...part,
    position: add(rotateVector(rotation, part.position), position),
    rotation: multiplyQuaternions(rotation, part.rotation),
  }));
}
