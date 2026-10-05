import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS, ROOM } from '../constants.js';
import { createAccumulator } from './stepping.js';

const toVector = ([x, y, z]) => ({ x, y, z });
const toRotation = ([x, y, z, w]) => ({ x, y, z, w });
const ZERO = { x: 0, y: 0, z: 0 };

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
 * `grab`/`move`/`release` hand a registered body between the simulation and direct
 * control (part manipulation).
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
      // Kinematic bodies are synced even if Rapier has put them to sleep: a held or placed
      // part must always show the pose `move` gave it.
      if (body.isSleeping() && !body.isKinematic()) continue;
      const { x, y, z } = body.translation();
      mesh.position.set(x, y, z);
      const r = body.rotation();
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Takes a body out of the simulation: it follows `move` and pushes dynamic bodies aside. */
  function grab(body) {
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  /** Sets a grabbed body's pose for the next step; `rotation` ([x, y, z, w]) is optional. */
  function move(body, position, rotation) {
    body.setNextKinematicTranslation(toVector(position));
    if (rotation) body.setNextKinematicRotation(toRotation(rotation));
    body.wakeUp();
  }

  /** Hands a grabbed body back to the simulation at rest, so it drops rather than flies. */
  function release(body) {
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setLinvel(ZERO, true);
    body.setAngvel(ZERO, true);
  }

  return { register, step, grab, move, release };
}
