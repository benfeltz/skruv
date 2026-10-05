import * as THREE from 'three';
import { FASTENER, GESTURE, ROOM, SNAP } from '../constants.js';
import { capture, connectorInWorld } from '../game/assembly.js';
import { CONNECTOR, PART_TYPES } from '../game/catalog.js';
import { createCrank, tightenSign } from '../game/crankMath.js';
import { clampLift, clampToRoom, fitsInRoom, intersectDragPlane, pullAlong, rotatedHalfExtents } from '../game/dragMath.js';
import { isFastened, KIND } from '../game/fasteners.js';
import { createGestureState, OWNER, resolveHit } from '../game/gestureState.js';
import { applyTransform, COMPATIBLE, findSnap } from '../game/snapMath.js';

// Hardware (fastener or tool) has a fastener end; panels have only holes, or nothing.
const isHardware = (type) => PART_TYPES[type].connectors.some((c) => c.type in COMPATIBLE);

// A pull is judged along a short stretch of the joint's axis projected to the screen.
const PULL_AXIS_PROBE = 0.05;

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
 * Fastening translates gestures into assembly events (src/game/assembly.js); which joint
 * does what is the graph's and the fastener machines' call:
 *   snap      seats the pair; the dragged part is held where it seated
 *   tap       pushes home the dowels/pins/nails touching the tapped part (else selects it);
 *             tapping an engaged tool takes it off
 *   drag      an engaged tool cranks its fastener; a part pushed into fastened seats pulls
 *             back out along their axis, and once nothing holds it, moves on as a normal
 *             drag; a part bonded into a compound moves it all through its joints
 * After every change the physics joints are reconciled with `assembly.bonds()`.
 *
 * `parts` is the registry `[{ id, type, mesh, body }]`. Optional hooks:
 *   rings  — `{ selected, hitTest(raycaster), start(hit, pointer), move(pointer), end(),
 *            cancel() }`; which of ring and part a press lands on is `resolveHit`'s call.
 *   onTap  — called with the tapped part, or null for empty space.
 *   ghost  — `{ show(mesh, pose), hide() }` snap preview (src/scene/ghost.js).
 * Call `update()` once per frame after the physics step: it draws fastener progress.
 */
