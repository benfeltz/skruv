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
 * static room in place. `register` glues a mesh to a new dynamic body of one or more
 * cuboids; `step`
 * advances the simulation by whole fixed steps and copies body poses onto their meshes.
 * `grab`/`move`/`release` hand a registered body between the simulation and direct
 * control (part manipulation). `join`/`unjoin` add and remove the joints fastener state
 * calls for (src/game/assembly.js `bonds()`). `retune` re-applies the live-tunable values
 * baked in at creation (src/game/tunables.js) to every body, collider and joint.
 */
export async function createPhysicsWorld() {
  await RAPIER.init();

  const world = new RAPIER.World(toVector(PHYSICS.gravity));
  world.timestep = PHYSICS.timestep;
  addRoomColliders(world);

  const accumulator = createAccumulator(PHYSICS.timestep, PHYSICS.maxStepsPerFrame);
  const bodies = [];

  /**
   * Glues `mesh` to a new dynamic body at `position`/`rotation`. Its shape is one cuboid
   * (`halfExtents`), or several glued rigid (`colliders: [{ halfExtents, offset }]`, offsets
   * in the body frame), the mass shared between them by volume. `friction` overrides
   * PHYSICS.friction for this body, and survives `retune`.
   */
  function register(mesh, { halfExtents, colliders = [{ halfExtents, offset: [0, 0, 0] }], mass, friction, position, rotation }) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .setRotation(toRotation(rotation))
        .setLinearDamping(PHYSICS.linearDamping)
        .setAngularDamping(PHYSICS.angularDamping)
        // Hardware is millimetres thin; CCD keeps a fast pin from tunnelling the floor.
        .setCcdEnabled(true),
    );
    const volumes = colliders.map(({ halfExtents: [x, y, z] }) => x * y * z);
    const volume = volumes.reduce((sum, v) => sum + v, 0);
    colliders.forEach(({ halfExtents: half, offset }, i) => {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...half)
          .setTranslation(...offset)
          .setMass((Math.max(mass, PHYSICS.minBodyMass) * volumes[i]) / volume)
          .setFriction(friction ?? PHYSICS.friction)
          .setRestitution(PHYSICS.restitution),
        body,
      );
    });
    mesh.position.set(...position);
    mesh.quaternion.set(...rotation);
    bodies.push({ body, mesh, friction });
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

  /** Sets a body down at a pose, at rest and under the simulation — a repack or a respawn. */
  function place(body, position, rotation) {
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
    body.setTranslation(toVector(position), false);
    body.setRotation(toRotation(rotation), false);
    body.setLinvel(ZERO, false);
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
      setPlay(joint);
    }
    if (mode === 'embed') {
      embedded.set(bodyB, (embedded.get(bodyB) ?? 0) + 1);
      setCollisions(bodyB, NO_COLLISIONS);
    }
    joints.set(joint, { mode, bodyB });
    return joint;
  }

  // The play joint's angular limit and damping, from FASTENER. The spherical joint has no
  // typed limit/motor wrapper in this Rapier build; the raw joint set takes them per axis.
  function setPlay(joint) {
    const raw = world.impulseJoints.raw;
    const limit = FASTENER.angularPlayDegrees * DEGREES;
    for (const axis of ANGULAR_AXES) {
      raw.jointSetLimits(joint.handle, axis, -limit, limit);
      raw.jointConfigureMotorModel(joint.handle, axis, RAPIER.MotorModel.ForceBased);
      // Zero stiffness, pure damping: resists the slump's speed, never pushes back.
      raw.jointConfigureMotor(joint.handle, axis, 0, 0, 0, FASTENER.playDamping);
    }
  }

  /**
   * Re-applies the live-tunable values made into bodies, colliders and joints when they
   * were created: PHYSICS damping and friction (a body's own friction stays), FASTENER play. Play joints wake, so a
   * carcass re-slumps to a changed limit at once. Additive — creation is unchanged.
   */
  function retune() {
    world.forEachCollider((collider) => collider.setFriction(PHYSICS.friction));
    for (const { body, friction } of bodies) {
      body.setLinearDamping(PHYSICS.linearDamping);
      body.setAngularDamping(PHYSICS.angularDamping);
      if (friction === undefined) continue;
      for (let i = 0; i < body.numColliders(); i++) body.collider(i).setFriction(friction);
    }
    for (const [joint, { mode }] of joints) {
      if (mode !== 'play') continue;
      setPlay(joint);
      joint.body1().wakeUp();
      joint.body2().wakeUp();
    }
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

  return { register, step, grab, move, release, place, join, unjoin, retune };
}
