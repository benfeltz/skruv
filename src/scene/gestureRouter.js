import * as THREE from 'three';
import { GESTURE, ROOM } from '../constants.js';
import { clampToRoom, intersectDragPlane } from '../game/dragMath.js';
import { createGestureState, OWNER } from '../game/gestureState.js';

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
 *   rings  — `{ hitTest(raycaster), start(hit, pointer), move(pointer), end(), cancel() }`;
 *            a ring hit outranks a part hit (the gizmo draws on top).
 *   onTap  — called with the tapped part, or null for empty space.
 */
export function createGestureRouter({ domElement, camera, cameraControls, physics, parts, rings, onTap }) {
  const state = createGestureState();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = parts.map((part) => part.mesh);
  const partByMesh = new Map(parts.map((part) => [part.mesh, part]));
  const footprint = new THREE.Box3();

  let drag = null;

  function aim({ clientX, clientY }) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function hitTest(event) {
    aim(event);
    const ring = rings?.hitTest(raycaster);
    if (ring) return { kind: 'ring', ...ring };
    const [first] = raycaster.intersectObjects(meshes, false);
    return first ? { kind: 'part', part: partByMesh.get(first.object), point: first.point.toArray() } : null;
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
    const target = [point[0] + drag.offset[0], drag.height, point[2] + drag.offset[1]];
    physics.move(drag.part.body, clampToRoom(target, drag.half, ROOM, GESTURE.wallMargin));
  }

  function endDrag() {
    physics.release(drag.part.body);
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
      else endDrag(); // dragEnd and dragCancel both drop the part under physics
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
