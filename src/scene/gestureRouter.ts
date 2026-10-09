import * as THREE from 'three';
import { COLORS, DROP, FASTENER, GESTURE, PICK, ROOM, SNAP } from '../constants.js';
import { areCompatible, COMPATIBLE, CONNECTOR, KIND } from '../../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../../tools/validate/lib/geometry.js';
import { capture } from '../game/assembly.js';
import { PART_TYPES } from '../game/item.js';
import { socketUnder } from '../game/decals.js';
import { createCrank, tightenSign } from '../game/crankMath.js';
import { clampLift, clampToRoom, easeToward, fitsInRoom, intersectDragPlane, pullAlong, rebaseDragOffset, rotatedHalfExtents } from '../game/dragMath.js';
import { isFastened } from '../game/fasteners.js';
import {
  fastenEvent,
  grabEvent,
  releaseEvent,
  seatEvent,
  snapCandidateEvent,
  unfastenEvent,
  unseatEvent,
} from '../game/events.js';
import { createGestureState, OWNER, resolveHit } from '../game/gestureState.js';
import { isSmallPart, preferHit, rayBoxReach } from '../game/pickMath.js';
import { applyTransform, findSnap } from '../game/snapMath.js';
import type { Snap } from '../game/snapMath.js';
import type { Assembly, AssemblyJoint, PartId } from '../game/assembly.js';
import type { Bus } from '../game/events.js';
import type { ApplyContext } from '../game/assembly.js';
import type { GestureEffect } from '../game/gestureState.js';
import type { ScreenPoint } from '../game/dragMath.js';
import type { Part } from '../game/partMesh.js';
import type { PhysicsJoint, PhysicsWorld } from '../physics/world.js';
import type { RingHit } from './gizmo.js';
import type { HandleHit } from './sprue.js';
import type { Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';

/** A press on a part: which, where, and how far along the ray. */
interface PartHit {
  part: Part;
  point: Vec3;
  distance: number;
}

type PartPress = { kind: 'part' } & PartHit;
type RingPress = { kind: 'ring' } & RingHit;
/** What a press landed on, as the state machine carries it. */
type Press = PartPress | RingPress;

/** A connector in the world, carrying its part and index so a snap can be seated. */
interface WorldConnector {
  type: ConnectorType;
  position: Vec3;
  axis: Vec3;
  part: Part;
  index: number;
}

type RouterSnap = Snap<WorldConnector, WorldConnector>;

/** Where a pointer is, in client coordinates. */
interface ClientPoint {
  clientX: number;
  clientY: number;
}

// The drag in progress. One record for every mode; each sets only its own fields —
// 'move'/'compound' the plane drag's (beginMove), 'pull' start and joints (beginPull),
// 'crank' engagement and crank (beginCrank).
interface Drag {
  mode: 'move' | 'compound' | 'pull' | 'crank';
  part: Part;
  planeY: number;
  height: number;
  offset: [number, number];
  half: [number, number];
  halfHeight: number;
  centre: Vec3;
  rotation: Quat;
  held: Pose | null;
  snapped: (Pose & { snap: RouterSnap }) | null;
  offer: string | null;
  retarget: { from: number; to: number } | null;
  pointer: ClientPoint | null;
  start: ScreenPoint;
  joints: { id: number; axis: ScreenPoint }[];
  engagement: { tool: AssemblyJoint; target: AssemblyJoint };
  crank: ReturnType<typeof createCrank>;
}

/** The gizmo, as the router drives it (src/scene/gizmo.ts). */
interface Rings {
  selected: Part | null;
  hitTest(raycaster: THREE.Raycaster): RingHit | null;
  start(hit: Pick<RingHit, 'axis'>, pointer: { x: number; y: number }): void;
  move(pointer: { x: number; y: number }): void;
  end(): void;
  cancel(): void;
}

/** What `createGestureRouter` returns — see there. */
export interface GestureRouter {
  readonly dragging: { part: Part; mode: Drag['mode'] } | null;
  update(delta?: number): void;
  sync(): void;
  unseatAll(ids: PartId[]): void;
  dispose(): void;
}

/** What `createGestureRouter` takes — see there. */
export interface GestureRouterOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  cameraControls: { enable(): void; disable(): void };
  physics: Pick<PhysicsWorld, 'grab' | 'move' | 'release' | 'join' | 'unjoin'>;
  parts: Part[];
  assembly: Assembly;
  rings?: Rings;
  onTap?: (part: Part | null) => void;
  ghost?: { show(mesh: THREE.Mesh, pose: Pose): void; hide(): void };
  sprue?: { selected: Part | null; hitTest(raycaster: THREE.Raycaster): HandleHit | null };
  dropGuide?: { show(from: Vec3, to: Vec3): void; hide(): void };
  events?: Pick<Bus, 'emit'>;
  hold?: { readonly held: Part | null; readonly height: number; readonly goal: number; target(height: number): void; jump(height: number): void };
}

// A hole marking on a part's mesh (src/game/partMesh.ts).
type Decal = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

