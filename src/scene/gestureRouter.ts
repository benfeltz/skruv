import * as THREE from 'three';
import { AIM, COLORS, DROP, FASTENER, GESTURE, PANEL, PICK, RING, ROOM, SNAP, TURN_RING } from '../constants.js';
import { areCompatible, COMPATIBLE, CONNECTOR, isFastenerEnd, KIND, passesThrough } from '../../tools/validate/lib/vocabulary.js';
import { connectorInWorld, rotateVector } from '../../tools/validate/lib/geometry.js';
import { advancing, capture, carryPose, layersOf } from '../game/assembly.js';
import { PART_TYPES } from '../game/item.js';
import { socketUnder } from '../game/decals.js';
import { createCrank, tightenSign } from '../game/crankMath.js';
import { driveRadians, ratchetTicks } from '../game/driveMath.js';
import { clampLift, clampToRoom, easeToward, fitsInRoom, intersectDragPlane, pullAlong, rebaseDragOffset, rotatedHalfExtents } from '../game/dragMath.js';
import { isCrankKind, isFastened, isHome, isTapKind, sinksAsTurned, spanOf } from '../game/fasteners.js';
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
import { shiftScroll } from '../game/liftLine.js';
import { isSmallPart, preferHit, rayBoxReach } from '../game/pickMath.js';
import { findFits, heldOffer, isPanelType, preferredPoses, preferredTargets, preferredThrough, rankFits } from '../game/panelFit.js';
import { applyTransform, findSnap } from '../game/snapMath.js';
import { aimAngle, aimedRotation, aimStep, aimWeight, nearestTarget } from '../game/toolAim.js';
import { isSeatTarget, isToolTip, isWorkable, ringStrengths, seatedHardware } from '../game/toolTargets.js';
import type { Probe } from '../game/toolTargets.js';
import { gripOf, isDrawn, isTurnHome, isTurnStalled, pickDial, tightensClockwise, turnProgress } from '../game/turnRing.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';
import type { FitPair, Relatives } from '../game/panelFit.js';
import type { Snap } from '../game/snapMath.js';
import type { Assembly, AssemblyJoint, Head, PartId, Turn } from '../game/assembly.js';
import type { Bus } from '../game/events.js';
import type { ApplyContext } from '../game/assembly.js';
import type { GestureEffect } from '../game/gestureState.js';
import type { ScreenPoint } from '../game/dragMath.js';
import type { Part } from '../game/partMesh.js';
import type { PhysicsJoint, PhysicsWorld } from '../physics/world.js';
import type { RingHit } from './gizmo.js';
import type { HandleHit } from './sprue.js';
import type { TargetRing } from './targetRings.js';
import type { VerticalReach } from './liftHold.js';
import type { Dial } from '../ui/turnRing.js';
import type { Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';

/** A press on a part: which, where, and how far along the ray. */
interface PartHit {
  part: Part;
  point: Vec3;
  distance: number;
}

// A press on a turn ring is its grip's — the seated tool, or the part circled by hand —
// carrying the turn it turns: the state machine owns it as any part press, but it never taps.
type PartPress = { kind: 'part'; dial?: Turn } & PartHit;
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

/**
 * A seat on offer: the pose it holds the dragged part at and its snap. A panel's whole fit
 * also carries every pair it seats, its snap the first, which pairs those are (`key`), whether
 * it is where the panel goes, and where the finger had the panel when it was first offered.
 */
type Offer = Pose & { snap: RouterSnap; pairs?: FitPair<WorldConnector, WorldConnector>[]; key?: string; preferred?: boolean; taken?: Pose };

/** One fastener end of a carried part — a tool's tip, a dowel's either end — and the seats that take it. */
interface CarriedEnd {
  connector: (typeof PART_TYPES)[string]['connectors'][number];
  index: number;
  seats: WorldConnector[];
}

/** Where a carried panel goes, near it: the pose, how far its centre is from the panel's, and the free ends it would sit on. */
interface PanelGoal {
  pose: Pose;
  distance: number;
  ends: WorldConnector[];
}

/** Where a pointer is, in client coordinates. */
interface ClientPoint {
  clientX: number;
  clientY: number;
}

// The drag in progress. One record for every mode; each sets only its own fields —
// 'move'/'compound' the plane drag's (beginMove), 'pull' start and joints (beginPull),
// 'crank' the crank (beginCrank) — what it turns is read from the graph's turn each move.
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
  finger: Vec3 | null;
  snapped: Offer | null;
  offer: string | null;
  retarget: { from: number; to: number } | null;
  pointer: ClientPoint | null;
  start: ScreenPoint;
  joints: { id: number; axis: ScreenPoint }[];
  crank: ReturnType<typeof createCrank>;
  carry: Carry | null;
}

/**
 * A panel picked up with everything that goes with it: the rest of its assembly (panels and
 * hardware fastened to it, near or far) and the hardware seated only in them (dowels put in a
 * shelf before it goes on a side panel). Where the panel was when picked up, and every other
 * part it carries, each with where it was then, so it rides along rigidly.
 */
interface Carry {
  start: Pose;
  riders: { part: Part; start: Pose }[];
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
  verticalReachOf(part: Part, rotation: Quat): VerticalReach;
  carries(part: Part): boolean;
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
  ghost?: { show(mesh: THREE.Mesh, pose: Pose, whereItGoes?: boolean): void; hide(): void };
  sprue?: { selected: Part | null; hitTest(raycaster: THREE.Raycaster): HandleHit | null };
  dropGuide?: { show(from: Vec3, to: Vec3): void; hide(): void };
  targetRings?: { show(rings: readonly TargetRing[]): void; hide(): void };
  events?: Pick<Bus, 'emit'>;
  hold?: { readonly held: Part | null; readonly height: number; readonly goal: number; target(height: number): void; jump(height: number): void };
  turnRing?: { show(dials: readonly Dial[]): void; hide(): void };
  onRatchet?: (count: number) => void;
  onRehome?: (kind: FastenerKind) => void;
  relatives?: Relatives;
}

// A hole marking on a part's mesh (src/game/partMesh.ts).
type Decal = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

// Hardware (fastener or tool) has a fastener end; panels have only holes, or nothing.
const isHardware = (type: string) => PART_TYPES[type].connectors.some((c) => c.type in COMPATIBLE);

// A part that seats by a whole fit of its holes (src/game/panelFit.ts) — never hardware, the lid or the base.
const isPanel = (type: string) => isPanelType(PART_TYPES[type]);

// Fasteners and tools, never panels — the parts that get a fat hit proxy.
const isSmall = (type: string) => isSmallPart(PART_TYPES[type].size, PICK);

// A part's fastener ends — what it seats by: a tool's tip, a dowel's two ends, a bolt's
// thread. Catalog connector indices; none for a panel or the box.
const endsOf = (type: string) => PART_TYPES[type].connectors.flatMap((c, index) => (isFastenerEnd(c.type) ? [index] : []));

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
 *   ghost  — `{ show(mesh, pose, whereItGoes), hide() }` snap preview (src/scene/ghost.ts),
 *            green when a panel's fit on offer is where it goes.
 *   dropGuide — `{ show(from, to), hide() }` line from a dragged part down to where it
 *            would land (src/scene/dropGuide.ts); a free hole there that takes the part
 *            glows, as does the seat the ghost shows.
 *   targetRings — `{ show(rings), hide() }` rings on where carried hardware can go right
 *            now — the free holes a fastener takes, the fasteners a tool can turn — lit as
 *            the finger nears them (src/scene/targetRings.ts); letting go over a lit one
 *            seats the part there.
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
 *            gone; a lift (second finger, wheel) moves the line with it, and Shift + scroll
 *            moves the line, with or without a drag. A part the
 *            line holds is never a seat for another: it drops when the line lets go.
 *   turnRing — `{ show(dials), hide() }` (src/ui/turnRing.ts): a dial for each turn the
 *            graph has (`assembly.turns`) — round the head a seated tool is on, for as long
 *            as it is on; round the hole of a part circled by hand (a leg on its stud) while
 *            the finger is on that part — its arc at the turn's progress (full at home) and flashing as it
 *            goes home. A press on its band is its grip's crank — a drag there turns it as
 *            circling does, a tap does nothing; only a tap on a tool itself takes it off.
 *            Which turns get a dial, and where it is grabbed, is src/game/turnRing.ts's call.
 * Turns: what a gesture on a part turns — its joints, what visibly turns and about what,
 * what rides along, what is loose — is the graph's record (`assembly.turnOf`, `Turn`), read
 * by the crank, the drive, the draw, the dials, the tap and the hold alike. A seated tool
 * cranks on any drag; so does a part circled by hand (a leg on its stud) — the part itself
 * is what is circled, its ring shown round its hole only while the finger is on it, and it
 * takes no gizmo. A table moves by a part with no turn of its own (the top its studs were
 * keyed into); a loose leg comes off its stud with a tap.
 * Hold-to-drive: a press on a turn's grip or its ring held still past a tap
 * (GESTURE.tapMaxMs) drives the turn home in FASTENER.driveSeconds, tightening only, and
 * stops there; letting go after it is never a tap, so a tool stays on. A press that moves
 * becomes the crank as before.
 *   onRatchet — called with how many ratchet clicks (one per FASTENER.ratchetRadians of
 *            turn, either way) a crank or drive step crossed, when it crossed any. A haptic
 *            cue, not telemetry: nothing goes on the bus.
 *   onRehome — called with the fastener's kind when a bolt or cam backed off partway (still
 *            screwed or locked — it lets go only all the way out) is turned home again: the
 *            arrival no FASTEN event marks, since its state never changed. Haptics only too.
 *   relatives — where each panel goes relative to the panels it meets in the finished item
 *            (src/game/panelFit.ts `preferredRelatives`, worked out once by the caller): a
 *            carried panel's fit there is offered first. Never a gate — any fit seats; without
 *            it, fits rank by how many holes they seat.
 * Call `update(delta)` once per frame after the physics step: it draws fastener progress,
 * turns carried hardware's end toward a seat near it (self-aim), eases a dragged part
 * toward the seat on offer (seat assist) and fades the seat flash.
 */