export function createGestureRouter({ domElement, camera, cameraControls, physics, parts, assembly, rings, onTap, ghost }) {
  const state = createGestureState();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = parts.map((part) => part.mesh);
  const panelMeshes = parts.filter((part) => !isHardware(part.type)).map((part) => part.mesh);
  const partByMesh = new Map(parts.map((part) => [part.mesh, part]));
  const partById = new Map(parts.map((part) => [part.id, part]));
  const footprint = new THREE.Box3();
  const scratch = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const twist = new THREE.Quaternion();
  const toolPose = new THREE.Matrix4();
  const hardwarePose = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);

  let drag = null;
  // Parts held kinematic where they seated, until their first fastener engages.
  const placed = new Set();
  // key → { joint, signature, a, b } — the physics joints standing for assembly bonds.
  const bonds = new Map();
  // tool id → its pose relative to the fastener it turns, so it turns along.
  const toolGrips = new Map();

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

  // --- joint lifecycle: physics follows the graph ---

  const isBonded = (part) => [...bonds.values()].some(({ a, b }) => a === part.id || b === part.id);

  function reconcile() {
    const wanted = new Map(assembly.bonds(poseOf).map((bond) => [bond.key, bond]));
    for (const [key, held] of bonds) {
      const next = wanted.get(key);
      if (next && next.signature === held.signature && next.a === held.a && next.b === held.b) continue;
      physics.unjoin(held.joint);
      bonds.delete(key);
    }
    for (const [key, bond] of wanted) {
      if (bonds.has(key)) continue;
      const joint = physics.join(partById.get(bond.a).body, partById.get(bond.b).body, bond.frame, bond.mode);
      bonds.set(key, { joint, signature: bond.signature, a: bond.a, b: bond.b });
    }
    for (const part of placed) {
      // The placed hold's removal condition: its first fastener has engaged, and the joints
      // now hold it.
      if (!isBonded(part)) continue;
      placed.delete(part);
      physics.release(part.body);
    }
    holdLooseHardware();
  }

  // Hardware let go by its joints without being pulled free — a bolt backed all the way
  // out, a cam turned open — sits back at its hole's mouth, held as when first seated.
  function holdLooseHardware() {
    for (const joint of assembly.all()) {
      const part = partById.get(joint.hardware);
      if (joint.mover !== part.id || joint.kind === KIND.TOOL || isFastened(joint.fastener)) continue;
      if (placed.has(part) || isBonded(part) || drag?.part === part) continue;
      if (assembly.jointsOf(part.id).some((j) => isFastened(j.fastener))) continue;
      const rest = assembly.restPose(joint.id, poseOf);
      physics.grab(part.body);
      physics.move(part.body, rest.position, rest.rotation);
      placed.add(part);
    }
  }

  // A seat whose parts have drifted apart (a held part knocked off, a host moved away)
  // is no seat; only unfastened ones can drift.
  function pruneStale() {
    for (const joint of assembly.all()) {
      if (isFastened(joint.fastener)) continue;
      const end = connectorWorld(joint.hardware, joint.hardwareConnector).position;
      const hole = connectorWorld(joint.host, joint.hostConnector).position;
      if (scratch.fromArray(end).distanceTo(offset.fromArray(hole)) > SNAP.maxDistance) unseat(joint);
    }
  }

  function unseat(joint) {
    assembly.unseat(joint.id);
    if (joint.kind === KIND.TOOL) toolGrips.delete(joint.hardware);
  }

  // --- part drag: kinematic body on a floor-parallel plane at the grab point's height ---

  function beginDrag(part, point, event) {
    pruneStale();
    const engagement = assembly.crankTarget(part.id);
    if (engagement?.target) beginCrank(part, engagement, event);
    else if (assembly.canRelease(part.id)) {
      // Nothing holds it: it leaves whatever it was seated on.
      for (const joint of assembly.jointsOf(part.id)) unseat(joint);
      placed.delete(part);
      reconcile();
      beginMove(part, point, event, 'move');
    } else if (assembly.pullable(part.id).length > 0) beginPull(part, event);
    // Bonded into a compound: it all comes along through the joints. A part only partway
    // fastened and bonded to nothing (a half-turned bolt) stays put.
    else if (isBonded(part)) beginMove(part, point, event, 'compound');
  }

  function beginMove(part, [px, py, pz], event, mode) {
    const { mesh, body } = part;
    footprint.setFromObject(mesh);
    drag = {
      mode,
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
    // A compound carries its joints along; only a free part looks for a seat.
    drag.snapped = drag.mode === 'move' ? snapCandidate(target) : null;
    if (drag.snapped) ghost?.show(drag.part.mesh, drag.snapped);
    else ghost?.hide();
  }

  function endDrag() {
    const { mode, part, snapped } = drag;
    if (mode === 'crank' || mode === 'pull') return stopDrag();
    if (snapped) {
      const { from, to } = snapped.snap;
      const joint = assembly.seat({ partA: part.id, connectorA: from.index, partB: to.part.id, connectorB: to.index, mover: part.id });
      // Seated parts stay kinematic ("placed") or an unfastened panel would fall straight
      // over; reconcile() hands them to their joints once a fastener engages.
      physics.move(part.body, snapped.position, snapped.rotation);
      placed.add(part);
      if (joint.kind === KIND.TOOL) gripTool(part, to.part, snapped);
    } else {
      physics.release(part.body);
    }
    stopDrag();
  }

  function cancelDrag() {
    if (drag.mode === 'move' || drag.mode === 'compound') physics.release(drag.part.body);
    stopDrag();
  }

  function stopDrag() {
    ghost?.hide();
    drag = null;
  }

  // --- pull: a part pushed into fastened seats comes back out along their axis ---

  function beginPull(part, event) {
    const joints = assembly.pullable(part.id).map((joint) => {
      // The part leaves along the other side's axis: out of the hole for hardware, off the
      // fastener for a panel pushed onto it.
      const [id, index] = joint.hardware === part.id ? [joint.host, joint.hostConnector] : [joint.hardware, joint.hardwareConnector];
      const { position, axis } = connectorWorld(id, index);
      const from = screenPoint(position);
      const to = screenPoint(position.map((v, i) => v + axis[i] * PULL_AXIS_PROBE));
      return { id: joint.id, axis: [to[0] - from[0], to[1] - from[1]] };
    });
    drag = { mode: 'pull', part, start: [event.clientX, event.clientY], joints };
  }

  function pullTo(event) {
    const { part, start, joints } = drag;
    const at = [event.clientX, event.clientY];
    const pulled = joints.filter(({ id, axis }) => pullAlong(start, at, axis) >= FASTENER.pullDistance && assembly.apply(id, { type: 'pull' }));
    if (pulled.length === 0) return;
    drag.joints = joints.filter((j) => !pulled.includes(j));
    if (!assembly.canRelease(part.id)) return reconcile();
    // Pulled free: it leaves its seats and carries on as a normal drag from here.
    for (const joint of assembly.jointsOf(part.id)) unseat(joint);
    reconcile();
    aim(event);
    const { origin, direction } = raycaster.ray;
    const grab = intersectDragPlane(origin.toArray(), direction.toArray(), part.mesh.position.y) ?? part.mesh.position.toArray();
    beginMove(part, grab, event, 'move');
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
    if (assembly.apply(target.id, { type: 'crank', radians }, crankContext(target))) reconcile();
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

  // The tool keeps its seated pose relative to what it turns.
  function gripTool(tool, fastener, { position, rotation }) {
    toolPose.compose(scratch.fromArray(position), twist.fromArray(rotation), unitScale);
    hardwarePose.compose(fastener.mesh.position, fastener.mesh.quaternion, unitScale);
    toolGrips.set(tool.id, { fastener, grip: hardwarePose.clone().invert().multiply(toolPose) });
  }

  // --- tap: push fasteners home, take a tool off, or select ---

  function tapPart(part) {
    pruneStale();
    const engagement = assembly.crankTarget(part.id);
    if (engagement) {
      unseat(engagement.tool);
      placed.delete(part);
      physics.release(part.body);
      return;
    }
    if (assembly.tap(part.id, behindNail).length > 0) return reconcile();
    onTap?.(part);
  }

  // A nail driven home lands in whichever panel lies behind its hole.
  function behindNail(joint) {
    if (joint.kind !== KIND.NAIL) return {};
    const hole = connectorWorld(joint.host, joint.hostConnector);
    raycaster.set(scratch.fromArray(hole.position), offset.fromArray(hole.axis).negate());
    raycaster.far = PART_TYPES[partById.get(joint.hardware).type].size[1];
    const host = partById.get(joint.host).mesh;
    const hit = raycaster.intersectObjects(panelMeshes, false).find(({ object }) => object !== host);
    raycaster.far = Infinity;
    return { through: hit ? partByMesh.get(hit.object).id : null };
  }

  // --- per frame: fastener progress drawn on top of the simulated poses ---

  function update() {
    for (const joint of assembly.all()) {
      if (joint.kind !== KIND.BOLT && joint.kind !== KIND.CAM) continue;
      const { mesh, body } = partById.get(joint.hardware);
      const { progress } = joint.fastener;
      const axis = scratch.fromArray(assembly.hardwareConnector(joint).axis);
      const turns = joint.kind === KIND.BOLT ? FASTENER.screwRadians : FASTENER.quarterTurn;
      // A bolt partway in is still held at the mouth; draw it as far in as it has turned.
      const sink = joint.kind === KIND.BOLT && !isFastened(joint.fastener) ? FASTENER.sinkDepth.bolt * progress : 0;
      const r = body.rotation();
      const t = body.translation();
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
      mesh.position.set(t.x, t.y, t.z).add(offset.copy(axis).multiplyScalar(sink).applyQuaternion(mesh.quaternion));
      // Tightening turns clockwise seen from the head: positive about the into-hole axis.
      mesh.quaternion.multiply(twist.setFromAxisAngle(axis, progress * turns));
    }
    for (const [id, { fastener, grip }] of toolGrips) {
      hardwarePose.compose(fastener.mesh.position, fastener.mesh.quaternion, unitScale).multiply(grip);
      hardwarePose.decompose(scratch, twist, offset);
      physics.move(partById.get(id).body, scratch.toArray(), twist.toArray());
    }
  }

  // --- effects from the state machine ---

  function apply(effect, event) {
    if (!effect) return;
    if (effect.type === 'tap') {
      if (effect.hit?.kind === 'ring') return;
      if (effect.hit) tapPart(effect.hit.part);
      else onTap?.(null);
      return;
    }
    if (effect.owner === OWNER.DRAG_PART) {
      if (effect.type === 'dragStart') beginDrag(effect.hit.part, effect.hit.point, event);
      else if (!drag) return;
      else if (effect.type === 'dragEnd') endDrag();
      else if (effect.type === 'dragCancel') cancelDrag(); // interrupted: never snap
      else if (drag.mode === 'crank') {
        if (effect.type === 'dragMove') crankTo(event);
      } else if (drag.mode === 'pull') {
        if (effect.type === 'dragMove') pullTo(event);
      } else if (effect.type === 'lift') liftDrag(effect.dy);
      else if (effect.type === 'dragMove') updateDrag(event);
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
    update,
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
