// Test plan (1.8.3.1, phone round 3): every JOHNNY panel that meets a side panel — the plinth,
// the bottom, the fixed shelf and the top — carried in with the dowels the booklet's step 1
// puts in it, onto a side panel standing as the finished JOHNNY has it. Built from the
// assembled item itself, so each case is the real geometry: where it goes is offered green,
// and release seats every dowel it shares with the side panel, squarely.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { GESTURE } from '../src/constants.js';
import { createAssembly } from '../src/game/assembly.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { createBus, EVENT } from '../src/game/events.js';
import { preferredRelatives } from '../src/game/panelFit.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';
import { createGestureRouter } from '../src/scene/gestureRouter.js';
import type { StampedEvent } from '../src/game/events.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

const SIZE = 1000;
type Listener = (event: object) => void;

const quiet = { addEventListener() {}, removeEventListener() {} };
beforeEach(() => {
  vi.stubGlobal('window', quiet);
  vi.stubGlobal('document', { ...quiet, visibilityState: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

// A part whose body reports its mesh's pose; moves land on the mesh, as a step would.
function makePart(id: string, type: string, { position, rotation }: Pose): Part {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...PART_TYPES[type].size));
  mesh.position.set(...position);
  mesh.quaternion.set(...rotation);
  mesh.updateMatrixWorld(true);
  const body = {
    id,
    isKinematic: () => true,
    translation: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
    rotation: () => ({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }),
  };
  // A fake: a plain-material mesh and a body that only reports its pose.
  return { id, type, mesh, body } as unknown as Part;
}

const SIDE = 'sidePanel-1';
const byId = new Map(ASSEMBLED.parts.map((part) => [part.id, part]));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angleBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const holeAt = (id: string, index: number) => connectorInWorld(PART_TYPES[byId.get(id)!.type].connectors[index], byId.get(id)!);

// The dowels `panel` shares with the side panel in the finished JOHNNY: each dowel, its hole
// in the panel, and its hole in the side panel.
function shared(panel: string) {
  return ASSEMBLED.joints
    .filter((j) => j.host === panel)
    .flatMap((inPanel) => {
      const inSide = ASSEMBLED.joints.find((j) => j.hardware === inPanel.hardware && j.host === SIDE);
      return inSide ? [{ dowel: inPanel.hardware, panelHole: inPanel.hostConnector, sideHole: inSide.hostConnector }] : [];
    });
}

function harness(panel: string) {
  const sink = CONTRACT.sinkDepth.dowel!;
  const dowels = shared(panel);
  // Out of the side panel's holes: each dowel seated only at its panel hole's mouth stands a
  // sink further toward the side panel, so where the panel seats on them is two sinks out.
  const out = holeAt(SIDE, dowels[0].sideHole).axis;
  const seat: Pose = { ...byId.get(panel)!, position: add(byId.get(panel)!.position, scale(out, 2 * sink)) };
  // Picked up a little off its seat: further out, higher, and a hover lower (pick-up lifts it).
  const shift = add(scale(out, 2 * sink + 0.03), [0, 0.02 - GESTURE.hoverLift, 0.01]);
  const at = (pose: Pose, by: Vec3): Pose => ({ position: add(pose.position, by), rotation: pose.rotation });

  const parts = [
    makePart(SIDE, 'sidePanel', byId.get(SIDE)!),
    makePart(panel, byId.get(panel)!.type, at(byId.get(panel)!, shift)),
    ...dowels.map(({ dowel, panelHole }) => {
      const mouth = scale(holeAt(panel, panelHole).axis, sink);
      return makePart(dowel, 'dowel', at(byId.get(dowel)!, add(mouth, shift)));
    }),
  ];
  const [side, carried] = parts;
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  for (const { dowel, panelHole } of dowels) assembly.seat({ partA: dowel, connectorA: 0, partB: panel, connectorB: panelHole, mover: dowel });

  const simulation = {
    grab: () => {},
    move: (body: Body, position: Vec3, rotation?: Quat) => {
      const { mesh } = parts.find((part) => part.body === body)!;
      mesh.position.set(...position);
      if (rotation) mesh.quaternion.set(...rotation);
      mesh.updateMatrixWorld(true);
    },
    release: () => {},
    join: () => ({}) as PhysicsJoint, // a fake joint: the router only hands it back to unjoin
    unjoin: () => {},
  };
  // A fastened compound moves as one, as main.ts wires it. A fake: the seam only calls what the router does.
  const physics = createCompoundPhysics(simulation as unknown as PhysicsWorld, parts, assembly);
  const offers: StampedEvent[] = [];
  const events = createBus();
  events.on(EVENT.SNAP_CANDIDATE, (event) => offers.push(event));
  const ghosts: boolean[] = [];

  // Looking at the panel from in front, above and to its right.
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  const look = carried.mesh.position;
  camera.position.set(look.x + 0.4, look.y + 0.7, look.z + 1.3);
  camera.lookAt(look);
  camera.updateMatrixWorld(true);
  const listeners = new Map<string, Listener>();
  const canvas = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE }),
    setPointerCapture() {},
  };
  const fire = (type: string, init: object) => listeners.get(type)?.({ type, pointerId: 1, button: 0, timeStamp: 0, ...init });
  const router = createGestureRouter({
    domElement: canvas as unknown as HTMLElement, // a fake: listeners and a bounding rect only
    camera,
    cameraControls: { enable() {}, disable() {} },
    physics,
    parts,
    assembly,
    events,
    ghost: { show: (_mesh, _pose, whereItGoes = false) => ghosts.push(whereItGoes), hide() {} },
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
  });
  router.sync();
  // Pressed on the panel, nudged past a tap, and let go.
  function carry() {
    const v = carried.mesh.position.clone().project(camera);
    const press = { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
    fire('pointerdown', press);
    fire('pointermove', { clientX: press.clientX, clientY: press.clientY + 6 });
    const to = { clientX: press.clientX, clientY: press.clientY + 12 };
    fire('pointermove', to);
    expect(router.dragging).toEqual({ part: carried, mode: 'move' });
    const offer = offers.filter((e) => e.part === panel).at(-1)?.target ?? null;
    const green = ghosts.at(-1) ?? null;
    fire('pointerup', to);
    return { offer, green };
  }
  return { assembly, side, carried, dowels, seat, carry };
}

describe('every JOHNNY panel goes on a side panel carrying its dowels (1.8.3.1 test plan)', () => {
  it.each(['plinth-1', 'topBottomPanel-1', 'fixedShelf-1', 'topBottomPanel-2'])('%s: offered where it goes, green, and seated on every dowel it shares', (panel) => {
    const h = harness(panel);
    expect(h.dowels.length).toBeGreaterThan(0);
    const { offer, green } = h.carry();
    expect(offer).toBe(SIDE);
    expect(green).toBe(true);
    const onSide = h.assembly.all().filter((j) => j.host === SIDE);
    expect(onSide.map((j) => [j.hardware, j.hostConnector]).sort()).toEqual(h.dowels.map((d) => [d.dowel, d.sideHole]).sort());
    for (const joint of onSide) expect(joint.mover).toBe(panel);
    // Squarely where it goes, out by the dowels standing proud of both panels.
    expect(gap(h.carried.mesh.position.toArray(), h.seat.position)).toBeLessThan(1e-6);
    expect(angleBetween(h.carried.mesh.quaternion.toArray(), h.seat.rotation)).toBeLessThan(1e-6);
  });
});