// Hardware (fastener or tool) has a fastener end; panels have only holes, or nothing.
const isHardware = (type: string) => PART_TYPES[type].connectors.some((c) => c.type in COMPATIBLE);

// Fasteners and tools, never panels — the parts that get a fat hit proxy.
const isSmall = (type: string) => isSmallPart(PART_TYPES[type].size, PICK);

// A pull is judged along a short stretch of the joint's axis projected to the screen.
const PULL_AXIS_PROBE = 0.05;

/**
 * Thin DOM adapter between pointer events and part manipulation. It raycasts, feeds
 * src/game/gestureState.ts, and acts on the effects it returns; every decision (tap vs
 * drag, who owns a touch) is the state machine's.
 *
 * The camera is driven only through cameraControls' `enable()`/`disable()` seam, mirrored
 * from `state.cameraEnabled` after every event — so a touch that hits no part leaves the
 * camera exactly as before, and every end path (up, cancel, lost capture, page hidden)
 * hands it back.
 *
 * Fastening translates gestures into assembly events (src/game/assembly.ts); which joint
 * does what is the graph's and the fastener machines' call:
 *   snap      seats the pair; the dragged part is held where it seated
 *   tap       pushes home the dowels/pins/back fittings touching the tapped part (else selects it);
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
 *   ghost  — `{ show(mesh, pose), hide() }` snap preview (src/scene/ghost.ts).
 *   dropGuide — `{ show(from, to), hide() }` line from a dragged part down to where it
 *            would land (src/scene/dropGuide.ts); a free hole there that takes the part
 *            glows, as does the seat the ghost shows.
 *   sprue  — `{ selected, hitTest(raycaster) }` handle on a selected small part
 *            (src/scene/sprue.ts); a press on it nearer than anything else is a press on
 *            its part, so dragging it is the part's own drag.
 *   events — `{ emit(event) }` bus (src/game/events.ts): grabs, releases, seat offers,
 *            seats and fastenings are reported as they happen. Reporting only — nothing
 *            here reads it back.
 *   hold   — `{ held, height, goal, target(height), jump(height) }` (src/scene/liftHold.ts):
 *            while the elevation line holds the part being dragged, the drag rides at the
 *            line's height, so seats are offered where the part really is and letting go
 *            of the line leaves the drag there; a seat newly on offer eases the line to its
 *            height, as seat assist eases everything else, and back once the offer is
 *            gone; a lift (second finger, Shift, wheel) moves the line with it. A part the
 *            line holds is never a seat for another: it drops when the line lets go.
 * Call `update(delta)` once per frame after the physics step: it draws fastener progress,
 * eases a dragged part toward the seat on offer (seat assist) and fades the seat flash.
 */
