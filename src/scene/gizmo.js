import * as THREE from 'three';
import { COLORS, GESTURE, GIZMO, ROOM } from '../constants.js';
import { arcDelta, clampToRoom, quantizeAngle, rotatedHalfExtents } from '../game/dragMath.js';

const AXES = {
  x: { vector: new THREE.Vector3(1, 0, 0), color: COLORS.gizmoX, turn: [0, Math.PI / 2, 0] },
  y: { vector: new THREE.Vector3(0, 1, 0), color: COLORS.gizmoY, turn: [Math.PI / 2, 0, 0] },
  z: { vector: new THREE.Vector3(0, 0, 1), color: COLORS.gizmoZ, turn: [0, 0, 0] },
};
const RING_SEGMENTS = [12, 64];

/**
 * Rotate gizmo: three world-axis rings around the selected part, drawn on top. It renders
 * and hit-tests; the angle math (pointer arc, detents) is src/game/dragMath.js. Rotation
 * goes through physics `grab`/`move`/`release`, lifting the part so its new lowest point
 * clears the floor and clamping its turned footprint inside the walls (a kinematic body
 * passes through them), and drops it back under physics when the ring is let go.
 *
 * Plugs into src/scene/gestureRouter.js as its `rings` hook. `isFree()` reads the
 * free-rotate toggle; detents (GESTURE.detentStep) are the default.
 */
export function createGizmo({ camera, domElement, physics, isFree }) {
  const object = new THREE.Group();
  object.visible = false;
  const rings = [];
  const hitBands = [];

  for (const [axis, { color, turn }] of Object.entries(AXES)) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, GIZMO.tube, ...RING_SEGMENTS),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: GIZMO.opacity, depthTest: false }),
    );
    ring.rotation.set(...turn);
    ring.renderOrder = 1;
    // Never rendered — raycasts ignore visibility, so it widens the touch target.
    const band = new THREE.Mesh(new THREE.TorusGeometry(1, GIZMO.hitTube, ...RING_SEGMENTS));
    band.rotation.set(...turn);
    band.visible = false;
    band.userData.axis = axis;
    rings.push(ring);
    hitBands.push(band);
    object.add(ring, band);
  }

  let part = null;
  let turning = null;
  const quaternion = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  const toCamera = new THREE.Vector3();
  const projected = new THREE.Vector3();

  function show(next) {
    part = next;
    const { geometry } = part.mesh;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    object.scale.setScalar(Math.max(GIZMO.minRadius, geometry.boundingSphere.radius * GIZMO.radiusPadding));
    object.visible = true;
    update();
  }

  function hide() {
    if (turning) cancel();
    part = null;
    object.visible = false;
  }

  /** Follows the selected part; call once per frame. */
  function update() {
    if (part) object.position.copy(part.mesh.position);
  }

  function hitTest(raycaster) {
    if (!part) return null;
    const [first] = raycaster.intersectObjects(hitBands, false);
    return first ? { axis: first.object.userData.axis, distance: first.distance } : null;
  }

  function screenCentre() {
    projected.copy(part.mesh.position).project(camera);
    const rect = domElement.getBoundingClientRect();
    return [rect.left + ((projected.x + 1) / 2) * rect.width, rect.top + ((1 - projected.y) / 2) * rect.height];
  }

  function halfSizes() {
    const { width, height, depth } = part.mesh.geometry.parameters;
    return [width / 2, height / 2, depth / 2];
  }

  function start({ axis }, { x, y }) {
    if (!part) return;
    const { vector } = AXES[axis];
    toCamera.copy(camera.position).sub(part.mesh.position);
    turning = {
      axis: vector,
      // Sweeping counter-clockwise on screen turns positively about an axis facing the camera.
      sign: vector.dot(toCamera) >= 0 ? 1 : -1,
      centre: screenCentre(),
      last: [x, y],
      swept: 0,
      startRotation: part.mesh.quaternion.clone(),
      startPosition: part.mesh.position.toArray(),
    };
    rings.forEach((ring, i) => (ring.material.opacity = hitBands[i].userData.axis === axis ? 1 : GIZMO.opacity / 3));
    physics.grab(part.body);
  }

  function move({ x, y }) {
    if (!turning) return;
    turning.swept += arcDelta(turning.centre, turning.last, [x, y]);
    turning.last = [x, y];
    const angle = quantizeAngle(turning.sign * turning.swept, isFree() ? 0 : GESTURE.detentStep);
    step.setFromAxisAngle(turning.axis, angle);
    quaternion.multiplyQuaternions(step, turning.startRotation);
    const rotation = quaternion.toArray();
    const [hx, hy, hz] = rotatedHalfExtents(halfSizes(), rotation);
    const [px, py, pz] = turning.startPosition;
    const lifted = [px, Math.max(py, hy) + GESTURE.hoverLift, pz];
    physics.move(part.body, clampToRoom(lifted, [hx, hz], ROOM, GESTURE.wallMargin), rotation);
  }

  function end() {
    if (!turning) return;
    turning = null;
    rings.forEach((ring) => (ring.material.opacity = GIZMO.opacity));
    physics.release(part.body);
  }

  const cancel = end;

  return {
    object,
    show,
    hide,
    update,
    hitTest,
    start,
    move,
    end,
    cancel,
    get selected() {
      return part;
    },
  };
}
