import * as THREE from 'three';
import { GESTURE, ROOM, SNAP } from '../constants.js';
import { PART_TYPES } from '../game/catalog.js';
import { clampToRoom, fitsInRoom, intersectDragPlane, rotatedHalfExtents } from '../game/dragMath.js';
import { createGestureState, OWNER, resolveHit } from '../game/gestureState.js';
import { applyTransform, findSnap } from '../game/snapMath.js';

/**
 * Thin DOM adapter between pointer events and part manipulation. It raycasts, feeds
 * src/game/gestureState.js, and acts on the effects it returns; every decision (tap vs
 * drag, who owns a touch) is the state machine's.
 *
 * The camera is driven only through cameraControls' `enable()`/`disable()` seam, mirrored
 * from `state.cameraEnabled` after every event — so a touch that hits no part leaves the
 * camera exactly as before, and every end path (up, cancel, lost capture, page hidden)
 * hands it back.
 *
 * `parts` is the registry `[{ id, type, mesh, body }]`. Optional hooks:
 *   rings  — `{ selected, hitTest(raycaster), start(hit, pointer), move(pointer), end(),
 *            cancel() }`; which of ring and part a press lands on is `resolveHit`'s call.
 *   onTap  — called with the tapped part, or null for empty space.
 *   ghost  — `{ show(mesh, pose), hide() }` snap preview (src/scene/ghost.js).
 */
