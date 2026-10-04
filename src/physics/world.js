import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS, ROOM } from '../constants.js';
import { createAccumulator } from './stepping.js';

const toVector = ([x, y, z]) => ({ x, y, z });
const toRotation = ([x, y, z, w]) => ({ x, y, z, w });

/** Static slabs just outside the visible floor and walls, so surfaces line up exactly. */
function addRoomColliders(world) {
  const half = PHYSICS.roomColliderThickness / 2;
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const halfH = ROOM.height / 2;
  const slabs = [
    { halfExtents: [halfW + 2 * half, half, halfD + 2 * half], center: [0, -half, 0] },
    { halfExtents: [halfW + 2 * half, halfH, half], center: [0, halfH, -halfD - half] },
    { halfExtents: [halfW + 2 * half, halfH, half], center: [0, halfH, halfD + half] },
    { halfExtents: [half, halfH, halfD], center: [-halfW - half, halfH, 0] },
    { halfExtents: [half, halfH, halfD], center: [halfW + half, halfH, 0] },
  ];
  for (const { halfExtents, center } of slabs) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfExtents)
        .setTranslation(...center)
        .setFriction(PHYSICS.friction)
        .setRestitution(PHYSICS.restitution),
    );
  }
}

/**
 * The only module that imports Rapier. Resolves once the WASM is initialised, with the
 * static room in place. `register` glues a mesh to a new dynamic cuboid body; `step`
 * advances the simulation by whole fixed steps and copies body poses onto their meshes.
 */
export async function createPhysicsWorld() {
  await RAPIER.init();

  const world = new RAPIER.World(toVector(PHYSICS.gravity));
  world.timestep = PHYSICS.timestep;
  addRoomColliders(world);

  const accumulator = createAccumulator(PHYSICS.timestep, PHYSICS.maxStepsPerFrame);
  const bodies = [];

  function register(mesh, { halfExtents, mass, position, rotation }) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .setRotation(toRotation(rotation))
        .setLinearDamping(PHYSICS.linearDamping)
        .setAngularDamping(PHYSICS.angularDamping)
        // Hardware is millimetres thin; CCD keeps a fast nail from tunnelling the floor.
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfExtents)
        .setMass(mass)
        .setFriction(PHYSICS.friction)
        .setRestitution(PHYSICS.restitution),
      body,
    );
    mesh.position.set(...position);
    mesh.quaternion.set(...rotation);
    bodies.push({ body, mesh });
    return body;
  }

  function step(delta) {
    const steps = accumulator.consume(delta);
    if (steps === 0) return;
    for (let i = 0; i < steps; i++) world.step();
    for (const { body, mesh } of bodies) {
      if (body.isSleeping()) continue;
      const { x, y, z } = body.translation();
      mesh.position.set(x, y, z);
      const r = body.rotation();
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  return { register, step };
}