export function createGestureRouter({ domElement, camera, cameraControls, physics, parts, assembly, rings, onTap, ghost, sprue, dropGuide, targetRings, events, hold, turnRing, onRatchet, onRehome, relatives = new Map() }: GestureRouterOptions) {
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
  const other = new THREE.Quaternion();
  const pivot = new THREE.Vector3();
  // The parts the update loop has drawn turning this frame, and the riders it has moved —
  // each once, the first writer winning.
  const drawnTurning = new Set<PartId>();
  const drawnRiding = new Set<PartId>();
  // Riders of a turn, with the move the turn made — see the update loop; `riding` is the
  // pool, `ridingCount` how many are live this frame.
  const riding: { part: Part | null; delta: THREE.Matrix4 }[] = [];
  let ridingCount = 0;
  const ridingPose = new THREE.Matrix4();
  const drawDelta = new THREE.Matrix4();
  const drawAxis = new THREE.Vector3();
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
  // Hardware seated but not yet pushed home in a panel that was carried → that panel (the
  // grabbed one, or another of its assembly), and where each was then: it is held where it
  // sits in the panel (it rides along) until it is pushed home and its joints hold it, or it
  // leaves the panel.
  const riders = new Map<PartId, { host: Part; hostStart: Pose; start: Pose }>();
  // decal mesh → ms of glow left, after a fastener seated in its hole.
  const flashes = new Map<Decal, number>();
  // The hole marking lit under the drop line (or at the seat on offer), if any.
  let glowing: Decal | null = null;
  let glowColor: number = COLORS.decalFlash;
  const down = new THREE.Vector3(0, -1, 0);
  // A carried part's end in the world, rewritten every frame (endAt).
  const endPoint: Vec3 = [0, 0, 0];
  // Grip id (the tool, or the part turned by hand) → whether its turn was home last frame,
  // and → ms of home flash left on its dial.
  let dialed = new Map<PartId, boolean>();
  const dialFlashes = new Map<PartId, number>();
  // A press on a turn's grip (or its turn ring) not yet a drag: how long it has been held
  // still (ms), and whether it has been held past a tap and so drives (hold-to-drive).
  let press: { id: number; grip: Part; ms: number; held: boolean } | null = null;
  // The part the primary finger went down on, until it lifts: whose hand ring is shown.
  let touching: Part | null = null;
  // The part the elevation line held at the last frame, so a new hold is seen once (carryHeld).
  let lifted: Part | null = null;
  // The part whose assembly is held still under a panel's fit on offer (holdStill), if any.
  let still: Part | null = null;
  // A panel held where it seated → the assembly it seated onto, held still with it until the
  // panel is let go: both sides of a seat stay put until a fastener holds them (letGoUnder).
  const stillUnder = new Map<Part, Part>();

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
    const dial = dialUnder(event, picked?.part ?? null);
    if (dial) return dial;
    const handle = sprue?.hitTest(raycaster) ?? null;
    if (handle && sprue!.selected && [ring, picked].every((hit) => !hit || handle.distance <= hit.distance)) {
      return resolveHit<RingHit, PartHit>(null, { part: sprue!.selected, ...handle });
    }
    return resolveHit(ring, picked);
  }

  // A press on a turn ring's band: nearer than anything under it, but never another turn's
  // over a part that has a turn of its own — a seated tool (JOHNNY's cam ring all but covers
  // the bolt's), a part circled by hand: a press on it is its own, whatever neighbour's ring
  // it lies in and however far its turn has gone, so a tap there still takes a tool off and
  // a hold drives. A part circled by hand lies under its own ring (a top under a ring round
  // one of its holes): there the band is its ring, to crank it. Where bands overlap, the
  // turn still to go home takes it (pickDial).
  function dialUnder({ clientX, clientY }: ClientPoint, picked: Part | null): PartPress | null {
    const own = picked && assembly.turnOf(picked.id);
    if (own && own.grip.kind === 'tool') return null;
    const rect = domElement.getBoundingClientRect();
    const dials = assembly
      .turns()
      .filter((turn) => isDrawn(turn, isPressed(turn)))
      .map((turn) => {
        const head = centreOf(turn);
        return { turn, head, centre: screenPoint(head, rect), home: isTurnHome(turn) };
      });
    const hit = pickDial([clientX, clientY], dials);
    if (!hit || (own && gripOf(hit.turn) !== picked!.id)) return null;
    return { kind: 'part', part: partById.get(gripOf(hit.turn))!, point: hit.head, distance: 0, dial: hit.turn };
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

  // A world point in client (CSS px) coordinates; a caller projecting many points reads the
  // canvas `rect` once and passes it.
  function screenPoint(position: Vec3, rect = domElement.getBoundingClientRect()): ScreenPoint {
    scratch.fromArray(position).project(camera);
    return [rect.left + ((scratch.x + 1) / 2) * rect.width, rect.top + ((1 - scratch.y) / 2) * rect.height];
  }

  // Connectors already in a seat — a filled hole, a dowel end already in one, a bolt head
  // with a wrench on it — take no second one.
  function occupied() {
    const taken = new Set<string>();
    for (const j of assembly.all()) {
      taken.add(`${j.hardware}#${j.hardwareConnector}`);
      taken.add(`${j.host}#${j.hostConnector}`);
      // Whatever shares a spot with a taken connector is as taken: a stud's hex at an end sunk
      // in a hole (no key seats in the wood), and the end under a key sitting in its hex (no
      // leg drops over it, burying the key).
      for (const index of assembly.coincident(j.hardware, j.hardwareConnector)) taken.add(`${j.hardware}#${index}`);
      for (const index of assembly.coincident(j.host, j.hostConnector)) taken.add(`${j.host}#${index}`);
    }
    return (c: WorldConnector) => taken.has(`${c.part.id}#${c.index}`);
  }

  function snapCandidate(target: Vec3) {
    const { part } = drag!;
    // The rotation the part was picked up at — the mesh's may be easing toward a seat.
    const rotation = twist.fromArray(drag!.rotation);
    const isTaken = occupied();
    const free = (connectors: WorldConnector[]) => connectors.filter((c) => !isTaken(c));
    // A tool on a loose bolt or cam lock is a dead end: nothing turns until it is seated —
    // whichever side is carried to the other.
    const seated = seatedHardware(assembly.all());
    if (isPanel(part.type)) {
      const from: Pose = { position: target, rotation: drag!.rotation };
      // The fit on offer holds against one as good while the finger keeps the panel near where
      // it was offered.
      const held = drag!.snapped;
      return heldOffer(held?.key ? { ...held, key: held.key } : null, fitCandidate(carriedConnectors(from, isTaken), seatsFor(part), from), from, PANEL);
    }
    const dragged = free(worldConnectors(part, scratch.clone().fromArray(target), rotation)).filter((c) => isSeatTarget(c, seated));
    if (dragged.length === 0) return null;
    // A part the elevation line holds up is no seat: it drops when the line lets go.
    const up = heldUp();
    const others = parts.flatMap((other) =>
      other === part || up.has(other)
        ? []
        : free(worldConnectors(other, other.mesh.position, other.mesh.quaternion)).filter((c) => isSeatTarget(c, seated)),
    );
    const snap = findSnap(dragged, others, SNAP);
    return snap && seatPose(snap, { position: target, rotation: drag!.rotation });
  }

  // A panel's offer: the best whole fit of what it seats by (`carried` — its holes, and the
  // ends of hardware it carries) on the free connectors near them (`seats`) that keeps it in
  // the room — where it goes first, but any fit seats. Its snap is the first pair's.
  // `accept`: only fits it takes, by which pairs they seat and whether they are where it goes.
  function fitCandidate(carried: WorldConnector[], seats: WorldConnector[], from: Pose, accept?: (key: string, preferred: boolean) => boolean): (Offer & { key: string }) | null {
    for (const fit of rankFits(findFits(carried, from, seats, PANEL), preferredFor(drag!.part), PANEL)) {
      if (accept && !accept(keyOf(fit.pairs), fit.preferred)) continue;
      const [{ hole, end }] = fit.pairs;
      const distance = Math.hypot(...end.position.map((v, i) => v - hole.position[i]));
      const seat = seatPose({ from: hole, to: end, distance, angle: fit.angle, transform: fit.transform }, from);
      if (seat) return { ...seat, pairs: fit.pairs, key: keyOf(fit.pairs), preferred: fit.preferred };
    }
    return null;
  }

  // Which pairs a fit seats, the same for the same pairs in any order.
  const keyOf = (pairs: FitPair<WorldConnector, WorldConnector>[]) =>
    pairs
      .map(({ hole, end }) => `${hole.part.id}#${hole.index}>${end.part.id}#${end.index}`)
      .sort()
      .join(',');

  // While a panel's fit is on offer, the assembly it would seat on is held still where it
  // lies — a carcass rocking on its joints, or nudged by the panel easing in, would move the
  // seats out from under the fit — and handed back to the simulation when the offer goes, the
  // line takes any of it, or the drag ends. It is the assembly of the panel the fit's seats are
  // in: a dowel end's, the panel that dowel sits in, pushed home or not. Only an assembly
  // nothing else holds: none of it held at a seat, on the line, riding in a panel or carried.
  // An assembly already held under a seated panel is held already: it is shared, never
  // grabbed twice, and let go only once nothing stands on it (letGo).
  function holdStill(offer: Offer | null) {
    const target = offer?.pairs ? panelOf(offer.pairs[0].end.part) : null;
    if (still && target && assembly.compoundOf(still.id).has(target.id) && !heldUp().has(still)) return;
    if (still) letGo(still);
    const under = target && [...stillUnder.values()].find((part) => assembly.compoundOf(part.id).has(target.id));
    still = under || (target && isFree(target) ? target : null);
    if (still && !under) physics.grab(still.body);
  }

  // Hands an assembly held still back to the simulation — unless a seated panel still stands on it.
  function letGo(part: Part) {
    if (![...stillUnder.values()].includes(part)) physics.release(part.body);
  }

  // The panel a seat is in: the part itself, or for a dowel's end, the panel the dowel sits in.
  function panelOf(part: Part): Part {
    if (isPanel(part.type)) return part;
    const joint = assembly.jointsOf(part.id).find((j) => j.hardware === part.id && isPanel(partById.get(j.host)!.type));
    return joint ? partById.get(joint.host)! : part;
  }

  function isFree(part: Part) {
    const up = heldUp();
    const carried = new Set([drag!.part, ...(drag!.carry?.riders ?? []).map((rider) => rider.part)]);
    return [...assembly.compoundOf(part.id)].every((id) => {
      const member = partById.get(id)!;
      return !placed.has(member) && !up.has(member) && !carried.has(member) && !riders.has(id);
    });
  }

  // A panel's fit on offer as it stands at release: held, it may have been found a while ago,
  // and what it seats on nudged or taken away since. Searched again from where the panel is
  // held — the same pairs if they are still there, else as many of them as still line up (never
  // a fit the ghost did not show: no pair it did not offer, and green only if it was), else none.
  function settled(offer: Offer & { key: string }) {
    const from = drag!.held ?? offer;
    const isTaken = occupied();
    const carried = carriedConnectors(from, isTaken);
    const seats = seatsFor(drag!.part);
    const offered = new Set(offer.key.split(','));
    return (
      fitCandidate(carried, seats, from, (key) => key === offer.key) ??
      fitCandidate(carried, seats, from, (key, preferred) => key.split(',').every((pair) => offered.has(pair)) && (preferred || !offer.preferred))
    );
  }

  // A part's connectors as world records at `pose`, its part and index riding along.
  const connectorsAt = (part: Part, pose: Pose): WorldConnector[] =>
    PART_TYPES[part.type].connectors.map((c, index) => ({ type: c.type, ...connectorInWorld(c, pose), part, index }));

  // What the carried panel seats by with it at `pose`: its free holes and those of every
  // other panel it carries, and the free fastener ends of the hardware it carries (a dowel's
  // other end) — all riding along rigidly.
  function carriedConnectors(pose: Pose, isTaken = occupied()) {
    const { part, carry } = drag!;
    const own = connectorsAt(part, pose).filter((c) => !isTaken(c));
    const riding = (carry?.riders ?? []).flatMap(({ part: rider, start }) =>
      connectorsAt(rider, carryPose(carry!.start, pose, start)).filter((c) => (isPanel(rider.type) || isFastenerEnd(c.type)) && !isTaken(c)),
    );
    return [...own, ...riding];
  }

  // Where `panel` goes on each part in the room it meets in the finished item, as they lie
  // now — and, carried, where it goes when any panel it carries goes on one: that member's
  // place, with `panel` at the offset it had from it when picked up.
  function preferredFor(panel: Part) {
    const carry = drag?.part === panel ? drag.carry : null;
    const members = (carry?.riders ?? []).filter(({ part }) => isPanel(part.type));
    const carried = new Set([panel, ...(carry?.riders ?? []).map(({ part }) => part)]);
    return parts.flatMap((host) => {
      if (carried.has(host)) return [];
      const at: Pose = { position: host.mesh.position.toArray(), rotation: host.mesh.quaternion.toArray() };
      return [
        ...preferredPoses(relatives, host.type, at, panel.type),
        ...members.flatMap(({ part, start }) => preferredPoses(relatives, host.type, at, part.type).map((pose) => preferredThrough(pose, start, carry!.start))),
      ];
    });
  }

  // Where `snap` seats the dragged part from `pose`. The alignment can swing a long part's
  // far end by up to SNAP.maxAngle (a ring drop's by more); refuse a seat that would hold it
  // through the floor or a wall.
  function seatPose(snap: RouterSnap, from: Pose): Offer | null {
    const pose = applyTransform(snap.transform, from);
    const half = rotatedHalfExtents(PART_TYPES[drag!.part.type].size.map((d) => d / 2), pose.rotation);
    return fitsInRoom(pose.position, half, ROOM, SNAP.roomTolerance) ? { ...pose, snap } : null;
  }

  // --- joint lifecycle: physics follows the graph ---

  const isBonded = (part: Part) => [...bonds.values()].some(({ a, b }) => a === part.id || b === part.id);

  // A panel carried into seats by its hardware, not one of them yet pushed home — or by any
  // panel of a joined assembly, which is bonded inside itself from the start, so its bonds say
  // nothing about the seats. Seats inside the assembly are its own, never awaited.
  function awaitsSeat(part: Part) {
    const members = assembly.compoundOf(part.id);
    const joined = members.size > 1;
    return assembly
      .all()
      .some((j) => members.has(j.mover) && !isFastened(j.fastener) && !(members.has(j.hardware) && members.has(j.host)) && (joined || (j.hardware !== j.mover && j.host !== j.mover)));
  }

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
      // now hold it — never while a seat it was carried into is still only seated (a panel
      // carried in on dowels pushed home in it is bonded to them from the start).
      if (awaitsSeat(part)) continue;
      if (!isBonded(part)) continue;
      placed.delete(part);
      physics.release(part.body);
      letGoUnder(part);
    }
    holdLooseHardware();
  }

  // Hardware let go by its joints without being pulled free — a bolt backed all the way
  // out, a cam turned open, a leg circled off its stud, a leg and its stud circled out of
  // the top — sits back at its hole's mouth, held as when first seated. What a turn turns,
  // its record says (`loose`: the unit and the seat it rests at); a joint no turn has (a cam
  // opened by a teardown) holds its hardware, pushed in, fastened to nothing.
  function holdLooseHardware() {
    const joints = assembly.all();
    const world = assembly.turns();
    for (const { loose } of world) if (loose) holdUnit(loose);
    const turned = new Set(world.flatMap((turn) => turn.joints.map((j) => j.id)));
    for (const joint of joints) {
      if (turned.has(joint.id)) continue;
      const part = partById.get(joint.hardware)!;
      if (joint.mover !== part.id || joint.kind === KIND.TOOL || isFastened(joint.fastener)) continue;
      if (placed.has(part) || isBonded(part) || carrying(part)) continue;
      if (assembly.jointsOf(part.id).some((j) => isFastened(j.fastener))) continue;
      holdUnit({ parts: [part.id], restFrom: joint });
    }
  }

  // A loose unit held kinematic at its seat's mouth, every part of it where the seat puts
  // it — unless any of it is already held, or being carried. A part being cranked is held
  // all the same: circled off its stud mid-drag, the crank owns where it is, not gravity.
  function holdUnit({ parts: ids, restFrom }: NonNullable<Turn['loose']>) {
    const unit = ids.map((id) => partById.get(id)!);
    if (unit.some((part) => placed.has(part) || carrying(part))) return;
    const rests = unit.map((part) => assembly.restPose(restFrom.id, poseOf, part.id));
    unit.forEach((part, i) => {
      physics.grab(part.body);
      physics.move(part.body, rests[i].position, rests[i].rotation);
      placed.add(part);
    });
  }

  // Whether `part` is in hand being moved — carried, dragged, pulled — rather than cranked.
  const carrying = (part: Part) => drag?.part === part && drag.mode !== 'crank';

  // A part held for a seat goes back to the simulation.
  function release(part: Part) {
    if (!placed.has(part)) return;
    placed.delete(part);
    physics.release(part.body);
    letGoUnder(part);
  }

  // A seat whose parts have drifted apart (a held part knocked off, a host moved away)
  // is no seat; only unfastened ones can drift. Hardware riding in a panel is where the
  // panel is first: it goes with it.
  function pruneStale() {
    followRiders();
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
    for (const id of [joint.hardware, joint.host]) if (assembly.jointsOf(id).length === 0) release(partById.get(id)!);
  }

  // The assembly held still under a seated panel goes back to the simulation with it.
  function letGoUnder(seated: Part) {
    const under = stillUnder.get(seated);
    if (!under) return;
    stillUnder.delete(seated);
    if (under !== still) letGo(under);
  }

  // Taking up `part` — a drag, or the line — first hands back any assembly held still under a
  // seat that it is in, or that is under it: from then on it is the player's, and a stale seat
  // let go mid-drag (pruneStale) can never drop the assembly out of a compound drag.
  function letGoOf(part: Part) {
    for (const [seated, under] of stillUnder) if (seated === part || assembly.compoundOf(under.id).has(part.id)) letGoUnder(seated);
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
    letGoOf(part);
    // Carry or turn: a seated tool with something to turn cranks it, and so does a part with
    // a turn by hand — the part itself is what is circled, whatever its state. A table moves
    // by a part with no turn of its own: the top its studs were keyed into, a keyed leg.
    const turn = assembly.turnOf(part.id);
    const turns = turn !== null && turn.joints.length > 0;
    // A panel pushed home onto another pulls back off it, as before; a cam locked across the
    // seam stops the pull (pullable), and the panel carries its assembly instead.
    const pulls = assembly.pullable(part.id).length > 0;
    const carried = pulls ? null : carryOf(part);
    if (turns) beginCrank(part, event);
    else if (pulls) beginPull(part, event);
    else if (carried) beginCarry(part, carried, point, event);
    else if (assembly.canRelease(part.id)) {
      // Nothing holds it: it leaves whatever it was seated on.
      placed.delete(part);
      for (const joint of assembly.jointsOf(part.id)) unseat(joint);
      reconcile();
      beginMove(part, point, event, 'move');
    }
    // Bonded into a compound: it all comes along through the joints. A part only partway
    // fastened and bonded to nothing (a half-turned bolt) stays put.
    else if (isBonded(part)) beginMove(part, point, event, 'compound');
  }

  // What a panel would carry: every other part of its assembly — the panels and hardware
  // fastened to it, near or far (compoundOf) — and the hardware seated only in them (seatedIn).
  // Null when it is not a panel, carries nothing, or a tool is on any of it. Anything fastened
  // to the assembly is in it, so a carry never tears a fastening; what it only sits on, it
  // leaves (takeUp). A piece of hardware is never carried by: grabbed, it drags its compound.
  function carryOf(part: Part): Part[] | null {
    if (!isPanel(part.type)) return null;
    const members = assembly.compoundOf(part.id);
    if ([...members].some((id) => assembly.jointsOf(id).some((j) => j.kind === KIND.TOOL))) return null;
    const carried = [...members, ...seatedIn(members)].filter((id) => id !== part.id);
    return carried.length > 0 ? carried.map((id) => partById.get(id)!) : null;
  }

  // The hardware seated only in `members`: each piece outside them seated in one of them, and
  // in nothing else — bar seats one of them was carried onto and not yet pushed home, which it
  // leaves. Hardware with a tool on it stays where it is.
  function seatedIn(members: ReadonlySet<PartId>): PartId[] {
    const ridesOn = (j: AssemblyJoint) => members.has(j.host) || (members.has(j.mover) && !isFastened(j.fastener));
    const out = new Set<PartId>();
    for (const id of members) {
      for (const j of assembly.jointsOf(id)) {
        if (j.host === id && j.kind !== KIND.TOOL && !members.has(j.hardware) && assembly.jointsOf(j.hardware).every(ridesOn)) out.add(j.hardware);
      }
    }
    return [...out];
  }

  // A panel carrying its assembly: it leaves whatever else it sat on, and the rest comes along
  // — that fastened to it through its joints, as any compound (the physics seam carries it),
  // that only seated held where it sits (riders). It is a free part's drag from then on: it
  // lifts, aims, and looks for a whole fit for all of it.
  function beginCarry(part: Part, carried: Part[], point: Vec3, event: ClientPoint) {
    const carry: Carry = { start: poseOf(part.id), riders: carried.map((rider) => ({ part: rider, start: poseOf(rider.id) })) };
    takeUp(part, carry);
    beginMove(part, point, event, 'move', carry);
    clampCarried(drag!.rotation);
  }

  // Takes `carry` up off whatever it sits on outside itself: every seat between a part it
  // carries and one it leaves goes. Its assembly is no longer held where it seated — the
  // physics seam moves it as one now — and the hardware only seated in it is held where it
  // sits in its panel, riding along (riders) until pushed home or taken out.
  function takeUp(part: Part, carry: Carry) {
    const ids = new Set([part.id, ...carry.riders.map((r) => r.part.id)]);
    for (const id of ids) for (const joint of assembly.jointsOf(id)) if (!ids.has(joint.hardware) || !ids.has(joint.host)) unseat(joint);
    placed.delete(part);
    reconcile();
    const members = assembly.compoundOf(part.id);
    for (const { part: rider, start } of carry.riders) {
      if (members.has(rider.id)) {
        placed.delete(rider);
        continue;
      }
      const host = partById.get(assembly.jointsOf(rider.id).find((j) => members.has(j.host))!.host)!;
      riders.set(rider.id, { host, hostStart: poseOf(host.id), start });
      if (placed.has(rider)) continue;
      physics.grab(rider.body);
      placed.add(rider);
    }
  }

  // Whether the elevation line can take `part` up as it stands, selected: a panel this would
  // carry, its assembly sitting in no seat outside itself — so nothing is torn off it, and
  // none of it is held at a seat.
  function carries(part: Part) {
    const carried = carryOf(part);
    if (!carried || placed.has(part)) return false;
    const ids = new Set([part, ...carried].map((p) => p.id));
    return [...ids].every((id) => assembly.jointsOf(id).every((j) => ids.has(j.hardware) && ids.has(j.host)));
  }

  // What the elevation line holds up: its part and all that part carries — its assembly, its
  // seated hardware. None of it is a seat: it all drops when the line lets go.
  function heldUp(): Set<Part> {
    const held = hold?.held;
    return new Set(held ? [held, ...(carryOf(held) ?? [])] : []);
  }

  // A panel the line took up outside a drag carries what a drag of it would: its assembly
  // through the physics seam, as the hold grabs it, and the hardware only seated in it held
  // where it sits in its panel (riders) — none left hovering, none dropping out. The hold may
  // have raised the assembly before this frame sees it, so that hardware is placed by its seat
  // in its panel as the panel is now, never where it was left.
  function carryHeld() {
    const held = hold?.held ?? null;
    if (held === lifted) return;
    lifted = held;
    if (held) letGoOf(held);
    if (!held || drag?.part === held) return;
    const carried = carryOf(held);
    if (!carried) return;
    const members = assembly.compoundOf(held.id);
    const startOf = (rider: Part) =>
      members.has(rider.id) ? poseOf(rider.id) : assembly.restPose(assembly.jointsOf(rider.id).find((j) => members.has(j.host))!.id, poseOf);
    takeUp(held, { start: poseOf(held.id), riders: carried.map((rider) => ({ part: rider, start: startOf(rider) })) });
  }

  // The carried panel's reach with it turned to `rotation`, kept on the drag, as the lift
  // and the wall clamp read it: the box's half-extents, and its centre's offset from the
  // panel's, as a compound's footprint keeps them.
  function clampCarried(rotation: Quat) {
    const { centre, half } = reachOf(drag!.part, rotation);
    drag!.centre = centre;
    drag!.half = [half[0], half[2]];
    drag!.halfHeight = half[1];
  }

  // The box `part` fills with it turned to `rotation` — its centre's offset from the part's,
  // and its half-extents: its own box, widened to take in everything it carries (its
  // assembly's other panels and hardware, as the drag carries them, else as they sit now) on
  // whichever side it lies, so no clamp, the elevation line's included, lets a dowel or a
  // joined panel through the floor or a wall, nor lifts a panel by what stands on it.
  function reachOf(part: Part, rotation: Quat): { centre: Vec3; half: Vec3 } {
    const own = rotatedHalfExtents(PART_TYPES[part.type].size.map((d) => d / 2), rotation);
    const min = own.map((v) => -v);
    const max = [...own];
    const carry = drag?.part === part && drag.carry ? drag.carry : carriedNow(part);
    const at: Pose = { position: [0, 0, 0], rotation };
    for (const { part: rider, start } of carry?.riders ?? []) {
      const pose = carryPose(carry!.start, at, start);
      const reach = rotatedHalfExtents(PART_TYPES[rider.type].size.map((d) => d / 2), pose.rotation);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], pose.position[i] - reach[i]);
        max[i] = Math.max(max[i], pose.position[i] + reach[i]);
      }
    }
    // map keeps the length; TS widens a mapped tuple to number[].
    return { centre: min.map((v, i) => (v + max[i]) / 2) as Vec3, half: min.map((v, i) => (max[i] - v) / 2) as Vec3 };
  }

  // What `part` would carry, as it all sits now.
  function carriedNow(part: Part): Carry | null {
    const riders = carryOf(part);
    return riders && { start: poseOf(part.id), riders: riders.map((rider) => ({ part: rider, start: poseOf(rider.id) })) };
  }

  function beginMove(part: Part, [px, py, pz]: number[], event: ClientPoint, mode: 'move' | 'compound', carry: Carry | null = null) {
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
      // Where the finger puts it, whatever it is held at.
      finger: null,
      snapped: null,
      // The seat last reported on offer (telemetry), so only a change is reported.
      offer: null,
      // The line's goal before a seat offer moved it (from), and where the offer put it (to).
      retarget: null,
      pointer: null,
      // A panel's own hardware, riding along (beginCarry).
      carry,
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

  // A drag of the part the elevation line holds rides at the line's height. A hold that
  // starts with a seat already on offer pulls the line there, as a new offer would.
  function followHold() {
    if (!holdsDrag()) {
      if (drag) drag.retarget = null;
      return;
    }
    if (drag!.snapped && !drag!.retarget) pullLineToSeat();
    if (hold!.height !== drag!.height) raiseDrag(hold!.height);
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
    drag!.finger = target;
    refreshOffer(target);
    // No seat on offer: the part is exactly where the finger puts it, no pull at all. With
    // one, update() eases it in from wherever it is held.
    if (drag!.snapped && drag!.held) return;
    drag!.held = { position: target, rotation: drag!.rotation };
    physics.move(drag!.part.body, target, drag!.mode === 'move' ? drag!.rotation : undefined);
  }

  // The seat on offer with the part at `target` — reported, and shown as the ghost.
  function refreshOffer(target: Vec3) {
    // A compound carries its joints along; only a free part looks for a seat.
    drag!.snapped = drag!.mode === 'move' ? snapCandidate(target) : null;
    holdStill(drag!.snapped);
    reportOffer();
    if (drag!.snapped) ghost?.show(drag!.part.mesh, drag!.snapped, drag!.snapped.preferred);
    else ghost?.hide();
  }

  function reportOffer() {
    const snap = drag!.snapped?.snap ?? null;
    const offer = snap && `${snap.from.index}>${snap.to.part.id}#${snap.to.index}`;
    if (offer === drag!.offer) return;
    drag!.offer = offer;
    events?.emit(snapCandidateEvent(drag!.part.id, snap));
    if (hold?.held !== drag!.part) return;
    if (drag!.snapped) return pullLineToSeat();
    // When the offer goes, so does its pull: the goal goes back, unless the line has moved
    // it since.
    const back = drag!.retarget;
    drag!.retarget = null;
    if (back && hold.goal === back.to) hold.target(back.from);
  }

  // The line sets the held part's height, so seat assist reaches the seat's through it —
  // once per offer, so moving the line finger afterwards still wins. The goal it had before
  // the first offer is kept, to go back to.
  function pullLineToSeat() {
    const back = drag!.retarget;
    const from = back && hold!.goal === back.to ? back.from : hold!.goal;
    hold!.target(drag!.snapped!.position[1]);
    drag!.retarget = { from, to: hold!.goal };
  }

  // The carried hardware's fastener ends, each with the seats that take it — swept once per
  // frame for both the aim and the rings — or null when no hardware is being carried (a
  // panel, the box, a compound, a pull or a crank).
  function carriedEnds(): CarriedEnd[] | null {
    if (drag?.mode !== 'move' || !drag.held || !drag.pointer) return null;
    const ends = endsOf(drag.part.type);
    if (ends.length === 0) return null;
    const seats = seatsFor(drag.part);
    const { connectors } = PART_TYPES[drag.part.type];
    return ends.map((index) => ({ connector: connectors[index], index, seats: seats.filter((c) => areCompatible(connectors[index].type, c.type)) }));
  }

  // Where a carried part could seat: free connectors on seated hardware or any hole, never
  // on what the elevation line holds up, nor on what a panel carries — as snapCandidate
  // offers them.
  function seatsFor(carried: Part) {
    const isTaken = occupied();
    const seated = seatedHardware(assembly.all());
    const riding = new Set(drag?.carry?.riders.map((r) => r.part));
    const up = heldUp();
    return parts.flatMap((other) =>
      other === carried || up.has(other) || riding.has(other)
        ? []
        : worldConnectors(other, other.mesh.position, other.mesh.quaternion).filter((c) => !isTaken(c) && isSeatTarget(c, seated)),
    );
  }

  // A carried part's end in the world with the part at `pose`, into one reused record.
  function endAt({ connector }: CarriedEnd, { position, rotation }: Pose): Vec3 {
    return scratch.fromArray(connector.position).applyQuaternion(twist.fromArray(rotation)).add(offset.fromArray(position)).toArray(endPoint);
  }

  // Of a carried part's ends, the one whose seat nearest it (inside `zone`) needs the least
  // turn — a dowel aims whichever end is the shorter turn to its hole — or null.
  function aimEnd(ends: CarriedEnd[], pose: Pose, zone: number) {
    let best: { end: CarriedEnd; target: WorldConnector; distance: number; turn: number } | null = null;
    for (const end of ends) {
      const near = nearestTarget(endAt(end, pose), end.seats, zone);
      if (!near) continue;
      const turn = aimAngle(pose.rotation, end.connector.axis, near.target.axis);
      if (!best || turn < best.turn) best = { end, ...near, turn };
    }
    return best;
  }

  // Self-aim: carried hardware whose end nears a seat turns that end into it, harder the
  // nearer, so the snap's angle window comes to the part — a tool's tip to a bolt head, a
  // dowel's end to its hole. Every frame — a still finger sends no events, so the offer the
  // aim brings is looked for here too. Fasteners and tools are tuned apart (AIM.zone/rate,
  // AIM.toolZone/toolRate). Panels never aim; outside the zone, or already
  // pointing in, nothing changes; once a seat is on offer seat assist takes over.
  function aimHardware(ends: CarriedEnd[] | null, delta: number) {
    if (!ends || drag!.snapped) return;
    // No seat on offer: the part is held exactly where the finger puts it.
    const tool = ends.some((end) => isToolTip(end.connector.type));
    const zone = tool ? AIM.toolZone : AIM.zone;
    const near = aimEnd(ends, drag!.held!, zone);
    if (!near || near.turn < AIM.settled) return;
    const aimed = aimedRotation(drag!.rotation, near.end.connector.axis, near.target.axis);
    const position = turnAbout(near.end, aimStep(drag!.rotation, aimed, aimWeight(near.distance, zone), tool ? AIM.toolRate : AIM.rate, delta));
    physics.move(drag!.part.body, position, drag!.rotation);
    // The part seats by these ends and these are their seats: the full offer check runs
    // only once the aim has brought one within the snap window.
    const within = ends.some((end) => {
      const from = { type: end.connector.type, position: endAt(end, drag!.held!), axis: rotateVector(drag!.rotation, end.connector.axis) };
      return findSnap([from], end.seats, SNAP) !== null;
    });
    if (within) refreshOffer(position);
  }

  // Turns the carried part to `rotation` about `end`, so aiming never swings the end off its
  // seat or the part's far side through what lies under it (the screwdriver's tip is 10 cm
  // from its middle). The drag carries on from the new pose: its footprint is the turned
  // one, kept inside the room, and the finger's grab and height are rebased so the next move
  // doesn't put it back. The elevation line holding the drag goes with it, as a lift takes
  // it, so it never pulls the part back down — and whatever height the line is easing
  // toward moves by as much, so a press on its track still gets there.
  function turnAbout(end: CarriedEnd, rotation: Quat): Vec3 {
    const { held, centre } = drag!;
    const [tx, ty, tz] = endAt(end, held!);
    const [lx, ly, lz] = rotateVector(rotation, end.connector.position);
    const [hx, hy, hz] = rotatedHalfExtents(PART_TYPES[drag!.part.type].size.map((d) => d / 2), rotation);
    drag!.half = [hx, hz];
    drag!.halfHeight = hy;
    const [cx, cy, cz] = centre;
    const [bx, , bz] = clampToRoom([tx - lx + cx, 0, tz - lz + cz], drag!.half, ROOM, GESTURE.wallMargin);
    let y = clampLift(ty - ly + cy, hy, ROOM, GESTURE.ceilingMargin) - cy;
    if (holdsDrag()) {
      const goal = hold!.goal + y - hold!.height;
      hold!.jump(y);
      y = hold!.height;
      hold!.target(goal);
    }
    const position: Vec3 = [bx - cx, y, bz - cz];
    const [px, , pz] = held!.position;
    drag!.offset = [drag!.offset[0] + position[0] - px, drag!.offset[1] + position[2] - pz];
    drag!.height = y;
    drag!.rotation = rotation;
    drag!.held = { position, rotation };
    return position;
  }

  // --- target rings: where carried hardware can go right now ---

  // Workable seats for the carried part, nearest the finger first, with how brightly each
  // lights — dark ones included.
  function ringsFor(ends: CarriedEnd[]) {
    const { held, pointer } = drag!;
    const joints = assembly.all();
    const catches = catcher(joints);
    // A dowel's two ends take the same holes: each lights once.
    const workable = [...new Set(ends.flatMap((end) => end.seats))].filter((c) => isWorkable(c, catches));
    const rect = domElement.getBoundingClientRect();
    const reach = ends.map((end) => connectorInWorld(end.connector, held!).position);
    return ringStrengths(workable, [pointer!.clientX, pointer!.clientY], (position) => screenPoint(position, rect), reach, RING);
  }

  // The bolt a seated cam lock's recess would catch, as a turn of it would, and the joint a
  // key put on a hex would turn. The screwed heads are found once per sweep, and only if a
  // cam lock asks.
  function catcher(joints: AssemblyJoint[]): Probe {
    let heads: Head[] | null = null;
    return {
      captured: (cam: PartId) => {
        const joint = joints.find((j) => j.hardware === cam && j.kind === KIND.CAM);
        if (!joint) return null;
        heads ??= screwedHeads();
        return capture(connectorWorld(joint.host, joint.hostConnector), heads)?.id ?? null;
      },
      turnedBy: (hex) => assembly.turnedFrom(hex.part.id, hex.index, joints),
    };
  }

  // Hardware let go with the finger on a lit ring seats there whatever its angle or
  // distance, by the end that takes it with the least turn: the seat snapCandidate would
  // offer, taken with no reach or angle limit.
  function ringDrop() {
    const ends = carriedEnds();
    if (!ends) return null;
    const hit = ringsFor(ends).find(({ strength, offset }) => strength > 0 && offset <= RING.hitRadius);
    if (!hit) return null;
    const { part, held } = drag!;
    const from = ends
      .filter((end) => end.seats.includes(hit.target))
      .map((end): WorldConnector => ({ ...connectorInWorld(end.connector, held!), type: end.connector.type, part, index: end.index }));
    const snap = findSnap(from, [hit.target], { maxDistance: Infinity, maxAngle: Math.PI });
    return snap && seatPose(snap, held!);
  }

  function showRings(ends: CarriedEnd[] | null) {
    if (!targetRings || !ends) return;
    const lit = ringsFor(ends).filter(({ strength }) => strength > 0);
    targetRings.show(lit.map(({ target, strength }) => ({ position: target.position, axis: target.axis, strength })));
  }

  // --- panel magnetism: a carried panel turns toward where it goes ---

  // The carried panel's nearest place where it goes, inside PANEL.zone centre to centre, with
  // a free end there for it to go on — of two places as near (a panel that fits either way
  // round), the lesser turn — or null, and null for anything but a carried panel. Swept once
  // per frame, for the magnetism and the rings.
  function panelGoal(): PanelGoal | null {
    if (drag?.mode !== 'move' || !drag.held || !isPanel(drag.part.type)) return null;
    const { part, held } = drag;
    const seats = seatsFor(part);
    const isTaken = occupied();
    twist.fromArray(held.rotation);
    let best: (PanelGoal & { turn: number }) | null = null;
    for (const pose of preferredFor(part)) {
      const distance = Math.hypot(...pose.position.map((v, i) => v - held.position[i]));
      if (distance >= PANEL.zone || (best && distance > best.distance + PANEL.matchTolerance)) continue;
      const turn = twist.angleTo(other.fromArray(pose.rotation));
      if (best && distance >= best.distance - PANEL.matchTolerance && turn >= best.turn) continue;
      const ends = preferredTargets(carriedConnectors(pose, isTaken), seats, PANEL);
      if (ends.length > 0) best = { pose, distance, ends, turn };
    }
    return best;
  }

  // Panel magnetism: a carried panel near where it goes, with no fit on offer, turns toward
  // it there, harder the nearer — the same law as self-aim, tuned apart (PANEL.zone/rate). It
  // only ever turns, and only ever toward where it goes: the finger keeps the position (a
  // turn that would put the panel through the floor lifts it clear, as any lift does), and
  // once a fit is on offer seat assist eases it in. Every frame — a still finger sends no
  // events, so the offer the turn brings is looked for here too.
  function aimPanel(goal: PanelGoal | null, delta: number) {
    if (!goal || drag!.snapped?.preferred) return;
    const { part, held } = drag!;
    const rotation = aimStep(drag!.rotation, goal.pose.rotation, aimWeight(goal.distance, PANEL.zone), PANEL.rate, delta);
    clampCarried(rotation);
    drag!.rotation = rotation;
    // A fit on offer that is not where it goes — one a turning panel passed on its way in (a
    // side panel's plinth holes lie beside its bottom panel's): seat assist has the pose, but
    // the turn goes on, and the offer is looked for again from where the finger puts it, so
    // where it goes takes over as soon as it is in reach. Well away from where it goes, a
    // wrong fit is all on offer, and seats.
    if (drag!.snapped) return refreshOffer(drag!.finger ?? held!.position);
    // Turned clear of the floor: the lift re-places it from the finger and looks for an offer.
    // An offer found there leaves it where it was held, so it goes to the lifted height
    // itself — never a frame through the floor — and seat assist eases it in from there.
    const { centre, halfHeight } = drag!;
    if (clampLift(drag!.height + centre[1], halfHeight, ROOM, GESTURE.ceilingMargin) - centre[1] !== drag!.height) {
      liftDrag(0, 0);
      if (!drag!.snapped) return;
      const [x, , z] = held!.position;
      drag!.held = { position: [x, drag!.height, z], rotation };
      return physics.move(part.body, drag!.held.position, rotation);
    }
    drag!.held = { position: held!.position, rotation };
    physics.move(part.body, held!.position, rotation);
    // The full fit search runs only once the turn has brought a hole within the window of an end where it goes.
    if (findSnap(carriedConnectors(drag!.held), goal.ends, PANEL)) refreshOffer(held!.position);
  }

  // Rings for a carried panel: the free ends where it goes light, brighter the nearer it is —
  // only ever where it goes, never another fit. Hardware's rings are showRings'.
  function showPanelRings(goal: PanelGoal | null) {
    if (!targetRings || drag?.mode !== 'move' || !isPanel(drag.part.type)) return;
    if (!goal) return targetRings.hide();
    const strength = aimWeight(goal.distance, PANEL.zone);
    targetRings.show(goal.ends.map(({ position, axis }) => ({ position, axis, strength })));
  }

  // Seat assist: only while a seat is on offer, the held part glides toward it.
  function assist(delta: number) {
    if (!drag?.snapped || !drag.held) return;
    drag.held = easeToward(drag.held, drag.snapped, SNAP.assistStrength, delta);
    physics.move(drag.part.body, drag.held.position, drag.held.rotation);
  }

  // Lets go of the drag; true if the part seated.
  function endDrag() {
    const { mode, part } = drag!;
    if (mode === 'crank' || mode === 'pull') {
      stopDrag();
      // A part circled all the way out was the drag's own while it turned, so it was not
      // held at its seat then (holdLooseHardware); it is now the drag is over.
      if (mode === 'crank') reconcile();
      return false;
    }
    // The seat on offer — or, for hardware let go over a lit ring, that ring's; a panel's fit
    // as it stands now.
    const offered = drag!.snapped ?? ringDrop();
    const snapped = offered?.key ? settled({ ...offered, key: offered.key }) : offered;
    // Whatever was seated on a part that just moved away drops — judged before the new seat
    // is made: a kinematic move lands on the next physics step, so until then the part reads
    // where it was, and a seat from a far ring drop would look stale.
    pruneStale();
    if (snapped?.pairs) seatFit(part, snapped, snapped.pairs);
    else if (snapped) {
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
    return !!snapped;
  }

  // A panel let go on a whole fit seats every pair of it at once — the holes of every panel it
  // carries, and the ends of the hardware it carries — and is held there as any seated part
  // is until a fastener engages; its assembly and hardware go there with it. Each pair's mover
  // is the carried panel its connector is on, or that its hardware sits in: the grabbed one's
  // own, or another of the assembly's.
  function seatFit(part: Part, snapped: Pose, pairs: FitPair<WorldConnector, WorldConnector>[]) {
    // The seats first, as the single-pair path has it: their SEAT events end the elevation
    // line's hold, so the move below lands at the seat, never at the line's height.
    for (const { hole, end } of pairs) {
      const joint = assembly.seat({ partA: hole.part.id, connectorA: hole.index, partB: end.part.id, connectorB: end.index, mover: moverOf(hole) });
      events?.emit(seatEvent(joint));
      flash(hole, end);
    }
    // One move: the physics seam takes the assembly with it.
    physics.move(part.body, snapped.position, snapped.rotation);
    placed.add(part);
    // What it seated onto stays held still with it until a fastener holds them (letGoUnder).
    if (still) stillUnder.set(part, still);
    still = null;
    // Held where it seats: its hardware goes there with it.
    drag!.held = { position: snapped.position, rotation: snapped.rotation };
    followRiders();
    // Physics follows the graph once, for every pair at once.
    reconcile();
  }

  // The carried panel `connector` is on — or, for a piece of hardware's end, the carried panel
  // that hardware sits in.
  function moverOf({ part }: WorldConnector): PartId {
    if (isPanel(part.type)) return part.id;
    const carried = new Set([drag!.part, ...drag!.carry!.riders.map((rider) => rider.part)].map((p) => p.id));
    return assembly.jointsOf(part.id).find((j) => j.hardware === part.id && carried.has(j.host))!.host;
  }

  function cancelDrag() {
    const { mode } = drag!;
    if (mode === 'move' || mode === 'compound') physics.release(drag!.part.body);
    stopDrag();
    if (mode === 'crank') reconcile();
  }

  function stopDrag() {
    holdStill(null);
    ghost?.hide();
    dropGuide?.hide();
    targetRings?.hide();
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
          decal.material.emissive.setHex(glowColor);
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
    for (const rider of drag.carry?.riders ?? []) carried.add(rider.part.id);
    raycaster.set(scratch.fromArray(from), down);
    const hit = raycaster.intersectObjects(meshes, false).find(({ object }) => !carried.has(partByMesh.get(object)!.id));
    const to: Vec3 = hit ? hit.point.toArray() : [from[0], 0, from[2]];
    dropGuide?.show(from, to);
    if (drag.snapped) {
      const { from: a, to: b } = drag.snapped.snap;
      return glow(decalOf(a) ?? decalOf(b), drag.snapped.preferred ? COLORS.whereItGoes : COLORS.decalFlash);
    }
    const under = hit && drag.mode === 'move' ? partByMesh.get(hit.object)! : null;
    const host = under && heldUp().has(under) ? null : under;
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

  // Lights one hole marking at a time, in `color` — green under a fit that is where a panel
  // goes; a hole mid-flash keeps its flash.
  function glow(decal: Decal | null, color: number = COLORS.decalFlash) {
    if (decal === glowing && color === glowColor) return;
    if (glowing && !flashes.has(glowing)) glowing.material.emissive.setHex(COLORS.unlit);
    glowing = decal;
    glowColor = color;
    if (!decal || flashes.has(decal)) return;
    decal.material.emissive.setHex(color);
    decal.material.emissiveIntensity = DROP.glowIntensity;
  }

  // --- pull: a part pushed into fastened seats comes back out along their axis ---

  function beginPull(part: Part, event: ClientPoint) {
    const joints = assembly.pullable(part.id).map((joint): Drag['joints'][number] => {
      // The part leaves along the other side's axis: out of the hole for hardware, off the
      // fastener for a panel pushed onto it — and out of the hole, its hardware with it, for a
      // panel carried in on its hardware.
      const [id, index] = joint.host !== part.id ? [joint.host, joint.hostConnector] : [joint.hardware, joint.hardwareConnector];
      const { position, axis } = connectorWorld(id, index);
      const from = screenPoint(position);
      // map keeps the length; TS widens a mapped tuple to number[].
      const to = screenPoint(position.map((v, i) => v + axis[i] * PULL_AXIS_PROBE) as Vec3);
      return { id: joint.id, axis: [to[0] - from[0], to[1] - from[1]] };
    });
    // The pull's fields only.
    drag = { mode: 'pull', part, start: [event.clientX, event.clientY], joints } as Drag;
  }

  // The pull is judged on the pointer; once free, the drag carries on from it.
  function pullTo(pointer: ClientPoint) {
    const { part, start, joints } = drag!;
    const at = [pointer.clientX, pointer.clientY];
    const pulled = joints.filter(({ id, axis }) => pullAlong(start, at, axis) >= FASTENER.pullDistance && assembly.apply(id, { type: 'pull' }));
    if (pulled.length === 0) return;
    for (const { id } of pulled) reportFastening(id, true);
    drag!.joints = joints.filter((j) => !pulled.includes(j));
    // Still pushed home somewhere: the pull goes on, as beginDrag has it.
    const carried = assembly.pullable(part.id).length > 0 ? null : carryOf(part);
    if (!carried && !assembly.canRelease(part.id)) return reconcile();
    // Pulled free: it leaves its seats and carries on as a normal drag from here — a panel
    // with everything it carries.
    if (!carried) for (const joint of assembly.jointsOf(part.id)) unseat(joint);
    reconcile();
    aim(pointer);
    const { origin, direction } = raycaster.ray;
    const grab = intersectDragPlane(origin.toArray(), direction.toArray(), part.mesh.position.y) ?? part.mesh.position.toArray();
    if (carried) {
      events?.emit(releaseEvent(part.id, 'pull'));
      beginCarry(part, carried, grab, pointer);
      events?.emit(grabEvent(part.id, 'move'));
      return;
    }
    // Telemetry: the pull ends here and a move begins, so each grab pairs with its release.
    events?.emit(releaseEvent(part.id, 'pull'));
    beginMove(part, grab, pointer, 'move');
    events?.emit(grabEvent(part.id, 'move'));
  }

  // --- crank: a drag turns what the grip's turn turns ---
  //
  // Every site below reads the graph's record of the turn (`assembly.turnOf`, `Turn`) — what
  // it turns, what visibly turns and about what, what rides along, what is loose — and none
  // works any of it out again. A drag re-reads it each move: the joints in it change as they
  // turn (a stud joins a leg's turn once the leg is home on it).

  function beginCrank(part: Part, event: ClientPoint) {
    // The crank's fields only.
    drag = { mode: 'crank', part, crank: createCrank() } as Drag;
    crankTo(event);
  }

  function crankTo(event: ClientPoint) {
    // The one part's turn, off the graph as it stands — not the whole set rebuilt each move.
    const turn = assembly.turnOf(drag!.part.id, assembly.all());
    if (!turn || turn.joints.length === 0) return;
    const centre = centreOf(turn);
    const delta = drag!.crank.move(screenPoint(centre), [event.clientX, event.clientY]);
    if (!delta) return;
    const view = scratch.fromArray(centre).sub(camera.position).toArray();
    const radians = tightenSign(axisOf(turn), view) * delta;
    turnJoints(advancing(turn, radians > 0 ? 1 : -1), () => radians);
  }

  // Joints turned together — cranked or driven, each by `radiansOf(joint)` (positive
  // tightens) — and whatever that changed reported, then reconciled once for the batch. The
  // ratchet clicks the first crossed come first, so the last click lands before it reports
  // home — by a FASTEN event, or, for one only backed off partway, by onRehome; joints turned
  // together (a top's four studs) click and buzz once, for the first of them that moved.
  function turnJoints(joints: AssemblyJoint[], radiansOf: (joint: AssemblyJoint) => number) {
    let changed = false;
    for (const joint of joints) {
      const before = assembly.get(joint.id)!.fastener;
      if (!assembly.apply(joint.id, { type: 'crank', radians: radiansOf(joint) }, crankContext(joint))) continue;
      const after = assembly.get(joint.id)!.fastener;
      const span = spanOf(joint.kind);
      const clicks = ratchetTicks(before.progress * span, after.progress * span, FASTENER.ratchetRadians);
      if (!changed && clicks > 0) onRatchet?.(clicks);
      reportFastening(joint.id, isFastened(before));
      if (!changed && isFastened(before) && !isHome(before) && isHome(after)) onRehome?.(joint.kind);
      changed = true;
    }
    if (changed) reconcile();
  }

  // --- hold-to-drive: a still press on a turn's grip drives it home ---

  // Every frame while the press is still pending: past a tap it drives, until home. A press
  // that became a drag is the crank's from then on.
  function driveHeld(delta: number) {
    if (!press) return;
    if (state.phase !== 'pending') {
      press = null;
      return;
    }
    press.ms += delta * 1000;
    if (press.ms <= GESTURE.tapMaxMs) return;
    press.held = true;
    // Tightening only, every joint of the turn still short of home: a screwed bolt backed off
    // partway drives back; a cam turned onto nothing, full, does not.
    const turn = assembly.turnOf(press.grip.id, assembly.all());
    if (turn) turnJoints(advancing(turn, 1), (joint) => driveRadians(spanOf(joint.kind), FASTENER.driveSeconds, delta));
  }

  // --- turn ring: a dial round what each turn turns ---

  // Whether a turn is a part being screwed on by hand — loose on its stud or partway, not yet
  // home: the gizmo stays off it until it is part of the built piece.
  const screwing = (turn: Turn | null | undefined) => turn?.grip.kind === 'hand' && turn.state !== 'home';

  // Whether the finger is on a turn's grip — the part's own press, cranking or still.
  const isPressed = (turn: Turn) => touching !== null && touching.id === gripOf(turn);

  // Where a turn turns, in the world: its turned connector's position — the head a tool sits
  // on, the hole a part circled by hand sits on its stud by — which the crank sweeps about
  // and the dial is centred on.
  const centreOf = ({ turned }: Turn) => connectorWorld(turned.part, turned.connector).position;

  // Which way a turn tightens, in the world: clockwise seen along this (the turned
  // connector's axis, by the turn's sense) — what the crank, the arrows and the draw share.
  const axisOf = ({ turned }: Turn): Vec3 => {
    const [x, y, z] = connectorWorld(turned.part, turned.connector).axis;
    return [x * turned.sense, y * turned.sense, z * turned.sense];
  };

  function dialOf(turn: Turn, flashing: boolean, rect: DOMRect): Dial {
    const centre = centreOf(turn);
    const view = scratch.fromArray(centre).sub(camera.position).toArray();
    return { centre: screenPoint(centre, rect), progress: turnProgress(turn), clockwise: tightensClockwise(axisOf(turn), view), flashing, stalled: isTurnStalled(turn) };
  }

  // Every frame: a dial for each turn with something to turn — one per turn, however many
  // joints it turns. One that went home since last frame flashes for TURN_RING.flashMs —
  // again after being backed off and driven back — while a tool put on a fastener already
  // home shows it full, without a flash. A tool's dial stays while it is on; a part circled by
  // hand shows its own only while the finger is on it (isDrawn).
  function showDials(delta: number, world: readonly Turn[]) {
    if (!turnRing) return;
    const rect = domElement.getBoundingClientRect();
    const seen = new Map<PartId, boolean>();
    const dials: Dial[] = [];
    for (const turn of world) {
      if (turn.joints.length === 0) continue;
      const id = gripOf(turn);
      const home = isTurnHome(turn);
      if (home && dialed.get(id) === false) dialFlashes.set(id, TURN_RING.flashMs);
      else if (!home) dialFlashes.delete(id);
      seen.set(id, home);
      if (isDrawn(turn, isPressed(turn))) dials.push(dialOf(turn, dialFlashes.has(id), rect));
    }
    for (const [id, left] of dialFlashes) {
      const remaining = left - delta * 1000;
      if (!seen.has(id) || remaining <= 0) dialFlashes.delete(id);
      else dialFlashes.set(id, remaining);
    }
    dialed = seen;
    if (dials.length > 0) turnRing.show(dials);
    else turnRing.hide();
  }

  // A screw drives into whatever lies behind its hole; a cam catches the nearest screwed
  // bolt head within reach of its recess, any bolt.
  function crankContext(joint: AssemblyJoint): ApplyContext {
    if (passesThrough(joint.kind)) return behind(joint);
    if (joint.kind !== KIND.CAM) return {};
    const recess = connectorWorld(joint.host, joint.hostConnector);
    return { captured: capture(recess, screwedHeads())?.id ?? null };
  }

  // Screwed bolts' heads where they are: the only ones a cam can catch.
  const screwedHeads = (): Head[] =>
    assembly.screwedBolts().map(({ hardware }) => ({ id: hardware, position: connectorWorld(hardware, headIndex(hardware)).position }));

  const headIndex = (id: PartId) => PART_TYPES[partById.get(id)!.type].connectors.findIndex((c) => c.type === CONNECTOR.HEX_SOCKET);

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
    const turn = assembly.turnOf(part.id);
    if (turn?.grip.kind === 'tool') return unseat(turn.grip.tool);
    // A part with a turn by hand lifts off on a tap while the turn is loose: off its
    // unfastened seats (a leg home on its stud lifts off the top with it), the unit it made
    // let go. Partway or home it comes off only by backing out — and the tap is whatever else
    // it is on the part (a dowel pushed home).
    if (turn?.state === 'loose') {
      turn.joints.filter((joint) => !isFastened(joint.fastener)).forEach(unseat);
      for (const id of turn.loose?.parts ?? []) release(partById.get(id)!);
      return reconcile();
    }
    const pressed = [...assembly.tap(part.id, behind), ...pressCarried(part)];
    for (const id of pressed) reportFastening(id, false);
    if (pressed.length > 0) return reconcile();
    // A part held at its seat is the router's: turning it would drop it off the seat.
    // A part being screwed on by hand gets no gizmo — it turns by its circle. Home, it is part
    // of the built piece, and a tap selects it as any part: the gizmo turns (flips) the whole.
    if (!placed.has(part) && !screwing(turn)) onTap?.(part);
  }

  // A panel carried in on its hardware, or with its assembly, sits in seats it touches only
  // through them (a shelf's dowels in a side panel; a carcass's in the second side panel): a
  // tap on it pushes those home too. Seats inside the assembly are its own.
  function pressCarried(part: Part) {
    if (!isPanel(part.type)) return [];
    const members = assembly.compoundOf(part.id);
    return assembly
      .all()
      .filter((j) => members.has(j.mover) && j.hardware !== part.id && j.host !== part.id && isTapKind(j.kind) && !(members.has(j.hardware) && members.has(j.host)))
      .filter((j) => assembly.apply(j.id, { type: 'tap' }, behind(j)))
      .map((j) => j.id);
  }

  // A back fitting pressed home, or a screw driven in, lands in whichever panel lies behind
  // its hole.
  function behind(joint: AssemblyJoint): ApplyContext {
    if (!passesThrough(joint.kind)) return {};
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
    carryHeld();
    followHold();
    driveHeld(delta);
    // Swept once, for the aim and the rings.
    const ends = carriedEnds();
    const goal = panelGoal();
    aimHardware(ends, delta);
    aimPanel(goal, delta);
    assist(delta);
    fadeFlashes(delta);
    guideDrop();
    showRings(ends);
    showPanelRings(goal);
    // Every turn the graph has, once per frame: the dials and the draw read the same records.
    const joints = assembly.all();
    const world = assembly.turns();
    // A part being screwed on by hand has no gizmo — selected and then set onto its stud, it
    // sheds it: it turns by its circle, and the gizmo cannot turn a seated part anyway.
    const selected = rings?.selected;
    if (selected && world.some((turn) => screwing(turn) && gripOf(turn) === selected.id)) onTap?.(null);
    showDials(delta, world);
    drawTurns(joints, world);
    followRiders();
    for (const [id, { fastener, grip }] of toolGrips) {
      hardwarePose.compose(fastener.mesh.position, fastener.mesh.quaternion, unitScale).multiply(grip);
      hardwarePose.decompose(scratch, twist, offset);
      physics.move(partById.get(id)!.body, scratch.toArray(), twist.toArray());
    }
  }

  // Fastener progress, drawn on top of the simulated poses. Each turn moves its turned part
  // (`Turn.turned`) — a turn's riders going with it, each once — and a crank joint no turn
  // has (a bolt left half in, a stud keyed partway with the key taken off) moves its hardware.
  function drawTurns(joints: readonly AssemblyJoint[], world: readonly Turn[]) {
    drawnTurning.clear();
    drawnRiding.clear();
    ridingCount = 0;
    const turned = new Set<number>();
    for (const turn of world) {
      for (const joint of turn.joints) turned.add(joint.id);
      // A part turns once a frame: the first turn of it drawn — a tool's before a hand's.
      if (turn.joints.length === 0 || drawnTurning.has(turn.turned.part)) continue;
      drawnTurning.add(turn.turned.part);
      const delta = drawTurned(turn.turned, layersOf(turn));
      for (const rider of turn.riders) {
        const entry = (riding[ridingCount++] ??= { part: null, delta: new THREE.Matrix4() });
        entry.part = partById.get(rider)!;
        entry.delta.copy(delta);
      }
    }
    // A crank joint no turn owns moves its hardware, each part once: a part a turn has drawn
    // or carries as a rider keeps that (a stud keyed into a leg rides the leg's turn, backed
    // off or not), and of a part's several such joints (a stud keyed into a leg and into the
    // top) it is drawn by the one still to go home — the others are home, and move nothing.
    const riders = new Set(world.flatMap((turn) => turn.riders));
    const ownerless = joints.filter((j) => isCrankKind(j.kind) && !turned.has(j.id) && !drawnTurning.has(j.hardware) && !riders.has(j.hardware));
    for (const joint of ownerless) {
      if (drawnTurning.has(joint.hardware)) continue;
      const own = ownerless.filter((j) => j.hardware === joint.hardware);
      const active = own.find((j) => !isHome(j.fastener)) ?? joint;
      drawnTurning.add(joint.hardware);
      drawTurned({ part: active.hardware, connector: active.hardwareConnector, sense: 1, spins: true }, [[active]]);
    }
    for (let i = 0; i < ridingCount; i++) {
      const { part, delta } = riding[i];
      const { id, body, mesh } = part!;
      if (drawnTurning.has(id) || drawnRiding.has(id)) continue;
      drawnRiding.add(id);
      const r = body.rotation();
      const t = body.translation();
      ridingPose.compose(scratch.set(t.x, t.y, t.z), twist.set(r.x, r.y, r.z, r.w), unitScale).premultiply(delta);
      ridingPose.decompose(mesh.position, mesh.quaternion, scratch);
    }
  }

  // Draws `turned.part` as far as `layers` have turned it, on top of where its body is: each
  // layer (a tool's one joint; a hand's near joints, then its far ones) by its least-advanced
  // joint — sunk along the turned connector's axis (by the turn's sense: into the hole) while
  // unfastened, its kind's depth if it sinks as it turns, and, if it spins, twisted by its
  // turn about that connector's line (a hole off the part's origin stays on its stud).
  // Returns the move made — its drawn pose over its body's — in a reused matrix, for its riders.
  function drawTurned({ part, connector, sense, spins }: Turn['turned'], layers: AssemblyJoint[][]) {
    const { mesh, body } = partById.get(part)!;
    const seat = assembly.connectorAt(part, connector);
    let sink = 0;
    let angle = 0;
    for (const layer of layers) {
      if (layer.length === 0) continue;
      const least = layer.reduce((a, b) => (b.fastener.progress < a.fastener.progress ? b : a));
      const { kind, fastener } = least;
      if (sinksAsTurned(kind) && !isFastened(fastener)) sink += FASTENER.sinkDepth[kind]! * fastener.progress;
      if (spins) angle += fastener.progress * spanOf(kind);
    }
    const axis = drawAxis.fromArray(seat.axis).multiplyScalar(sense);
    const r = body.rotation();
    const t = body.translation();
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
    mesh.position.set(t.x, t.y, t.z).add(offset.copy(axis).multiplyScalar(sink).applyQuaternion(mesh.quaternion));
    twist.setFromAxisAngle(axis, angle);
    pivot.fromArray(seat.position);
    offset.copy(pivot).sub(scratch.copy(pivot).applyQuaternion(twist)).applyQuaternion(mesh.quaternion);
    mesh.position.add(offset);
    mesh.quaternion.multiply(twist);
    drawDelta.compose(mesh.position, mesh.quaternion, unitScale);
    return drawDelta.multiply(toolPose.compose(scratch.set(t.x, t.y, t.z), twist.set(r.x, r.y, r.z, r.w), unitScale).invert());
  }

  // Hardware riding in a panel it was carried in goes where the panel goes — the drag's pose
  // while it is carried, the simulation's after — until it is pushed home and its joints
  // hold it, it leaves the panel, or it is picked up itself.
  function followRiders() {
    for (const [id, { host, hostStart, start }] of riders) {
      const part = partById.get(id)!;
      if (drag?.part === part || isBonded(part) || !assembly.jointsOf(id).some((j) => j.host === host.id)) {
        riders.delete(id);
        continue;
      }
      const pose = carryPose(hostStart, poseNow(host), start);
      physics.move(part.body, pose.position, pose.rotation);
    }
  }

  // Where `part` is now: where the drag holds it, or carries it along, else the simulation's pose.
  function poseNow(part: Part): Pose {
    if (drag?.held) {
      if (drag.part === part) return drag.held;
      const carried = drag.carry?.riders.find((rider) => rider.part === part);
      if (carried) return carryPose(drag.carry!.start, drag.held, carried.start);
    }
    return poseOf(part.id);
  }

  // --- effects from the state machine ---

  // A live drag's move or lift: the primary pointer's move, or a second finger's or the
  // wheel's lift.
  function moveDrag(effect: Extract<GestureEffect<Press>, { type: 'lift' | 'dragMove' }>, event: MouseEvent) {
    if (drag!.mode === 'crank' || drag!.mode === 'pull') {
      // Nothing to lift: the primary pointer's move is a crank or a pull.
      if (effect.type === 'lift') return;
      if (drag!.mode === 'crank') crankTo(event);
      else pullTo(event);
    } else if (effect.type === 'lift') liftDrag(effect.dy, liftRate(event));
    else updateDrag(event);
  }

  function apply(effect: GestureEffect<Press> | null, event?: MouseEvent) {
    if (!effect) return;
    if (effect.type === 'tap') {
      // A ring is for turning: a tap on a gizmo ring or a turn ring does nothing.
      if (effect.hit?.kind === 'ring' || effect.hit?.dial) return;
      if (effect.hit) tapPart(effect.hit.part);
      else onTap?.(null);
      return;
    }
    if (effect.owner === OWNER.DRAG_PART) {
      if (effect.type === 'dragStart') {
        // The part's own gesture: its press is on a part, and came with a pointer event. A
        // turn ring's is its tool's crank.
        const { part, point, dial } = effect.hit as PartPress;
        if (dial) beginCrank(part, event!);
        else beginDrag(part, point, event!);
        if (drag) events?.emit(grabEvent(drag.part.id, drag.mode));
      }
      else if (!drag) return;
      else if (effect.type === 'dragEnd') {
        const { part, mode } = drag;
        const seated = endDrag();
        events?.emit(releaseEvent(part.id, mode, { seated }));
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

  // A second finger keeps its phone rate; the wheel is the desktop's, tuned for trackpad deltas.
  const liftRate = (event: MouseEvent) => (event.type === 'wheel' ? GESTURE.desktopLiftRate : GESTURE.liftRate);

  // Capture phase, so this runs before OrbitControls' own pointerdown on the same element
  // and a part touch has already disabled the camera when OrbitControls sees it.
  function onPointerDown(event: PointerEvent) {
    const hit = state.owner === null ? hitTest(event) : null;
    const wasCamera = state.cameraEnabled;
    state.down(pointer(event, hit));
    syncCamera();
    if (wasCamera && !state.cameraEnabled) domElement.setPointerCapture(event.pointerId);
    if (hit?.kind !== 'part' || state.owner !== OWNER.DRAG_PART) return;
    // The part under the finger: a part circled by hand shows its ring while it is held.
    touching = hit.part;
    const turn = assembly.turnOf(hit.part.id);
    // A press on a seated tool, or on its ring, may turn out a hold.
    if (hit.dial || armsPress(turn)) press = { id: event.pointerId, grip: hit.part, ms: 0, held: false };
  }

  // Whether a still press on a part may drive its turn: a seated tool's with something to
  // turn; a hand turn's partway or home — loose, a long press is still a tap, to lift it off.
  const armsPress = (turn: Turn | null) =>
    turn !== null && turn.joints.length > 0 && (turn.grip.kind === 'tool' || turn.state !== 'loose');

  function onPointerMove(event: PointerEvent) {
    apply(state.move(pointer(event)), event);
  }

  // The press a pointer ends, if it was a hold: its release ends the drive, never a tap.
  function endPress(id: number) {
    if (press?.id !== id) return false;
    const { held } = press;
    press = null;
    return held;
  }

  function onPointerUp(event: PointerEvent) {
    const part = touching;
    const effect = state.up(pointer(event));
    const held = endPress(event.pointerId);
    if (!state.owner) touching = null;
    apply(held && effect?.type === 'tap' ? null : effect, event);
    // A still press on a loose part circled by hand, held past a tap and armed for nothing,
    // is still a tap: it lifts the part off — never a dead gesture.
    if (!effect && !held && part && assembly.turnOf(part.id)?.state === 'loose') tapPart(part);
    syncCamera();
  }

  // pointercancel (OS gesture, notification pull-down) and lost capture end the gesture
  // without a drop target; the state machine ignores ids it has already let go of.
  function onPointerCancel(event: PointerEvent) {
    endPress(event.pointerId);
    touching = null;
    apply(state.cancel(pointer(event)), event);
    syncCamera();
  }

  // Shift + scroll sets the held part's height, with or without a drag — through the hold,
  // the line's own path: a drag of the held part rides up with it, as any lift does.
  function liftHeld(lift: number) {
    if (holdsDrag()) return liftDrag(lift, GESTURE.desktopLiftRate);
    hold!.jump(hold!.height + lift * GESTURE.desktopLiftRate);
  }

  // Capture phase, as onPointerDown: this runs before OrbitControls' own wheel listener on
  // the same element. Shift + scroll with a part held is that part's height, and the event
  // stops here, so the camera never zooms then — the router's call at its own listener,
  // never a reach into OrbitControls. Without Shift the wheel lifts a part mid-drag
  // (OrbitControls is disabled then) and otherwise zooms as ever.
  function onWheel(event: WheelEvent) {
    const lift = shiftScroll(event);
    if (lift === null || !hold?.held) return apply(state.wheel({ dy: event.deltaY }), event);
    event.preventDefault();
    event.stopImmediatePropagation();
    liftHeld(lift);
  }

  function onInterrupted() {
    press = null;
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
  domElement.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onInterrupted);

  return {
    // The drag in progress, read-only: which part, and how it is being moved.
    get dragging() {
      return drag && { part: drag.part, mode: drag.mode };
    },
    // How far a part reaches up and down turned to `rotation`: a panel's own box, widened by
    // everything it carries on whichever side it lies — the elevation line's floor and
    // ceiling clearance.
    verticalReachOf: (part, rotation) => {
      const { centre, half } = reachOf(part, rotation);
      return { half: half[1], centre: centre[1] };
    },
    // Whether the elevation line may take up `part`, selected and sitting in a seat: a panel
    // carrying its assembly, or its hardware, that sits on nothing else.
    carries,
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
      domElement.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onInterrupted);
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
