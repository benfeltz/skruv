import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/constants.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { createAssembly, relativePose, seatHome } from '../src/game/assembly.js';
import type { PartId } from '../src/game/assembly.js';
import { ASSEMBLED, PART_TYPES, setItem } from '../src/game/item.js';
import { localTravel, worldTravel } from '../src/game/slideMath.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import type { Body, PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';
import { add, multiplyQuaternions, placeLayout, rotateVector } from '../tools/validate/lib/geometry.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// The drawer on its runners under real Rapier, on the shipped ÖVERKÄLL pack (1.9.3.3.3): every
// part at its assembled pose, bonds built as itemWorld builds them (travelOf, restOf), the
// joints joined as the router's reconcile does. Meshes are stubs. The carcass, its hardware and
// the runners are held in space and the drawer unit alone is free: the whole item creeps on the
// floor in this headless rig (even the pack as it stood before the runners), which is not what
// these tests are about. What they cannot say is how the pull feels in a hand, or the end buzz:
// those are the phone's.

const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const run = (physics: PhysicsWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
};
const TRAVEL = 0.15;
// The motor is soft for a drawer this heavy: it closes on its target over some seconds.
const SETTLE = 24;

afterEach(() => setItem('johnny'));

async function rig(open = false, backwards = false) {
  setItem('overkall');
  const physics = await createPhysicsWorld();
  const posed = placeLayout(ASSEMBLED.parts, { position: [0, 0, 0], rotation: [0, 0, 0, 1] });
  const typeById = new Map(posed.map((p) => [p.id, p.type]));
  const assembledById = new Map(ASSEMBLED.parts.map((p) => [p.id, p]));
  const travelById = new Map<PartId, Vec3>();
  for (const part of ASSEMBLED.parts) {
    const travel = localTravel(part);
    if (travel) travelById.set(part.id, travel);
  }
  const restOf = (hardware: PartId, host: PartId) => {
    const [h, o] = [assembledById.get(hardware), assembledById.get(host)];
    return h && o ? relativePose(o, h).rotation : null;
  };
  const assembly = createAssembly((id) => typeById.get(id)!, (id) => travelById.get(id) ?? null, restOf);
  // A drawer put in backwards has each groove on the runner it now faces: the other side's.
  const swapped = (id: string) => (backwards ? { 'runner-1': 'runner-2', 'runner-2': 'runner-1' }[id] ?? id : id);
  seatHome(
    assembly,
    ASSEMBLED.joints.map((j) => ({ partA: j.kind === KIND.SLIDE ? swapped(j.hardware) : j.hardware, connectorA: j.hardwareConnector, partB: j.host, connectorB: j.hostConnector, mover: j.mover, ctx: { through: j.through, captured: j.captured } })),
  );
  // The drawer unit moves out along the travel, all of it: the sides' open poses, the rest with them.
  const unit = assembly.slideOf('drawerFront-1')!.unit;
  const shift = (id: string): Vec3 => (open && unit.has(id) ? worldTravel(assembledById.get('drawerSide-2')!)! : [0, 0, 0]);
  // Backwards: the drawer unit turned half a turn about the cavity's vertical axis, front into the cavity.
  const HALF_TURN_Y: Quat = [0, 1, 0, 0];
  const placed = new Map(
    posed.map(({ id, position, rotation }): [string, Pose] => {
      const turned = backwards && unit.has(id);
      return [id, { position: add(turned ? rotateVector(HALF_TURN_Y, position) : position, shift(id)), rotation: turned ? multiplyQuaternions(HALF_TURN_Y, rotation) : rotation }];
    }),
  );
  const bodies = new Map(
    posed.map(({ id, type }) => {
      const part = PART_TYPES[type];
      const { position, rotation } = placed.get(id)!;
      const body = physics.register(stubMesh(), { halfExtents: part.size.map((d) => d / 2) as Vec3, mass: part.mass!, position, rotation });
      // The carcass, its hardware and the runners are held in space, as the rails rig holds its runners: the drawer unit alone is free.
      if (!unit.has(id)) physics.grab(body);
      return [id, body] as const;
    }),
  );
  const closed = new Map(posed.map(({ id, position, rotation }) => [id, backwards ? placed.get(id)! : ({ position, rotation } as Pose)]));
  const bonds = assembly.bonds((id) => closed.get(id)!);
  const joints = new Map<string, PhysicsJoint>(bonds.map((bond) => [bond.key, physics.join(bodies.get(bond.a)!, bodies.get(bond.b)!, bond.frame, bond.mode, bond.slide)]));
  const slides = bonds.filter((bond) => bond.mode === 'slide');
  const front = bodies.get('drawerFront-1')!;
  const start = (id: string): Vec3 => (backwards ? placed.get(id)!.position : add(closed.get(id)!.position, shift(id)));
  const moved = (id: string, body: Body = bodies.get(id)!): Vec3 => {
    const t = body.translation();
    const [x, y, z] = start(id);
    return [t.x - x, t.y - y, t.z - z];
  };
  const pull = (target: number | null) => {
    for (const bond of slides) physics.slide(joints.get(bond.key)!, target);
  };
  return { physics, assembly, bodies, bonds, slides, front, moved, pull, start, unit };
}

