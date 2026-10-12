// Phone finding 1 on 1.8.3.4 (Ben, 2026-10-11): putting side panel 2 on the half-built
// carcass, "all the magnetism fights each other" — the carried panel vibrates near the
// carcass and never settles. Reproduced here under real Rapier, the real router, the real
// elevation line and the real compound seam, stepped in main.ts's frame order: with the line
// holding the panel, or the finger trembling a couple of pixels as a thumb on glass does,
// every pointer move re-solved the fit against a carcass the kinematic panel was nudging,
// and the offer flipped frame to frame. A fit on offer now holds (panelFit.ts `heldOffer`).
// Both ways round: side panel 2 carried onto the carcass, and the carcass onto side panel 2.
// How it feels on a phone stays the manual check.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, placeLayout, rotateVector } from '../tools/validate/lib/geometry.js';
import { GESTURE, PANEL } from '../src/constants.js';
import { createAssembly, seatHome } from '../src/game/assembly.js';
import { isFastened } from '../src/game/fasteners.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import { createLiftHold } from '../src/scene/liftHold.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The router listens on window and document; Rapier's step must run without those stubs, so
// they stand in only while the router is made.
const quiet = { addEventListener() {}, removeEventListener() {} };
afterEach(() => vi.unstubAllGlobals());

