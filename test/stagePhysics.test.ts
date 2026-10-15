import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';
import { PHYSICS, ROOM, STAGE } from '../src/constants.js';
import { hasEscaped } from '../src/game/dragMath.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import type { PhysicsWorld } from '../src/physics/world.js';

// The stage's colliders, headless: what a part sees is what stops it.
const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const IDENTITY: Quat = [0, 0, 0, 1];
const run = (physics: PhysicsWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
};

// A flat plate thinner than the lip, and a cube taller than any lip: a lip stops the first, a wall the second.
const PLATE: Vec3 = [0.15, 0.008, 0.15];
const CUBE: Vec3 = [0.1, 0.1, 0.1];

async function shoved(half: Vec3, from: Vec3, velocity: Vec3) {
  const physics = await createPhysicsWorld();
  const body = physics.register(stubMesh(), { halfExtents: half, mass: 1, position: from, rotation: IDENTITY });
  body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  run(physics, 3);
  const { x, y, z } = body.translation();
  return { x, y, z };
}

const edgeX = ROOM.width / 2;
const edgeZ = ROOM.depth / 2;

describe('the stage holds parts on the floor', () => {
  it('stops a plate pushed toward +x at the right lip', async () => {
    const { x, y } = await shoved(PLATE, [edgeX - 1, PLATE[1], 0], [2, 0, 0]);
    expect(x + PLATE[0]).toBeLessThan(edgeX + 0.01);
    expect(y).toBeGreaterThan(0);
  });

  it('stops a plate pushed toward +z at the front lip', async () => {
    const { z, y } = await shoved(PLATE, [0, PLATE[1], edgeZ - 1], [0, 0, 2]);
    expect(z + PLATE[2]).toBeLessThan(edgeZ + 0.01);
    expect(y).toBeGreaterThan(0);
  });

  it('stops a cube thrown hard at the left wall', async () => {
    const { x } = await shoved(CUBE, [-edgeX + 1, CUBE[1], 0], [-8, 0, 0]);
    expect(x - CUBE[0]).toBeGreaterThan(-edgeX - 0.01);
  });

  it('stops a cube thrown hard at the back wall', async () => {
    const { z } = await shoved(CUBE, [0, CUBE[1], -edgeZ + 1], [0, 0, -8]);
    expect(z - CUBE[2]).toBeGreaterThan(-edgeZ - 0.01);
  });

  it('stops a cube lofted toward the left wall up to the lift ceiling', async () => {
    const { x } = await shoved(CUBE, [-edgeX + 1, ROOM.height - 0.3, 0], [-6, 0, 0]);
    expect(x - CUBE[0]).toBeGreaterThan(-edgeX - 0.01);
  });
});

describe('a part that does go over the open edge is recovered (1.5 sweep)', () => {
  it('goes over a lip taller than itself and falls past the slab, flagged escaped', async () => {
    // A cube is taller than the lip: it rolls over and drops off the slab's edge.
    const { x, y, z } = await shoved(CUBE, [edgeX - 0.5, CUBE[1], 0], [4, 0, 0]);
    expect(x).toBeGreaterThan(edgeX + STAGE.lipThickness);
    expect(hasEscaped([x, y, z], ROOM, 0.05)).toBe(true);
  });

  it('flags a part past the front edge, below the floor, as escaped', () => {
    expect(hasEscaped([0, -1, edgeZ + 0.5], ROOM, 0.05)).toBe(true);
  });
});