describe('the ÖVERKÄLL drawer on its runners', () => {
  it('stands: every part within 2 mm of its assembled pose, on two slide bonds along +z', async () => {
    const { physics, bodies, slides, moved } = await rig();
    expect(slides).toHaveLength(2);
    const sides = new Map(ASSEMBLED.parts.map((p) => [p.id, p]));
    for (const bond of slides) {
      expect(bond.slide!.travel).toBeCloseTo(TRAVEL, 9);
      // The bond's axis is in the side's own frame; turned out to the world it is the front, +z, for both sides.
      const world = rotateVector(sides.get(bond.a)!.rotation, bond.slide!.axis);
      expect(world.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 1]);
      expect(rotateVector(sides.get(bond.a)!.rotation, localTravel(sides.get(bond.a)!)!)).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(TRAVEL, 9)]);
    }
    run(physics, 5);
    for (const id of bodies.keys()) expect(Math.hypot(...moved(id)), id).toBeLessThan(0.002);
  });

  it('pulls open along the front on both runners with the carcass where it was', async () => {
    const { physics, pull, moved, unit } = await rig();
    pull(0.1);
    run(physics, SETTLE);
    // The soft motor leaves a few mm of friction's worth short of the target; both ends of the drawer are as far.
    expect(Math.abs(moved('drawerFront-1')[2] - 0.1)).toBeLessThan(0.006);
    expect(Math.abs(moved('drawerBack-1')[2] - moved('drawerFront-1')[2])).toBeLessThan(0.001);
    expect(unit.has('drawerSide-1') && unit.has('drawerSide-2')).toBe(true);
    for (const id of ['sidePanel-1', 'sidePanel-2', 'runner-1', 'runner-2', 'topBottomPanel-1']) expect(Math.hypot(...moved(id)), id).toBeLessThan(0.001);
  });

  it('stops at the open limit however far it is told', async () => {
    const { physics, pull, moved } = await rig();
    pull(0.5);
    for (let i = 0; i < SETTLE * 4; i++) {
      run(physics, 0.25);
      expect(moved('drawerFront-1')[2]).toBeLessThan(TRAVEL + 0.003);
    }
    // Never past the limit, and within a centimetre of it: the soft motor is still closing on it.
    expect(Math.abs(moved('drawerFront-1')[2] - TRAVEL)).toBeLessThan(0.01);
  });

  it('stays where it is left once let go, and stops at closed', async () => {
    const { physics, pull, moved } = await rig();
    pull(0.08);
    run(physics, 2);
    const left = moved('drawerFront-1')[2];
    pull(null);
    run(physics, 3);
    expect(Math.abs(moved('drawerFront-1')[2] - left)).toBeLessThan(0.003);
    pull(-0.5);
    run(physics, SETTLE);
    // Never through closed, and within a centimetre of it.
    expect(moved('drawerFront-1')[2]).toBeGreaterThan(-0.003);
    expect(moved('drawerFront-1')[2]).toBeLessThan(0.01);
  });

  it('restores open: the drawer unit placed at its open poses settles into its limit, no part moves more than 3 mm', async () => {
    const { physics, bodies, moved } = await rig(true);
    run(physics, 6);
    for (const id of bodies.keys()) expect(Math.hypot(...moved(id)), id).toBeLessThan(0.003);
  });
});

describe('a drawer put in backwards', () => {
  it('stays where it is put: not squared by a half-turn correction, not flung across the room', async () => {
    const { physics, bodies, moved } = await rig(false, true);
    run(physics, 2);
    // Seated on the opposite runners, front into the cavity: it is off by at most the groove's offset along the rails.
    for (const id of ['drawerFront-1', 'drawerBack-1', 'drawerBottom-1', 'knob-1']) expect(Math.hypot(...moved(id, bodies.get(id)!)), id).toBeLessThan(0.05);
  });
});

describe('the drawer as a slide unit', () => {
  it('is the six drawer parts, fourteen dowels and fifteen screws, hosted by a drawer side; the runners and carcass are not', async () => {
    const { assembly, unit } = await rig();
    const slide = assembly.slideOf('drawerFront-1')!;
    expect(slide.joints).toHaveLength(2);
    expect(slide.joints.every((j) => j.host.startsWith('drawerSide-'))).toBe(true);
    expect(unit.size).toBe(6 + 14 + 15);
    expect(assembly.slideOf('runner-1')).toBeNull();
    expect(assembly.slideOf('sidePanel-1')).toBeNull();
  });
});