const SIZE = 1000;
const FRAME = 1 / 60;
const DEG = Math.PI / 180;
const SIDE_2 = 'sidePanel-2';
const SHELF = 'fixedShelf-1';
// The half-built carcass: side panel 1, the four horizontals, all fourteen dowels, side panel
// 1's cam bolts and the cams locked on them (booklet step 5).
const CARCASS = ['sidePanel-1', 'plinth-1', 'topBottomPanel-1', SHELF, 'topBottomPanel-2', ...Array.from({ length: 14 }, (_, n) => `dowel-${n + 1}`), 'camLockBolt-1', 'camLockBolt-2', 'camLockBolt-3', 'camLockBolt-4', 'camLock-2', 'camLock-3', 'camLock-4', 'camLock-7'];
const INTO_SIDE_2 = ASSEMBLED.joints.filter((j) => j.host === SIDE_2 && j.kind === KIND.DOWEL).map((j) => j.hardware);
const laid = (on: Pose) => new Map(placeLayout(ASSEMBLED.parts, on).map((part) => [part.id, part]));
// The finished JOHNNY on its left side (side panel 1 flat on the floor, side panel 2 on top
// where it goes), and on its right side (side panel 2 flat on the floor).
const ON_LEFT = laid({ position: [1.01, 0.4, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
const ON_RIGHT = laid({ position: [-1.01, 0.4, 0], rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] });

const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// A dowel end sitting on its hole as a fit seats it: within PANEL.matchTolerance across the
// hole's axis and PANEL.seatSlack along it, axis against axis within PANEL.matchAngle.
function onHole(end: { position: Vec3; axis: Vec3 }, hole: { position: Vec3; axis: Vec3 }) {
  const offset = end.position.map((v, i) => v - hole.position[i]) as Vec3;
  const along = dot(offset, hole.axis);
  const across = gap(offset, hole.axis.map((v) => v * along) as Vec3);
  return across <= PANEL.matchTolerance && Math.abs(along) <= PANEL.seatSlack && Math.acos(Math.min(1, -dot(end.axis, hole.axis))) <= PANEL.matchAngle;
}

// A pose where it goes, turned `angle` about unit `axis` through `centre`, moved by `shift`,
// and lowered by the pick-up's hover, so the drag lifts it back.
function startOf(angle: number, axis: Vec3, centre: Vec3, shift: Vec3) {
  const s = Math.sin(angle / 2);
  const turn: Quat = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  return ({ position, rotation }: Pose): Pose => ({
    position: rotateVector(turn, position.map((v, i) => v - centre[i]) as Vec3).map((v, i) => v + centre[i] + shift[i] - (i === 1 ? GESTURE.hoverLift : 0)) as Vec3,
    rotation: multiplyQuaternions(turn, rotation),
  });
}

interface Approach {
  layout: Map<string, Pose & { type: string }>;
  // The parts carried, started off where they go by `start`; the one grabbed, and where on it.
  carried: readonly string[];
  grabbed: string;
  face: Vec3;
  start: (pose: Pose) => Pose;
  eye: Vec3;
  look: Vec3;
  // Carcass dowels seated in their horizontal but not yet pushed home.
  loose?: readonly string[];
}

// Side panel 2 carried onto the carcass, grabbed on its outer face; or the carcass carried
// onto side panel 2, grabbed by the fixed shelf.
const sideOn = (angle: number, axis: Vec3, shift: Vec3): Approach => ({
  layout: ON_LEFT,
  carried: [SIDE_2],
  grabbed: SIDE_2,
  face: [-PART_TYPES.sidePanel.size[0] / 2, 0.3, 0.05],
  start: startOf(angle, axis, ON_LEFT.get(SIDE_2)!.position, shift),
  eye: [0.6, 1.8, 1.6],
  look: [0, 0.6, 0],
});
const carcassOn = (angle: number, axis: Vec3, shift: Vec3): Approach => ({
  layout: ON_RIGHT,
  carried: CARCASS,
  grabbed: SHELF,
  face: [0.1, PART_TYPES.fixedShelf.size[1] / 2, 0.05],
  start: startOf(angle, axis, ON_RIGHT.get(SHELF)!.position, shift),
  eye: [0.8, 0.45, 1.5],
  look: [0, 0.4, 0],
});

async function harness({ layout, carried, grabbed, face, start, eye, look, loose = [] }: Approach) {
  const physics = await createPhysicsWorld();
  const parts: Part[] = [SIDE_2, ...CARCASS].map((id) => {
    const { type } = layout.get(id)!;
    const pose = carried.includes(id) ? start(layout.get(id)!) : layout.get(id)!;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
    const body = physics.register(mesh, { halfExtents: PART_TYPES[type].size.map((d) => d / 2) as Vec3, mass: PART_TYPES[type].mass!, ...pose });
    mesh.updateMatrixWorld(true);
    return { id, type, mesh, body } as unknown as Part;
  });
  const byId = (id: string) => parts.find((part) => part.id === id)!;
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  const inCarcass = new Set(CARCASS);
  const pairs = ASSEMBLED.joints
    .filter((j) => inCarcass.has(j.hardware) && inCarcass.has(j.host))
    .map((j) => ({ partA: j.hardware, connectorA: j.hardwareConnector, partB: j.host, connectorB: j.hostConnector, mover: j.mover, ctx: { through: j.through, captured: j.captured } }));
  seatHome(assembly, pairs.filter((p) => !loose.includes(p.partA)));
  // Only seated, it sits at its hole's mouth: the router's first reconcile holds it there.
  for (const pair of pairs.filter((p) => loose.includes(p.partA))) assembly.seat(pair);
  // As main.ts wires them: the hold over the compound seam, a seat by the held assembly ending the hold.
  const line = createLiftHold(createCompoundPhysics(physics, parts, assembly));
  const offers: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  events.on(EVENT.SEAT, ({ joint }) => {
    const mover = typeof joint === 'number' ? assembly.get(joint)?.mover : undefined;
    if (line.held && mover && assembly.compoundOf(line.held.id).has(mover)) line.end();
  });
  const ghosts: boolean[] = [];
  const listeners = new Map<string, (event: object) => void>();
  const canvas = {
    addEventListener: (type: string, fn: (event: object) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE }),
    setPointerCapture() {},
  };
  const fire = (type: string, init: object) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...init });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(...eye);
  camera.lookAt(...look);
  camera.updateMatrixWorld(true);
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics: line,
    parts,
    assembly,
    events,
    hold: line,
    ghost: { show: (_mesh, _pose, whereItGoes = false) => ghosts.push(whereItGoes), hide() {} },
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  vi.unstubAllGlobals();
  router.sync();
  line.measure(router.verticalReachOf);

  const part = byId(grabbed);
  const v = new THREE.Vector3(...connectorInWorld({ position: face, axis: [0, 1, 0] }, start(layout.get(grabbed)!)).position).project(camera);
  const press = { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  fire('pointerdown', press);
  fire('pointermove', { clientX: press.clientX, clientY: press.clientY + 6 });
  const held = { clientX: press.clientX, clientY: press.clientY + 12 };
  fire('pointermove', held);
  const poseOf = ({ body }: Part): Pose => {
    const t = body.translation();
    const r = body.rotation();
    return { position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w] };
  };
  // A frame as main.ts runs one — the hold eases, physics steps, the router follows (meshes'
  // matrices kept current for the next press) — the finger trembling if told to.
  function frame(n: number, tremble: boolean) {
    if (tremble) fire('pointermove', { clientX: held.clientX + Math.round(2 * Math.sin(n * 1.7)), clientY: held.clientY + Math.round(2 * Math.cos(n * 2.3)) });
    line.update(FRAME);
    physics.step(FRAME);
    for (const p of parts) p.mesh.updateMatrixWorld(true);
    router.update(FRAME);
  }
  // Each seat into side panel 2 whose dowel end has come off its hole, as the fit judges it.
  function offHoles() {
    const world = (id: string, index: number) => connectorInWorld(PART_TYPES[byId(id).type].connectors[index], poseOf(byId(id)));
    return assembly
      .all()
      .filter((j) => j.host === SIDE_2 && !onHole(world(j.hardware, j.hardwareConnector), world(j.host, j.hostConnector)))
      .map((j) => j.hardware);
  }
  // A tap on the grabbed part where it lies now: the player pushing the seats home.
  function tap() {
    const at = new THREE.Vector3(...connectorInWorld({ position: face, axis: [0, 1, 0] }, poseOf(part)).position).project(camera);
    const point = { clientX: ((at.x + 1) / 2) * SIZE, clientY: ((1 - at.y) / 2) * SIZE };
    fire('pointerdown', point);
    fire('pointerup', point);
  }
  return { router, assembly, line, part, byId, offers, ghosts, frame, poseOf, offHoles, tap, release: () => fire('pointerup', held) };
}