export function createGestureRouter({ domElement, camera, cameraControls, physics, parts, assembly, rings, onTap, ghost, sprue, dropGuide, events, hold }: GestureRouterOptions) {
  const state = createGestureState<Press>();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = parts.map((part) => part.mesh);
  const panelMeshes = parts.filter((part) => !isHardware(part.type)).map((part) => part.mesh);
  const partByMesh = new Map<THREE.Object3D, Part>(parts.map((part) => [part.mesh, part]));
  const partById = new Map<PartId, Part>(parts.map((part) => [part.id, part]));
  const proxies = parts.filter((part) => isSmall(part.type)).map(addHitProxy);
  // A proxy rides on its part's mesh.
  const partByProxy = new Map<THREE.Object3D, Part>(proxies.map((proxy) => [proxy, partByMesh.get(proxy.parent!)!]));
  const localRay = new THREE.Ray();
  const toLocal = new THREE.Matrix4();
  const footprint = new THREE.Box3();
  const bounds = new THREE.Box3();
  const scratch = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const twist = new THREE.Quaternion();
  const toolPose = new THREE.Matrix4();
  const hardwarePose = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);

  let drag: Drag | null = null;
  // Parts held kinematic where they seated, until their first fastener engages.
  const placed = new Set<Part>();
  // key → { joint, signature, a, b } — the physics joints standing for assembly bonds.
  const bonds = new Map<string, { joint: PhysicsJoint; signature: string; a: PartId; b: PartId }>();
  // tool id → its pose relative to the fastener it turns, so it turns along.
  const toolGrips = new Map<PartId, { fastener: Part; grip: THREE.Matrix4 }>();
  // decal mesh → ms of glow left, after a fastener seated in its hole.
  const flashes = new Map<Decal, number>();
  // The hole marking lit under the drop line (or at the seat on offer), if any.
  let glowing: Decal | null = null;
  const down = new THREE.Vector3(0, -1, 0);

  function aim({ clientX, clientY }: ClientPoint) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function hitTest(event: PointerEvent): Press | null {
    aim(event);
    const ring = rings?.hitTest(raycaster) ?? null;
    const [first] = raycaster.intersectObjects(meshes, false);
    const partHit: PartHit | null = first
      ? { part: partByMesh.get(first.object)!, point: first.point.toArray(), distance: first.distance }
      : null;
    const picked = preferHit(partHit, proxyHits(), PICK);
    const handle = sprue?.hitTest(raycaster) ?? null;
    if (handle && sprue!.selected && [ring, picked].every((hit) => !hit || handle.distance <= hit.distance)) {
      return resolveHit<RingHit, PartHit>(null, { part: sprue!.selected, ...handle });
    }
    return resolveHit(ring, picked);
  }

  // The nearest proxy hit per small part, with how far the ray passes from the real part
  // and how far along it the real part is (so one sunk in a panel stays hidden behind it).
  function proxyHits() {
    const nearest = new Map<Part, PartHit & { miss: number; depth: number }>();
    for (const { object, point, distance } of raycaster.intersectObjects(proxies, false)) {
      const part = partByProxy.get(object)!;
      if (nearest.has(part)) continue;
      toLocal.copy(part.mesh.matrixWorld).invert();
      localRay.copy(raycaster.ray).applyMatrix4(toLocal);
      const half = PART_TYPES[part.type].size.map((d) => d / 2);
      const { miss, depth } = rayBoxReach(localRay.origin.toArray(), localRay.direction.normalize().toArray(), half);
      nearest.set(part, { part, point: point.toArray(), distance, miss, depth });
    }
    return [...nearest.values()];
  }

  const pointer = (event: PointerEvent, hit: Press | null = null) => ({
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
  function worldConnectors(part: Part, position: THREE.Vector3, quaternion: THREE.Quaternion): WorldConnector[] {
    return PART_TYPES[part.type].connectors.map(({ type, position: local, axis }, index) => ({
      type,
      position: scratch.fromArray(local).applyQuaternion(quaternion).add(position).toArray(),
      axis: scratch.fromArray(axis).applyQuaternion(quaternion).toArray(),
      part,
      index,
    }));
  }

  // The simulation's pose of a part (its mesh may show fastener feedback on top).
  function poseOf(id: PartId): Pose {
    const { body } = partById.get(id)!;
    const { x, y, z } = body.translation();
    const r = body.rotation();
    return { position: [x, y, z], rotation: [r.x, r.y, r.z, r.w] };
  }

  const connectorWorld = (id: PartId, index: number) => connectorInWorld(PART_TYPES[partById.get(id)!.type].connectors[index], poseOf(id));

  // A world point in client (CSS px) coordinates.
  function screenPoint(position: Vec3): ScreenPoint {
    scratch.fromArray(position).project(camera);
    const rect = domElement.getBoundingClientRect();
    return [rect.left + ((scratch.x + 1) / 2) * rect.width, rect.top + ((1 - scratch.y) / 2) * rect.height];
  }

  // Connectors already in a seat — a filled hole, a dowel end already in one, a bolt head
  // with a wrench on it — take no second one.
  function occupied() {
    const taken = new Set<string>();
    for (const j of assembly.all()) {
      taken.add(`${j.hardware}#${j.hardwareConnector}`);
      taken.add(`${j.host}#${j.hostConnector}`);
    }
    return (c: WorldConnector) => taken.has(`${c.part.id}#${c.index}`);
  }

  function snapCandidate(target: Vec3) {
    const { part } = drag!;
    // The rotation the part was picked up at — the mesh's may be easing toward a seat.
    const rotation = twist.fromArray(drag!.rotation);
    const isTaken = occupied();
    const free = (connectors: WorldConnector[]) => connectors.filter((c) => !isTaken(c));
    const dragged = free(worldConnectors(part, scratch.clone().fromArray(target), rotation));
    if (dragged.length === 0) return null;
    // A part the elevation line holds up is no seat: it drops when the line lets go.
    const others = parts.flatMap((other) =>
      other === part || other === hold?.held ? [] : free(worldConnectors(other, other.mesh.position, other.mesh.quaternion)),
    );
    const snap = findSnap(dragged, others, SNAP);
    if (!snap) return null;
    // The alignment can swing a long part's far end by up to SNAP.maxAngle; refuse a seat
    // that would hold it through the floor or a wall.
    const pose = applyTransform(snap.transform, { position: target, rotation: drag!.rotation });
    const half = rotatedHalfExtents(PART_TYPES[part.type].size.map((d) => d / 2), pose.rotation);
    return fitsInRoom(pose.position, half, ROOM, SNAP.roomTolerance) ? { ...pose, snap } : null;
  }

  // --- joint lifecycle: physics follows the graph ---

  const isBonded = (part: Part) => [...bonds.values()].some(({ a, b }) => a === part.id || b === part.id);

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
      const joint = physics.join(partById.get(bond.a)!.body, partById.get(bond.b)!.body, bond.frame, bond.mode);
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
      const part = partById.get(joint.hardware)!;
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

  function unseat(joint: AssemblyJoint) {
    assembly.unseat(joint.id);
    events?.emit(unseatEvent(joint));
    if (joint.kind === KIND.TOOL) toolGrips.delete(joint.hardware);
    // A part held only for this seat goes back to the simulation — a dowel whose panel
    // was carried off, a wrench whose bolt was.
    for (const id of [joint.hardware, joint.host]) {
      const part = partById.get(id)!;
      if (!placed.has(part) || assembly.jointsOf(id).length > 0) continue;
      placed.delete(part);
      physics.release(part.body);
    }
  }

  // A fastener that changed state across a tap, pull or turn reports going home or coming
  // back out; `was` is whether it was fastened before.
  function reportFastening(id: number, was: boolean) {
    const joint = assembly.get(id);
    if (!events || !joint || isFastened(joint.fastener) === was) return;
    events.emit(isFastened(joint.fastener) ? fastenEvent(joint) : unfastenEvent(joint));
  }

  // World box of a part's own geometry — hit proxies and decals riding on it don't count.
  function boxOf(mesh: Part['mesh'], box: THREE.Box3) {
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  }

  // --- part drag: kinematic body on a floor-parallel plane at the grab point's height ---

  function beginDrag(part: Part, point: Vec3, event: ClientPoint) {
    pruneStale();
    const engagement = assembly.crankTarget(part.id);
    // Its target is set: checked just here.
    if (engagement?.target) beginCrank(part, engagement as Drag['engagement'], event);
    else if (assembly.canRelease(part.id)) {
      // Nothing holds it: it leaves whatever it was seated on.
      placed.delete(part);
      for (const joint of assembly.jointsOf(part.id)) unseat(joint);
      reconcile();
      beginMove(part, point, event, 'move');
    } else if (assembly.pullable(part.id).length > 0) beginPull(part, event);
    // Bonded into a compound: it all comes along through the joints. A part only partway
    // fastened and bonded to nothing (a half-turned bolt) stays put.
    else if (isBonded(part)) beginMove(part, point, event, 'compound');
  }

  function beginMove(part: Part, [px, py, pz]: number[], event: ClientPoint, mode: 'move' | 'compound') {
    const { mesh, body } = part;
    // Clamps keep everything that moves inside the room: a compound's whole bounding box,
    // carried at its offset from the grabbed part.
    boxOf(mesh, footprint);
    if (mode === 'compound') {
      for (const id of assembly.compoundOf(part.id)) footprint.union(boxOf(partById.get(id)!.mesh, bounds));
    }
    const centre = footprint.getCenter(offset).sub(mesh.position).toArray();
    // The plane drag's fields; the pull's and crank's stay unset.
    drag = {
      mode,
      part,
      planeY: py,
      height: mesh.position.y + GESTURE.hoverLift,
      offset: [mesh.position.x - px, mesh.position.z - pz],
      half: [(footprint.max.x - footprint.min.x) / 2, (footprint.max.z - footprint.min.z) / 2],
      halfHeight: (footprint.max.y - footprint.min.y) / 2,
      centre,
      rotation: mesh.quaternion.toArray(),
      // Where the part is held: the finger's pose, or easing from it toward a seat on offer.
      held: null,
      snapped: null,
      // The seat last reported on offer (telemetry), so only a change is reported.
      offer: null,
      // The line's goal before a seat offer moved it (from), and where the offer put it (to).
      retarget: null,
      pointer: null,
    } as Drag;
    physics.grab(body);
    updateDrag(event);
  }

  // The lift raises the part and its drag plane together — and the line, for the part it
  // holds, so the line's height never pulls it back.
  function liftDrag(dy: number, rate: number) {
    const cy = drag!.centre[1];
    const height = clampLift(drag!.height + dy * rate + cy, drag!.halfHeight, ROOM, GESTURE.ceilingMargin) - cy;
    if (!holdsDrag()) return raiseDrag(height);
    hold!.jump(height);
    raiseDrag(hold!.height);
  }

  // Straight up: the finger's ray meets the raised plane nearer the camera, so the grab
  // offset is re-anchored there and the finger's x, z for the part stay put; the next
  // finger move carries on from there. Re-anchored on where the finger puts the part, not
  // where it is held — a seat assist's pull or a wall's clamp never sticks to the grab.
  function raiseDrag(height: number) {
    const planeY = drag!.planeY + height - drag!.height;
    if (drag!.pointer) {
      aim(drag!.pointer);
      const origin = raycaster.ray.origin.toArray();
      const direction = raycaster.ray.direction.toArray();
      const before = intersectDragPlane(origin, direction, drag!.planeY);
      const after = intersectDragPlane(origin, direction, planeY);
      // Aimed above the horizon: keep the old offset; updateDrag holds the last pose.
      if (before && after) drag!.offset = rebaseDragOffset([before[0] + drag!.offset[0], before[2] + drag!.offset[1]], after);
    }
    drag!.planeY = planeY;
    drag!.height = height;
    if (drag!.pointer) updateDrag(drag!.pointer);
  }

  // Whether the drag in progress is of the part the elevation line holds.
  const holdsDrag = () => drag?.mode === 'move' && !!hold && hold.held === drag.part;

  // A drag of the part the elevation line holds rides at the line's height.
  function followHold() {
    if (!holdsDrag() || hold!.height === drag!.height) return;
    raiseDrag(hold!.height);
  }

  function updateDrag(event: ClientPoint) {
    drag!.pointer = { clientX: event.clientX, clientY: event.clientY };
    aim(event);
    const { origin, direction } = raycaster.ray;
    const point = intersectDragPlane(origin.toArray(), direction.toArray(), drag!.planeY);
    // Aimed above the horizon: hold the last pose rather than fling the part away.
    if (!point) return;
    const [cx, , cz] = drag!.centre;
    const [bx, , bz] = clampToRoom(
      [point[0] + drag!.offset[0] + cx, drag!.height, point[2] + drag!.offset[1] + cz],
      drag!.half,
      ROOM,
      GESTURE.wallMargin,
    );
    const target: Vec3 = [bx - cx, drag!.height, bz - cz];
    // A compound carries its joints along; only a free part looks for a seat.
    drag!.snapped = drag!.mode === 'move' ? snapCandidate(target) : null;
    reportOffer();
    if (drag!.snapped) ghost?.show(drag!.part.mesh, drag!.snapped);
    else ghost?.hide();
    // No seat on offer: the part is exactly where the finger puts it, no pull at all. With
    // one, update() eases it in from wherever it is held.
    if (drag!.snapped && drag!.held) return;
    drag!.held = { position: target, rotation: drag!.rotation };
    physics.move(drag!.part.body, target, drag!.mode === 'move' ? drag!.rotation : undefined);
  }

  function reportOffer() {
    const snap = drag!.snapped?.snap ?? null;
    const offer = snap && `${snap.from.index}>${snap.to.part.id}#${snap.to.index}`;
    if (offer === drag!.offer) return;
    drag!.offer = offer;
    events?.emit(snapCandidateEvent(drag!.part.id, snap));
    if (hold?.held !== drag!.part) return;
    // The line sets the held part's height, so seat assist reaches the seat's through it —
    // once per offer, so moving the line finger afterwards still wins. When the offer goes,
    // so does its pull: the goal goes back, unless the line has moved it since.
    const back = drag!.retarget;
    const moved = !back || hold.goal !== back.to;
    if (drag!.snapped) {
      const from = moved ? hold.goal : back.from;
      hold.target(drag!.snapped.position[1]);
      drag!.retarget = { from, to: hold.goal };
    } else if (back) {
      drag!.retarget = null;
      if (!moved) hold.target(back.from);
    }
  }

  // Seat assist: only while a seat is on offer, the held part glides toward it.
  function assist(delta: number) {
    if (!drag?.snapped || !drag.held) return;
    drag.held = easeToward(drag.held, drag.snapped, SNAP.assistStrength, delta);
    physics.move(drag.part.body, drag.held.position, drag.held.rotation);
  }

  function endDrag() {
    const { mode, part, snapped } = drag!;
    if (mode === 'crank' || mode === 'pull') return stopDrag();
    if (snapped) {
      const { from, to } = snapped.snap;
      const joint = assembly.seat({ partA: part.id, connectorA: from.index, partB: to.part.id, connectorB: to.index, mover: part.id });
      events?.emit(seatEvent(joint));
      // Seated parts stay kinematic ("placed") or an unfastened panel would fall straight
      // over; reconcile() hands them to their joints once a fastener engages.
      physics.move(part.body, snapped.position, snapped.rotation);
      placed.add(part);
      if (joint.kind === KIND.TOOL) gripTool(joint, snapped);
      flash(from, to);
    } else {
      physics.release(part.body);
    }
    stopDrag();
    // Whatever was seated on a part that just moved away drops.
    pruneStale();
  }

  function cancelDrag() {
    if (drag!.mode === 'move' || drag!.mode === 'compound') physics.release(drag!.part.body);
    stopDrag();
  }

  function stopDrag() {
    ghost?.hide();
    dropGuide?.hide();
    drag = null;
  }

  // The hole a fastener just seated in glows; whichever side of the pair is the socket
  // carries its decal (a tool on a bolt head has none).
  function flash(...connectors: WorldConnector[]) {
    for (const { part, index } of connectors) {
      const decal = part.mesh.userData.decals?.get(index);
      if (!decal) continue;
      decal.material.emissive.setHex(COLORS.decalFlash);
      decal.material.emissiveIntensity = 1;
      flashes.set(decal, SNAP.flashMs);
    }
  }

  function fadeFlashes(delta: number) {
    for (const [decal, left] of flashes) {
      const remaining = left - delta * 1000;
      decal.material.emissiveIntensity = Math.max(0, remaining / SNAP.flashMs);
      if (remaining > 0) flashes.set(decal, remaining);
      else {
        flashes.delete(decal);
        // A hole still under the drop line (or the seat on offer) goes back to its glow.
        if (decal === glowing) {
          decal.material.emissiveIntensity = DROP.glowIntensity;
        } else {
          decal.material.emissive.setHex(COLORS.unlit);
          decal.material.emissiveIntensity = 1;
        }
      }
    }
  }

  // --- drop guide: where a dragged part lands, and the hole it would drop onto ---

  function guideDrop() {
    if (!drag || (drag.mode !== 'move' && drag.mode !== 'compound')) return glow(null);
    const { part, centre, halfHeight } = drag;
    const { position } = part.mesh;
    const from: Vec3 = [position.x + centre[0], position.y + centre[1] - halfHeight, position.z + centre[2]];
    const carried = new Set(drag.mode === 'compound' ? assembly.compoundOf(part.id) : []);
    carried.add(part.id);
    raycaster.set(scratch.fromArray(from), down);
    const hit = raycaster.intersectObjects(meshes, false).find(({ object }) => !carried.has(partByMesh.get(object)!.id));
    const to: Vec3 = hit ? hit.point.toArray() : [from[0], 0, from[2]];
    dropGuide?.show(from, to);
    if (drag.snapped) {
      const { from: a, to: b } = drag.snapped.snap;
      return glow(decalOf(a) ?? decalOf(b));
    }
    const under = hit && drag.mode === 'move' ? partByMesh.get(hit.object)! : null;
    const host = under === hold?.held ? null : under;
    glow(host ? decalOf(socketUnder(to, freeSocketsFor(part, host), DROP.holeReach)) : null);
  }

  const decalOf = (connector: WorldConnector | null): Decal | null => connector?.part.mesh.userData.decals?.get(connector.index) ?? null;

  // The holes on `host` still empty that take one of `part`'s fastener ends.
  function freeSocketsFor(part: Part, host: Part) {
    const ends = PART_TYPES[part.type].connectors.map((c) => c.type);
    const isTaken = occupied();
    return worldConnectors(host, host.mesh.position, host.mesh.quaternion).filter(
      (c) => ends.some((end) => areCompatible(end, c.type)) && !isTaken(c),
    );
  }

  // Lights one hole marking at a time; a hole mid-flash keeps its flash.
  function glow(decal: Decal | null) {
    if (decal === glowing) return;
    if (glowing && !flashes.has(glowing)) glowing.material.emissive.setHex(COLORS.unlit);
    glowing = decal;
    if (!decal || flashes.has(decal)) return;
    decal.material.emissive.setHex(COLORS.decalFlash);
    decal.material.emissiveIntensity = DROP.glowIntensity;
  }

  // --- pull: a part pushed into fastened seats comes back out along their axis ---

  function beginPull(part: Part, event: ClientPoint) {
    const joints = assembly.pullable(part.id).map((joint): Drag['joints'][number] => {
      // The part leaves along the other side's axis: out of the hole for hardware, off the
      // fastener for a panel pushed onto it.
      const [id, index] = joint.hardware === part.id ? [joint.host, joint.hostConnector] : [joint.hardware, joint.hardwareConnector];
      const { position, axis } = connectorWorld(id, index);
      const from = screenPoint(position);
      // map keeps the length; TS widens a mapped tuple to number[].
      const to = screenPoint(position.map((v, i) => v + axis[i] * PULL_AXIS_PROBE) as Vec3);
      return { id: joint.id, axis: [to[0] - from[0], to[1] - from[1]] };
    });
    // The pull's fields only.
    drag = { mode: 'pull', part, start: [event.clientX, event.clientY], joints } as Drag;
  }

  // The pull is judged on the real pointer `event`; once free, the drag carries on from
  // `pointer` — where the state machine reports it — so a later Shift-lift never jumps.
  function pullTo(event: ClientPoint, pointer = event) {
    const { part, start, joints } = drag!;
    const at = [event.clientX, event.clientY];
    const pulled = joints.filter(({ id, axis }) => pullAlong(start, at, axis) >= FASTENER.pullDistance && assembly.apply(id, { type: 'pull' }));
    if (pulled.length === 0) return;
    for (const { id } of pulled) reportFastening(id, true);
    drag!.joints = joints.filter((j) => !pulled.includes(j));
    if (!assembly.canRelease(part.id)) return reconcile();
    // Pulled free: it leaves its seats and carries on as a normal drag from here.
    for (const joint of assembly.jointsOf(part.id)) unseat(joint);
    reconcile();
    aim(pointer);
    const { origin, direction } = raycaster.ray;
    const grab = intersectDragPlane(origin.toArray(), direction.toArray(), part.mesh.position.y) ?? part.mesh.position.toArray();
    // Telemetry: the pull ends here and a move begins, so each grab pairs with its release.
    events?.emit(releaseEvent(part.id, 'pull'));
    beginMove(part, grab, pointer, 'move');
    events?.emit(grabEvent(part.id, 'move'));
  }

  // --- crank: an engaged tool's drag turns its fastener ---

  function beginCrank(part: Part, engagement: Drag['engagement'], event: ClientPoint) {
    // The crank's fields only.
    drag = { mode: 'crank', part, engagement, crank: createCrank() } as Drag;
    crankTo(event);
  }

  function crankTo(event: ClientPoint) {
    const { tool, target } = drag!.engagement;
    const head = connectorWorld(tool.host, tool.hostConnector).position;
    const delta = drag!.crank.move(screenPoint(head), [event.clientX, event.clientY]);
    if (!delta) return;
    const into = connectorWorld(target.hardware, target.hardwareConnector).axis;
    const view = scratch.fromArray(head).sub(camera.position).toArray();
    const radians = tightenSign(into, view) * delta;
    const was = isFastened(assembly.get(target.id)!.fastener);
    if (assembly.apply(target.id, { type: 'crank', radians }, crankContext(target))) {
      reportFastening(target.id, was);
      reconcile();
    }
  }

  // A cam catches the nearest screwed bolt head within reach of its recess, any bolt.
  function crankContext(joint: AssemblyJoint): ApplyContext {
    if (joint.kind !== KIND.CAM) return {};
    const recess = connectorWorld(joint.host, joint.hostConnector);
    const heads = assembly.screwedBolts().map(({ hardware }) => ({
      id: hardware,
      position: connectorWorld(hardware, headIndex(hardware)).position,
    }));
    return { captured: capture(recess, heads)?.id ?? null };
  }

  const headIndex = (id: PartId) => PART_TYPES[partById.get(id)!.type].connectors.findIndex((c) => c.type === CONNECTOR.BOLT_HEAD);

  // The tool keeps its seated pose relative to what it turns. Either side may have been
  // the one dragged into the seat (a bolt head onto a wrench on the floor): the dragged
  // side is at `snapped`, the other where it lies — and the tool is held from now on.
  function gripTool(joint: AssemblyJoint, snapped: Pose) {
    const tool = partById.get(joint.hardware)!;
    const fastener = partById.get(joint.host)!;
    const toolMoved = joint.mover === tool.id;
    const at = (part: Part, moved: boolean): [THREE.Vector3, THREE.Quaternion] =>
      moved ? [scratch.fromArray(snapped.position), twist.fromArray(snapped.rotation)] : [part.mesh.position, part.mesh.quaternion];
    toolPose.compose(...at(tool, toolMoved), unitScale);
    hardwarePose.compose(...at(fastener, !toolMoved), unitScale);
    if (!toolMoved) {
      physics.grab(tool.body);
      placed.add(tool);
    }
    toolGrips.set(tool.id, { fastener, grip: hardwarePose.clone().invert().multiply(toolPose) });
  }

  // --- tap: push fasteners home, take a tool off, or select ---

  function tapPart(part: Part) {
    pruneStale();
    const engagement = assembly.crankTarget(part.id);
    if (engagement) return unseat(engagement.tool);
    const pressed = assembly.tap(part.id, behindFitting);
    for (const id of pressed) reportFastening(id, false);
    if (pressed.length > 0) return reconcile();
    // A part held at its seat is the router's: turning it would drop it off the seat.
    if (!placed.has(part)) onTap?.(part);
  }

  // A back fitting pressed home lands in whichever panel lies behind its hole.
  function behindFitting(joint: AssemblyJoint): ApplyContext {
    if (joint.kind !== KIND.FITTING) return {};
    const hole = connectorWorld(joint.host, joint.hostConnector);
    raycaster.set(scratch.fromArray(hole.position), offset.fromArray(hole.axis).negate());
    raycaster.far = PART_TYPES[partById.get(joint.hardware)!.type].size[1];
    const host = partById.get(joint.host)!.mesh;
    const hit = raycaster.intersectObjects(panelMeshes, false).find(({ object }) => object !== host);
    raycaster.far = Infinity;
    return { through: hit ? partByMesh.get(hit.object)!.id : null };
  }

  // --- per frame: fastener progress drawn on top of the simulated poses ---

  function update(delta = 0) {
    followHold();
    assist(delta);
    fadeFlashes(delta);
    guideDrop();
    for (const joint of assembly.all()) {
      if (joint.kind !== KIND.BOLT && joint.kind !== KIND.CAM) continue;
      const { mesh, body } = partById.get(joint.hardware)!;
      const { progress } = joint.fastener;
      const axis = scratch.fromArray(assembly.hardwareConnector(joint).axis);
      const turns = joint.kind === KIND.BOLT ? FASTENER.screwRadians : FASTENER.quarterTurn;
      // A bolt partway in is still held at the mouth; draw it as far in as it has turned.
      const sink = joint.kind === KIND.BOLT && !isFastened(joint.fastener) ? FASTENER.sinkDepth.bolt! * progress : 0;
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
      physics.move(partById.get(id)!.body, scratch.toArray(), twist.toArray());
    }
  }

  // --- effects from the state machine ---

  // A live drag's move or lift. The primary pointer as the state machine reports it: a
  // Shift-lift's vertical travel is spent, so letting go of Shift never makes anything jump.
  function moveDrag(effect: Extract<GestureEffect<Press>, { type: 'lift' | 'dragMove' }>, event: MouseEvent) {
    // A lift that carries x carries y too.
    const at = effect.x === undefined ? null : { clientX: effect.x, clientY: effect.y! };
    if (drag!.mode === 'crank' || drag!.mode === 'pull') {
      // Nothing to lift: the primary pointer's move is a crank or a pull either way, judged
      // on the real pointer — a crank sweeps round the head where the cursor actually is.
      if (!at) return;
      if (drag!.mode === 'crank') crankTo(event);
      else pullTo(event, at);
    } else if (effect.type === 'lift') {
      if (at) drag!.pointer = at;
      liftDrag(effect.dy, liftRate(effect, event));
    } else if (effect.type === 'dragMove') updateDrag(at!);
  }

  function apply(effect: GestureEffect<Press> | null, event?: MouseEvent) {
    if (!effect) return;
    if (effect.type === 'tap') {
      if (effect.hit?.kind === 'ring') return;
      if (effect.hit) tapPart(effect.hit.part);
      else onTap?.(null);
      return;
    }
    if (effect.owner === OWNER.DRAG_PART) {
      if (effect.type === 'dragStart') {
        // The part's own gesture: its press is on a part, and came with a pointer event.
        beginDrag((effect.hit as PartPress).part, (effect.hit as PartPress).point, event!);
        if (drag) events?.emit(grabEvent(drag.part.id, drag.mode));
      }
      else if (!drag) return;
      else if (effect.type === 'dragEnd') {
        const { part, mode, snapped } = drag;
        endDrag();
        events?.emit(releaseEvent(part.id, mode, { seated: !!snapped }));
      }
      else if (effect.type === 'dragCancel') {
        const { part, mode } = drag;
        cancelDrag(); // interrupted: never snap
        events?.emit(releaseEvent(part.id, mode, { cancelled: true }));
      }
      else moveDrag(effect, event!);
      return;
    }
    if (effect.owner === OWNER.GIZMO_RING && rings) {
      // Rings left round a part that has since been seated never turn it; the gizmo's
      // move/end do nothing for a turn that never started.
      if (effect.type === 'dragStart') {
        // The ring's own gesture: its press is on a ring.
        // A ring gesture only starts on a part's rings, so one is selected.
        if (!placed.has(rings.selected!)) rings.start(effect.hit as RingPress, effect);
      }
      else if (effect.type === 'dragMove') rings.move(effect);
      else if (effect.type === 'dragEnd') rings.end();
      else rings.cancel();
    }
  }

  // A second finger keeps its phone rate; Shift-drag and the wheel are the desktop's, tuned
  // for trackpad deltas.
  const liftRate = (effect: Extract<GestureEffect<Press>, { type: 'lift' }>, event?: MouseEvent) =>
    effect.x === undefined && event?.type !== 'wheel' ? GESTURE.liftRate : GESTURE.desktopLiftRate;

  // Capture phase, so this runs before OrbitControls' own pointerdown on the same element
  // and a part touch has already disabled the camera when OrbitControls sees it.
  function onPointerDown(event: PointerEvent) {
    const hit = state.owner === null ? hitTest(event) : null;
    const wasCamera = state.cameraEnabled;
    state.down(pointer(event, hit));
    syncCamera();
    if (wasCamera && !state.cameraEnabled) domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    apply(state.move(pointer(event)), event);
  }

  function onPointerUp(event: PointerEvent) {
    apply(state.up(pointer(event)), event);
    syncCamera();
  }

  // pointercancel (OS gesture, notification pull-down) and lost capture end the gesture
  // without a drop target; the state machine ignores ids it has already let go of.
  function onPointerCancel(event: PointerEvent) {
    apply(state.cancel(pointer(event)), event);
    syncCamera();
  }

  // Desktop lift; OrbitControls is disabled mid-drag, so the wheel never also zooms.
  function onWheel(event: WheelEvent) {
    apply(state.wheel({ dy: event.deltaY }), event);
  }

  // Shift held = desktop lift. Window-level, so it counts wherever focus sits; a key let go
  // while the window was blurred is cleared by onInterrupted.
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Shift') state.modifier(event.type === 'keydown');
  }

  function onInterrupted() {
    state.modifier(false);
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
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  return {
    // The drag in progress, read-only: which part, and how it is being moved.
    get dragging() {
      return drag && { part: drag.part, mode: drag.mode };
    },
    update,
    // Brings the physics joints in line with the graph after a change made outside a
    // gesture — the display shelf seated pre-fastened — through the same reconcile a tap
    // or turn runs.
    sync: reconcile,
    // The repack's teardown: lets go of any gesture in progress, has every joint elsewhere
    // (the display shelf's too) let go of these parts by its own reverse move — a cam
    // locked on one of their bolts, a back fitting pressed through into one — then takes apart every
    // joint touching `ids` through the same unseat and reconcile a part pulled free goes
    // through — fastened or not, so the physics joints go with them.
    unseatAll(ids) {
      onInterrupted();
      for (const id of assembly.letGoOf(ids)) reportFastening(id, true);
      const set = new Set(ids);
      for (const joint of assembly.all()) if (set.has(joint.hardware) || set.has(joint.host)) unseat(joint);
      reconcile();
    },
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
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    },
  } satisfies GestureRouter;
}

// An invisible box round a small part, never thinner than PICK.proxyMinSize, that widens its
// touch target. Raycasts ignore visibility; it casts and receives no shadow and is never
// registered with physics — it only rides on the part's mesh.
function addHitProxy(part: Part) {
  const size = PART_TYPES[part.type].size.map((d) => Math.max(d, PICK.proxyMinSize));
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(...size));
  proxy.visible = false;
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  part.mesh.add(proxy);
  return proxy;
}
