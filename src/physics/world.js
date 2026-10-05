import RAPIER from '@dimforge/rapier3d-compat';
import { FASTENER, PHYSICS, ROOM } from '../constants.js';
import { createAccumulator } from './stepping.js';

const toVector = ([x, y, z]) => ({ x, y, z });
const toRotation = ([x, y, z, w]) => ({ x, y, z, w });
const ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const DEGREES = Math.PI / 180;
// Collision groups: membership in nothing, interested in nothing — collides with nothing.
const NO_COLLISIONS = 0;
const ALL_COLLISIONS = 0xffffffff;
const ANGULAR_AXES = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ];

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
 * control (part manipulation). `join`/`unjoin` add and remove the joints fastener state
 * calls for (src/game/assembly.js `bonds()`).
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
        // Hardware is millimetres thin; CCD keeps a fast pin from tunnelling the floor.
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfExtents)
        .setMass(Math.max(mass, PHYSICS.minBodyMass))
        .setFriction(PHYSICS.friction)
        .setRestitution(PHYSICS.restitution),
      body,
    );
    mesh.position.set(...position);
    mesh.quaternion.set(...rotation);
    bodies.push({ body, mesh });
    return body;
  }

  /** A fixed slab — the flatpack's cardboard — at `position`/`rotation`. */
  function addStatic({ halfExtents, position, rotation }) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfExtents)
        .setTranslation(...position)
        .setRotation(toRotation(rotation))
        .setFriction(PHYSICS.friction)
        .setRestitution(PHYSICS.restitution),
    );
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

  const joints = new Map(); // handle → { mode, bodyB }
  const embedded = new Map(); // body → embedding joints holding it

  function setCollisions(body, groups) {
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(groups);
  }

  /**
   * Joins two bodies at `frame` — `{ anchorA, anchorB, rotation }`: one physical point in
   * each body's frame, and b's rest rotation in a's — and returns the joint handle. The
   * pair stops colliding with each other.
   *   'rigid'  fixed joint
   *   'embed'  fixed joint, and b (hardware sunk into a) collides with nothing while held
   *   'play'   rigid in translation, FASTENER.angularPlayDegrees of angular play about the
   *            pivot, heavily damped: it slumps to the limit and stays — no spring, no bounce
   */
  function join(bodyA, bodyB, { anchorA, anchorB, rotation }, mode) {
    const play = mode === 'play';
    const data = play
      ? RAPIER.JointData.spherical(toVector(anchorA), toVector(anchorB))
      : RAPIER.JointData.fixed(toVector(anchorA), toRotation(rotation), toVector(anchorB), IDENTITY);
    const joint = world.createImpulseJoint(data, bodyA, bodyB, true);
    joint.setContactsEnabled(false);
    if (play) {
      // Limits and motors measure from the rest rotation, not from bodies aligned.
      joint.setFrameX1(toRotation(rotation));
      // The spherical joint has no typed limit/motor wrapper in this Rapier build; the raw
      // joint set takes them per axis.
      const raw = world.impulseJoints.raw;
      const limit = FASTENER.angularPlayDegrees * DEGREES;
      for (const axis of ANGULAR_AXES) {
        raw.jointSetLimits(joint.handle, axis, -limit, limit);
        raw.jointConfigureMotorModel(joint.handle, axis, RAPIER.MotorModel.ForceBased);
        // Zero stiffness, pure damping: resists the slump's speed, never pushes back.
        raw.jointConfigureMotor(joint.handle, axis, 0, 0, 0, FASTENER.playDamping);
      }
    }
    if (mode === 'embed') {
      embedded.set(bodyB, (embedded.get(bodyB) ?? 0) + 1);
      setCollisions(bodyB, NO_COLLISIONS);
    }
    joints.set(joint, { mode, bodyB });
    return joint;
  }

  /** Removes a joint from `join`; both bodies wake, and embedded hardware collides again. */
  function unjoin(joint) {
    const record = joints.get(joint);
    if (!record) return;
    joints.delete(joint);
    if (record.mode === 'embed') {
      const count = embedded.get(record.bodyB) - 1;
      if (count > 0) embedded.set(record.bodyB, count);
      else {
        embedded.delete(record.bodyB);
        setCollisions(record.bodyB, ALL_COLLISIONS);
      }
    }
    world.removeImpulseJoint(joint, true);
  }

  return { register, addStatic, step, grab, move, release, join, unjoin };
}
