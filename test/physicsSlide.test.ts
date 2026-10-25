import { describe, expect, it, vi } from 'vitest';
import { PHYSICS } from '../src/constants.js';
import { createAssembly, relativePose } from '../src/game/assembly.js';
import { PART_TYPES } from '../src/game/item.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import { PLATE_GROOVE_L, PLATE_GROOVE_R, RAIL_TRAVEL, RUNNER_END, railsLayout } from './support/railParts.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';
import type { PhysicsJoint, PhysicsWorld } from '../src/physics/world.js';

vi.mock('../src/game/item.js', async (original) => (await import('./support/railParts.js')).withRails(await original()));

// The prismatic slide under real Rapier (1.9.3.3.2): two fixed runners stand in for the
// carcass and a plate hangs between them on their rails. Meshes are stubs.
const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const run = (physics: PhysicsWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
};
const typeOf = (id: string) => id.replace(/-\d+$/, '');
const HEIGHT = 0.6;

/** Both runners fixed in space, the plate between them with `open` metres of its travel run out, and the two slide joints. */
async function rig(open = 0, tilt = 0) {
  const physics = await createPhysicsWorld();
  const layout = railsLayout();
  const bodies = new Map(
    layout.map(({ id, position, rotation }) => {
      const at: Vec3 = [position[0], HEIGHT, position[2] + (id === 'plate-1' ? open : 0)];
      const size = PART_TYPES[typeOf(id)].size;
      // A tilted plate is turned about the grooves' axis (x), the twist a seat would otherwise keep.
      const turned: Quat = id === 'plate-1' && tilt ? [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)] : rotation;
      const body = physics.register(stubMesh(), { halfExtents: size.map((d) => d / 2) as Vec3, mass: PART_TYPES[typeOf(id)].mass ?? 1, position: at, rotation: turned });
      if (id !== 'plate-1') physics.grab(body);
      return [id, body] as const;
    }),
  );
  const square = new Map(layout.map(({ id, position, rotation }) => [id, { position, rotation } as Pose]));
  const restOf = (hardware: string, host: string) => relativePose(square.get(host)!, square.get(hardware)!).rotation;
  const assembly = createAssembly(typeOf, (part) => (part === 'plate-1' ? [0, 0, RAIL_TRAVEL] : null), restOf);
  assembly.seat({ partA: 'runner-1', connectorA: RUNNER_END, partB: 'plate-1', connectorB: PLATE_GROOVE_L, mover: 'plate-1' });
  assembly.seat({ partA: 'runner-2', connectorA: RUNNER_END, partB: 'plate-1', connectorB: PLATE_GROOVE_R, mover: 'plate-1' });
  // The bond frames are taken from the plate at its closed pose, as the router's reconcile does on seat.
  const closed = new Map(square);
  if (tilt) closed.set('plate-1', { ...square.get('plate-1')!, rotation: [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)] });
  const joints: PhysicsJoint[] = assembly.bonds((id) => closed.get(id)!).map((bond) => physics.join(bodies.get(bond.a)!, bodies.get(bond.b)!, bond.frame, bond.mode, bond.slide));
  const plate = bodies.get('plate-1')!;
  const start = plate.translation();
  const z = () => plate.translation().z - start.z + open;
  return { physics, plate, joints, start, z };
}

describe('a plate on two rails under physics', () => {
  it('stays where it is put', async () => {
    const { physics, plate, start } = await rig();
    run(physics, 5);
    const t = plate.translation();
    expect(Math.hypot(t.x - start.x, t.y - start.y, t.z - start.z)).toBeLessThan(0.001);
  });

  it('is driven to a position along the travel and nowhere else', async () => {
    const { physics, plate, joints, start, z } = await rig();
    for (const j of joints) physics.slide(j, 0.05);
    run(physics, 2);
    expect(Math.abs(z() - 0.05)).toBeLessThan(0.003);
    const t = plate.translation();
    expect(Math.abs(t.x - start.x)).toBeLessThan(0.001);
    expect(Math.abs(t.y - start.y)).toBeLessThan(0.001);
  });

  it('stops at the open limit however far it is told', async () => {
    const { physics, joints, z } = await rig();
    for (const j of joints) physics.slide(j, 0.5);
    for (let i = 0; i < 8; i++) {
      run(physics, 0.25);
      expect(z()).toBeLessThan(RAIL_TRAVEL + 0.003);
    }
    expect(Math.abs(z() - RAIL_TRAVEL)).toBeLessThan(0.003);
  });

  it('stops at the closed limit too', async () => {
    const { physics, joints, z } = await rig();
    for (const j of joints) physics.slide(j, -0.5);
    run(physics, 2);
    expect(Math.abs(z())).toBeLessThan(0.003);
  });

  it('stays where it is left once let go', async () => {
    const { physics, joints, z } = await rig();
    for (const j of joints) physics.slide(j, 0.05);
    run(physics, 2);
    const left = z();
    for (const j of joints) physics.slide(j, null);
    run(physics, 3);
    expect(Math.abs(z() - left)).toBeLessThan(0.003);
  });

  it('sits inside the limits with no snap when placed at its open pose', async () => {
    const { physics, plate, start } = await rig(RAIL_TRAVEL);
    run(physics, 3);
    const t = plate.translation();
    expect(Math.hypot(t.x - start.x, t.y - start.y, t.z - start.z)).toBeLessThan(0.002);
  });
});

describe('a plate seated at a tilt under physics', () => {
  const TILT = (10 * Math.PI) / 180;

  it('squares up on the rails and still slides along the travel', async () => {
    const { physics, plate, joints, start, z } = await rig(0, TILT);
    run(physics, 2);
    const { x, y, z: qz, w } = plate.rotation();
    // The angle off square (the identity), in degrees.
    const off = (2 * Math.acos(Math.min(1, Math.abs(w))) * 180) / Math.PI;
    expect(off).toBeLessThan(0.5);
    expect(Math.hypot(x, y, qz)).toBeLessThan(Math.sin((0.5 * Math.PI) / 360));
    for (const j of joints) physics.slide(j, 0.05);
    run(physics, 2);
    expect(Math.abs(z() - 0.05)).toBeLessThan(0.003);
    expect(Math.abs(plate.translation().x - start.x)).toBeLessThan(0.005);
  });
});

describe('a plate put in the wrong way round under physics', () => {
  it('stays within its travel of where it is put, not flung by a half-turn correction', async () => {
    const { physics, plate, start } = await rig(0, Math.PI);
    run(physics, 2);
    const t = plate.translation();
    expect(Math.hypot(t.x - start.x, t.y - start.y, t.z - start.z)).toBeLessThan(RAIL_TRAVEL + 0.02);
  });
});