// End first, as a 2 m panel is lowered: hinged about a point near one of its ends.
const sideEndFirst = (angle: number, axis: Vec3, shift: Vec3): Approach => {
  const side = ON_LEFT.get(SIDE_2)!;
  const hinge = connectorInWorld({ position: [0, -0.9, 0], axis: [0, 1, 0] }, side).position;
  return { ...sideOn(angle, axis, shift), start: startOf(angle, axis, hinge, shift) };
};

const APPROACHES: [string, Approach][] = [
  ['side panel 2 turned 10° about the vertical', sideOn(10 * DEG, [0, 1, 0], [0.03, 0.04, 0.02])],
  ['side panel 2 turned 10° about the vertical, off to one side', sideOn(10 * DEG, [0, 1, 0], [-0.06, 0.08, 0.05])],
  ['side panel 2 tipped 30° along its length', sideOn(30 * DEG, [1, 0, 0], [0.03, 0.04, 0.02])],
  ['side panel 2 tipped 30° across it', sideOn(30 * DEG, [0, 0, 1], [-0.06, 0.08, 0.05])],
  ['side panel 2 turned 50° about the vertical', sideOn(50 * DEG, [0, 1, 0], [0.03, 0.04, 0.02])],
  ['side panel 2 lowered end first, hinged 15°', sideEndFirst(15 * DEG, [0, 0, 1], [0.03, 0.04, 0.02])],
  // Fable re-review: a dowel in the carcass seated, not pushed home, must not leave it rocking.
  ['side panel 2 tipped 30° across it, one carcass dowel not yet pushed home', { ...sideOn(30 * DEG, [0, 0, 1], [-0.06, 0.08, 0.05]), loose: ['dowel-9'] }],
  ['side panel 2 turned 10° about the vertical, one carcass dowel not yet pushed home', { ...sideOn(10 * DEG, [0, 1, 0], [0.03, 0.04, 0.02]), loose: ['dowel-9'] }],
  ['the carcass turned 12° onto side panel 2', carcassOn(12 * DEG, [0, 1, 0], [0.02, 0.03, -0.015])],
];
// Each approach on the line with the finger trembling, trembling alone, and on the line alone.
const WAYS = APPROACHES.flatMap(([name, approach]) => [
  [`${name}, on the line, the finger trembling`, approach, true, true] as const,
  [`${name}, the finger trembling`, approach, false, true] as const,
  [`${name}, on the line`, approach, true, false] as const,
]);

