import * as THREE from 'three';
import { GESTURE, ROOM, SNAP } from '../constants.js';
import { capture, connectorInWorld } from '../game/assembly.js';
import { CONNECTOR, PART_TYPES } from '../game/catalog.js';
import { createCrank, tightenSign } from '../game/crankMath.js';
import { clampLift, clampToRoom, fitsInRoom, intersectDragPlane, rotatedHalfExtents } from '../game/dragMath.js';
import { KIND } from '../game/fasteners.js';
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
 * Seats land in `assembly` (src/game/assembly.js); a tool seated on a bolt head or cam slot
 * is engaged, and dragging it cranks that fastener instead of moving the tool.
 *
 * `parts` is the registry `[{ id, type, mesh, body }]`. Optional hooks:
 *   rings  — `{ selected, hitTest(raycaster), start(hit, pointer), move(pointer), end(),
 *            cancel() }`; which of ring and part a press lands on is `resolveHit`'s call.
 *   onTap  — called with the tapped part, or null for empty space.
 *   ghost  — `{ show(mesh, pose), hide() }` snap preview (src/scene/ghost.js).
 */
export function createGestureRouter({ domElement, camera, cameraControls, physics, parts, assembly, rings, onTap, ghost }) {
  const state = createGestureState();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = parts.map((part) => part.mesh);
  const partByMesh = new Map(parts.map((part) => [part.mesh, part]));
  const partById = new Map(parts.map((part) => [part.id, part]));
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
    button: event.button,
  });

  function syncCamera() {
    if (state.cameraEnabled) cameraControls.enable();
    else cameraControls.disable();
  }

  // World-space connector records for snapMath, for `part` posed at position/quaternion;
  // `part` and `index` ride along so a snap can be seated in the assembly.
  function worldConnectors(part, position, quaternion) {
    return PART_TYPES[part.type].connectors.map(({ type, position: local, axis }, index) => ({
      type,
      position: scratch.fromArray(local).applyQuaternion(quaternion).add(position).toArray(),
      axis: scratch.fromArray(axis).applyQuaternion(quaternion).toArray(),
      part,
      index,
    }));
  }

  // The simulation's pose of a part (its mesh may show fastener feedback on top).
  function poseOf(id) {
    const { body } = partById.get(id);
    const { x, y, z } = body.translation();
    const r = body.rotation();
    return { position: [x, y, z], rotation: [r.x, r.y, r.z, r.w] };
  }

  const connectorWorld = (id, index) => connectorInWorld(PART_TYPES[partById.get(id).type].connectors[index], poseOf(id));

  // A world point in client (CSS px) coordinates.
  function screenPoint(position) {
    scratch.fromArray(position).project(camera);
    const rect = domElement.getBoundingClientRect();
    return [rect.left + ((scratch.x + 1) / 2) * rect.width, rect.top + ((1 - scratch.y) / 2) * rect.height];
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
    return fitsInRoom(pose.position, half, ROOM, SNAP.roomTolerance) ? { ...pose, snap } : null;
  }

  // --- part drag: kinematic body on a floor-parallel plane at the grab point's height ---

  function beginDrag(part, point, event) {
    const engagement = assembly.crankTarget(part.id);
    if (engagement?.target) beginCrank(part, engagement, event);
    else if (assembly.canRelease(part.id)) {
      // Nothing holds it: it leaves whatever it was seated on.
      for (const joint of assembly.jointsOf(part.id)) assembly.unseat(joint.id);
      beginMove(part, point, event);
    }
  }

  function beginMove(part, [px, py, pz], event) {
    const { mesh, body } = part;
    footprint.setFromObject(mesh);
    drag = {
      mode: 'move',
      part,
      planeY: py,
      height: mesh.position.y + GESTURE.hoverLift,
      offset: [mesh.position.x - px, mesh.position.z - pz],
      half: [(footprint.max.x - footprint.min.x) / 2, (footprint.max.z - footprint.min.z) / 2],
      halfHeight: (footprint.max.y - footprint.min.y) / 2,
      snapped: null,
      pointer: null,
    };
    physics.grab(body);
    updateDrag(event);
  }

  // The lift raises the part and its drag plane together, so it stays under the finger.
  function liftDrag(dy) {
    const height = clampLift(drag.height + dy * GESTURE.liftRate, drag.halfHeight, ROOM, GESTURE.ceilingMargin);
    drag.planeY += height - drag.height;
    drag.height = height;
    if (drag.pointer) updateDrag(drag.pointer);
  }

  function updateDrag(event) {
    drag.pointer = { clientX: event.clientX, clientY: event.clientY };
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
    if (drag.mode === 'crank') return stopDrag();
    const { part, snapped } = drag;
    if (snapped) {
      const { from, to } = snapped.snap;
      assembly.seat({ partA: part.id, connectorA: from.index, partB: to.part.id, connectorB: to.index, mover: part.id });
      // Seated parts stay kinematic ("placed") until regrabbed, or an unfastened panel
      // would fall straight over. TEMPORARY: remove once PR 4's fastener joints hold them.
      physics.move(part.body, snapped.position, snapped.rotation);
    } else {
      physics.release(part.body);
    }
    stopDrag();
  }

  function cancelDrag() {
    if (drag.mode !== 'crank') physics.release(drag.part.body);
    stopDrag();
  }

  // --- crank: an engaged tool's drag turns its fastener ---

  function beginCrank(part, engagement, event) {
    drag = { mode: 'crank', part, engagement, crank: createCrank() };
    crankTo(event);
  }

  function crankTo(event) {
    const { tool, target } = drag.engagement;
    const head = connectorWorld(tool.host, tool.hostConnector).position;
    const delta = drag.crank.move(screenPoint(head), [event.clientX, event.clientY]);
    if (!delta) return;
    const into = connectorWorld(target.hardware, target.hardwareConnector).axis;
    const view = scratch.fromArray(head).sub(camera.position).toArray();
    const radians = tightenSign(into, view) * delta;
    assembly.apply(target.id, { type: 'crank', radians }, crankContext(target));
  }

  // A cam catches the nearest screwed bolt head within reach of its recess, any bolt.
  function crankContext(joint) {
    if (joint.kind !== KIND.CAM) return {};
    const recess = connectorWorld(joint.host, joint.hostConnector);
    const heads = assembly.screwedBolts().map(({ hardware }) => ({
      id: hardware,
      position: connectorWorld(hardware, headIndex(hardware)).position,
    }));
    return { captured: capture(recess, heads)?.id ?? null };
  }

  const headIndex = (id) => PART_TYPES[partById.get(id).type].connectors.findIndex((c) => c.type === CONNECTOR.BOLT_HEAD);

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
      else if (drag.mode === 'crank') {
        if (effect.type === 'dragMove') crankTo(event);
        else if (effect.type === 'dragEnd') endDrag();
        else if (effect.type === 'dragCancel') cancelDrag();
      } else if (effect.type === 'lift') liftDrag(effect.dy);
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
  function onPointerDown(event) {
    const hit = state.owner === null ? hitTest(event) : null;
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

  // Desktop lift; OrbitControls is disabled mid-drag, so the wheel never also zooms.
  function onWheel(event) {
    apply(state.wheel({ dy: event.deltaY }), event);
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
  domElement.addEventListener('wheel', onWheel, { passive: true });
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
      domElement.removeEventListener('wheel', onWheel);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onInterrupted);
    },
  };
}