export function createGestureRouter({ domElement, camera, cameraControls, physics, parts, rings, onTap, ghost }) {
  const state = createGestureState();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = parts.map((part) => part.mesh);
  const partByMesh = new Map(parts.map((part) => [part.mesh, part]));
  const footprint = new THREE.Box3();
  const scratch = new THREE.Vector3();

  let drag = null;

  function aim({ clientX, clientY }) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function hitTest(event) {
    aim(event);
    const ring = rings?.hitTest(raycaster) ?? null;
    const [first] = raycaster.intersectObjects(meshes, false);
    const part = first
      ? { part: partByMesh.get(first.object), point: first.point.toArray(), distance: first.distance }
      : null;
    return resolveHit(ring, part, rings?.selected);
  }

  const pointer = (event, hit = null) => ({
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    hit,
  });

  function syncCamera() {
    if (state.cameraEnabled) cameraControls.enable();
    else cameraControls.disable();
  }

  // World-space connector records for snapMath, for `part` posed at position/quaternion.
  function worldConnectors(part, position, quaternion) {
    return PART_TYPES[part.type].connectors.map(({ type, position: local, axis }) => ({
      type,
      position: scratch.fromArray(local).applyQuaternion(quaternion).add(position).toArray(),
      axis: scratch.fromArray(axis).applyQuaternion(quaternion).toArray(),
    }));
  }

  function snapCandidate(target) {
    const { part } = drag;
    const rotation = part.mesh.quaternion;
    const dragged = worldConnectors(part, scratch.clone().fromArray(target), rotation);
    if (dragged.length === 0) return null;
    const others = parts.flatMap((other) =>
      other === part ? [] : worldConnectors(other, other.mesh.position, other.mesh.quaternion),
    );
    const snap = findSnap(dragged, others, SNAP);
    if (!snap) return null;
    // The alignment can swing a long part's far end by up to SNAP.maxAngle; refuse a seat
    // that would hold it through the floor or a wall.
    const pose = applyTransform(snap.transform, { position: target, rotation: rotation.toArray() });
    const half = rotatedHalfExtents(PART_TYPES[part.type].size.map((d) => d / 2), pose.rotation);
    return fitsInRoom(pose.position, half, ROOM, SNAP.roomTolerance) ? pose : null;
  }

  // --- part drag: kinematic body on a floor-parallel plane at the grab point's height ---

  function beginDrag(part, [px, py, pz], event) {
    const { mesh, body } = part;
    footprint.setFromObject(mesh);
    drag = {
      part,
      planeY: py,
      height: mesh.position.y + GESTURE.hoverLift,
      offset: [mesh.position.x - px, mesh.position.z - pz],
      half: [(footprint.max.x - footprint.min.x) / 2, (footprint.max.z - footprint.min.z) / 2],
      snapped: null,
    };
    physics.grab(body);
    updateDrag(event);
  }

  function updateDrag(event) {
    aim(event);
    const { origin, direction } = raycaster.ray;
    const point = intersectDragPlane(origin.toArray(), direction.toArray(), drag.planeY);
    // Aimed above the horizon: hold the last pose rather than fling the part away.
    if (!point) return;
    const target = clampToRoom(
      [point[0] + drag.offset[0], drag.height, point[2] + drag.offset[1]],
      drag.half,
      ROOM,
      GESTURE.wallMargin,
    );
    physics.move(drag.part.body, target);
    drag.snapped = snapCandidate(target);
    if (drag.snapped) ghost?.show(drag.part.mesh, drag.snapped);
    else ghost?.hide();
  }

  function endDrag() {
    const { part, snapped } = drag;
    if (snapped) {
      // Seated parts stay kinematic ("placed") until regrabbed, or an unfastened panel
      // would fall straight over. TEMPORARY: remove once PR 4's fastener joints hold them.
      physics.move(part.body, snapped.position, snapped.rotation);
    } else {
      physics.release(part.body);
    }
    stopDrag();
  }

  function cancelDrag() {
    physics.release(drag.part.body);
    stopDrag();
  }

  function stopDrag() {
    ghost?.hide();
    drag = null;
  }

  // --- effects from the state machine ---

  function apply(effect, event) {
    if (!effect) return;
    if (effect.type === 'tap') {
      if (effect.hit?.kind !== 'ring') onTap?.(effect.hit ? effect.hit.part : null);
      return;
    }
    if (effect.owner === OWNER.DRAG_PART) {
      if (effect.type === 'dragStart') beginDrag(effect.hit.part, effect.hit.point, event);
      else if (!drag) return;
      else if (effect.type === 'dragMove') updateDrag(event);
      else if (effect.type === 'dragEnd') endDrag();
      else cancelDrag(); // interrupted: drop it under physics, never snap
      return;
    }
    if (effect.owner === OWNER.GIZMO_RING && rings) {
      if (effect.type === 'dragStart') rings.start(effect.hit, effect);
      else if (effect.type === 'dragMove') rings.move(effect);
      else if (effect.type === 'dragEnd') rings.end();
      else rings.cancel();
    }
  }

  // Capture phase, so this runs before OrbitControls' own pointerdown on the same element
  // and a part touch has already disabled the camera when OrbitControls sees it.
  // Only the primary button (every touch and pen press) can pick up a part; mouse
  // right/middle presses stay the camera's pan and zoom.
  function onPointerDown(event) {
    const hit = state.owner === null && event.button === 0 ? hitTest(event) : null;
    const wasCamera = state.cameraEnabled;
    state.down(pointer(event, hit));
    syncCamera();
    if (wasCamera && !state.cameraEnabled) domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    apply(state.move(pointer(event)), event);
  }

  function onPointerUp(event) {
    apply(state.up(pointer(event)), event);
    syncCamera();
  }

  // pointercancel (OS gesture, notification pull-down) and lost capture end the gesture
  // without a drop target; the state machine ignores ids it has already let go of.
  function onPointerCancel(event) {
    apply(state.cancel(pointer(event)), event);
    syncCamera();
  }

  function onInterrupted() {
    apply(state.cancelAll());
    syncCamera();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') onInterrupted();
  }

  domElement.addEventListener('pointerdown', onPointerDown, { capture: true });
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerCancel);
  domElement.addEventListener('lostpointercapture', onPointerCancel);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onInterrupted);

  return {
    dispose() {
      onInterrupted();
      domElement.removeEventListener('pointerdown', onPointerDown, { capture: true });
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerCancel);
      domElement.removeEventListener('lostpointercapture', onPointerCancel);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onInterrupted);
    },
  };
}