// Held still with the finger, frame after frame: the offers seen in the last two seconds, how
// far the carried part moved in them, and whether the fit on offer at the end is where it goes.
async function holdStillNear(approach: Approach, onLine: boolean, tremble: boolean) {
  const h = await harness(approach);
  expect(h.router.dragging).toEqual({ part: h.part, mode: 'move' });
  if (onLine) h.line.begin(h.part, 'line');
  let last = h.poseOf(h.part);
  let drift = 0;
  let offersAt = 0;
  for (let n = 0; n < 360; n++) {
    h.frame(n, tremble);
    const now = h.poseOf(h.part);
    if (n === 240) offersAt = h.offers.length;
    if (n > 240) drift += gap(now.position, last.position);
    last = now;
  }
  return { h, lateOffers: h.offers.length - offersAt, drift, green: h.ghosts.at(-1) };
}

describe('side panel 2 and the carcass settle together (1.8.3.4 phone finding 1)', () => {
  it.each(WAYS)('%s: one fit wins and stays won, every dowel seats on its hole, and a tap pushes them home', async (_, approach, onLine, tremble) => {
    const { h, lateOffers, drift, green } = await holdStillNear(approach, onLine, tremble);
    // The last two seconds: still, one offer, and it is where it goes.
    expect(lateOffers).toBe(0);
    expect(drift).toBeLessThan(1e-4);
    expect(green).toBe(true);
    h.release();
    const seated = h.assembly.all().filter((j) => j.host === SIDE_2).map((j) => j.hardware);
    expect(new Set(seated)).toEqual(new Set(INTO_SIDE_2));
    // Seated where everything stands, not where the fit was first found: once the move lands,
    // every dowel end is on its hole. (Pushed home, the dowel stage's angular play lets the
    // carcass sag a few degrees until its cams lock — the physics' own design, not judged here.)
    h.frame(0, false);
    expect(h.offHoles()).toEqual([]);
    // The player's next move, a moment later: a tap pushes them all home — none dropped as
    // stale while the carcass, handed back to the simulation, sagged in the meantime.
    for (let n = 0; n < 60; n++) h.frame(n, false);
    h.tap();
    expect(h.assembly.all().filter((j) => j.host === SIDE_2)).toHaveLength(INTO_SIDE_2.length);
    for (const joint of h.assembly.all().filter((j) => j.host === SIDE_2)) expect(isFastened(joint.fastener), joint.hardware).toBe(true);
  });

  // Lowered end first and hinged 25°, where it goes is out of reach of a still finger: a fit
  // that is not is all on offer, and it holds — amber, settled, never flipping.
  it.each([
    ['on the line, the finger trembling', true, true],
    ['the finger trembling', false, true],
    ['on the line', true, false],
  ] as const)('side panel 2 lowered end first, hinged 25°, %s: settles on one fit', async (_, onLine, tremble) => {
    const { lateOffers, drift } = await holdStillNear(sideEndFirst(25 * DEG, [0, 0, 1], [0.03, 0.04, 0.02]), onLine, tremble);
    expect(lateOffers).toBe(0);
    expect(drift).toBeLessThan(1e-4);
  });
});
