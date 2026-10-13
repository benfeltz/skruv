import RAPIER from '@dimforge/rapier3d-compat';
import { FASTENER, PHYSICS, ROOM } from '../constants.js';
import { createAccumulator } from './stepping.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { BondMode, JointFrame } from '../game/assembly.js';

// Rapier's types, for the modules that hold bodies and joints — they import them from here,
// never from Rapier.
export type Body = RAPIER.RigidBody;
export type PhysicsJoint = RAPIER.ImpulseJoint;

/** What a body's pose is copied onto each step: a Three object, as far as this module cares. */
export interface PoseTarget {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
}

/** One cuboid of a body's shape, offset in the body frame. */
export interface ColliderShape {
  halfExtents: Vec3;
  offset: Vec3;
}

/** What `register` takes — see there. */
export interface BodySpec {
  halfExtents?: Vec3;
  colliders?: ColliderShape[];
  mass: number;
  friction?: number;
  position: Vec3;
  rotation: Quat;
}

const toVector = ([x, y, z]: number[]) => ({ x, y, z });
const toRotation = ([x, y, z, w]: number[]) => ({ x, y, z, w });
const ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const DEGREES = Math.PI / 180;
// Collision groups: membership in nothing, interested in nothing — collides with nothing.
const NO_COLLISIONS = 0;
const ALL_COLLISIONS = 0xffffffff;
// The raw joint set (setPlay) takes the WASM build's own axis enum: the same numbers as JointAxis.
type RawJointAxis = Parameters<RAPIER.World['impulseJoints']['raw']['jointSetLimits']>[1];
const ANGULAR_AXES = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ] as unknown as RawJointAxis[];
// Likewise its motor model enum: the same numbers as MotorModel.
type RawMotorModel = Parameters<RAPIER.World['impulseJoints']['raw']['jointConfigureMotorModel']>[2];

/** Static slabs just outside the visible floor and walls, so surfaces line up exactly. */
function addRoomColliders(world: RAPIER.World) {
  const half = PHYSICS.roomColliderThickness / 2;
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const halfH = ROOM.height / 2;
  const slabs: { halfExtents: Vec3; center: Vec3 }[] = [
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
 * calls for (src/game/assembly.ts `bonds()`). `retune` re-applies the live-tunable values
 * baked in at creation (src/game/tunables.ts) to every body, collider and joint. `remove`
 * takes a registered body back out — an item swap's teardown — and `census` counts what
 * the world holds.
 */
export async function createPhysicsWorld() {
  await RAPIER.init();

  const world = new RAPIER.World(toVector(PHYSICS.gravity));
  world.timestep = PHYSICS.timestep;
  addRoomColliders(world);

  const accumulator = createAccumulator(PHYSICS.timestep, PHYSICS.maxStepsPerFrame);
  // Every registered body, keyed by itself: what `step` syncs and `retune` re-applies to, in register order.
  const bodies = new Map<Body, { mesh: PoseTarget; friction: number | undefined }>();

  /**
   * Glues `mesh` to a new dynamic body at `position`/`rotation`. Its shape is one cuboid
   * (`halfExtents`), or several glued rigid (`colliders: [{ halfExtents, offset }]`, offsets
   * in the body frame), the mass shared between them by volume. `friction` overrides
   * PHYSICS.friction for this body, and survives `retune`.
   */
  function register(mesh: PoseTarget, { halfExtents, colliders = [{ halfExtents: halfExtents!, offset: [0, 0, 0] }], mass, friction, position, rotation }: BodySpec) {
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
    bodies.set(body, { mesh, friction });
    return body;
  }

  function step(delta: number) {
    const steps = accumulator.consume(delta);
    if (steps === 0) return;
    for (let i = 0; i < steps; i++) world.step();
    for (const [body, { mesh }] of bodies) {
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
  function grab(body: Body) {
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  /** Sets a grabbed body's pose for the next step; `rotation` ([x, y, z, w]) is optional. */
  function move(body: Body, position: Vec3, rotation?: Quat) {
    body.setNextKinematicTranslation(toVector(position));
    if (rotation) body.setNextKinematicRotation(toRotation(rotation));
    body.wakeUp();
  }

  /** Hands a grabbed body back to the simulation at rest, so it drops rather than flies. */
  function release(body: Body) {
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setLinvel(ZERO, true);
    body.setAngvel(ZERO, true);
  }

  /** Sets a body down at a pose, at rest and under the simulation — a repack or a respawn. */
  function place(body: Body, position: Vec3, rotation: Quat) {
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
    body.setTranslation(toVector(position), false);
    body.setRotation(toRotation(rotation), false);
    body.setLinvel(ZERO, false);
    body.setAngvel(ZERO, true);
  }

  const joints = new Map<PhysicsJoint, { mode: BondMode; bodyB: Body; play: boolean }>(); // handle → { mode, bodyB, play }
  const embedded = new Map<Body, number>(); // body → embedding joints holding it

  function setCollisions(body: Body, groups: number) {
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(groups);
  }

  /**
   * Joins two bodies at `frame` — `{ anchorA, anchorB, rotation }`: one physical point in
   * each body's frame, and b's rest rotation in a's — and returns the joint handle. The
   * pair stops colliding with each other.
   *   'rigid'  fixed joint
   *   'embed'  fixed joint, and b (hardware sunk into a) collides with nothing while held
   *   'play'   rigid in translation, FASTENER.angularPlayDegrees of angular play about the
   *            pivot, heavily damped: it slumps to the limit and stays — no spring, no bounce.
   *            At zero play (the shipped default) it is a fixed joint: a zero-width limit
   *            on a spherical joint lets a carcass creep where a fixed joint holds it square.
   */
  function join(bodyA: Body, bodyB: Body, { anchorA, anchorB, rotation }: JointFrame, mode: BondMode) {
    const play = mode === 'play' && FASTENER.angularPlayDegrees > 0;
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
    joints.set(joint, { mode, bodyB, play });
    return joint;
  }

  // The play joint's angular limit and damping, from FASTENER. The spherical joint has no
  // typed limit/motor wrapper in this Rapier build; the raw joint set takes them per axis.
  function setPlay(joint: PhysicsJoint) {
    const raw = world.impulseJoints.raw;
    const limit = FASTENER.angularPlayDegrees * DEGREES;
    for (const axis of ANGULAR_AXES) {
      raw.jointSetLimits(joint.handle, axis, -limit, limit);
      raw.jointConfigureMotorModel(joint.handle, axis, RAPIER.MotorModel.ForceBased as unknown as RawMotorModel);
      // Zero stiffness, pure damping: resists the slump's speed, never pushes back.
      raw.jointConfigureMotor(joint.handle, axis, 0, 0, 0, FASTENER.playDamping);
    }
  }

  /**
   * Re-applies the live-tunable values made into bodies, colliders and joints when they
   * were created: PHYSICS damping and friction (a body's own friction stays), FASTENER play. Play joints wake, so a
   * carcass re-slumps to a changed limit at once. Additive — creation is unchanged: a joint
   * built fixed at zero play stays fixed until the next sync rebuilds it with play.
   */
  function retune() {
    world.forEachCollider((collider) => collider.setFriction(PHYSICS.friction));
    for (const [body, { friction }] of bodies) {
      body.setLinearDamping(PHYSICS.linearDamping);
      body.setAngularDamping(PHYSICS.angularDamping);
      if (friction === undefined) continue;
      for (let i = 0; i < body.numColliders(); i++) body.collider(i).setFriction(friction);
    }
    for (const [joint, { play }] of joints) {
      if (!play) continue;
      setPlay(joint);
      joint.body1().wakeUp();
      joint.body2().wakeUp();
    }
  }

  /** Removes a joint from `join`; both bodies wake, and embedded hardware collides again. */
  function unjoin(joint: PhysicsJoint) {
    const record = joints.get(joint);
    if (!record) return;
    joints.delete(joint);
    if (record.mode === 'embed') {
      const count = embedded.get(record.bodyB)! - 1;
      if (count > 0) embedded.set(record.bodyB, count);
      else {
        embedded.delete(record.bodyB);
        setCollisions(record.bodyB, ALL_COLLISIONS);
      }
    }
    world.removeImpulseJoint(joint, true);
  }

  /**
   * Takes a registered body out of the world: its joints first (as `unjoin`, so a body it
   * embedded collides again and its own embed count drops to nothing), then the body and,
   * with it in Rapier, its colliders — out of `step`'s and `retune`'s bookkeeping too. The
   * body is dead afterwards; removing it twice, or one never registered, is a bug upstream
   * and throws before anything is touched. The joint scan is over the world's joints, a few
   * dozen at most — a whole item's teardown stays well under a frame.
   */
  function remove(body: Body) {
    if (!bodies.delete(body)) throw new Error('remove: body is not registered (removed twice, or never registered)');
    for (const joint of joints.keys()) if (joint.body1().handle === body.handle || joint.body2().handle === body.handle) unjoin(joint);
    world.removeRigidBody(body);
  }

  /** What the world holds: Rapier's bodies, colliders and joints (the room's slabs included), and the bodies `step` syncs. */
  function census() {
    return { bodies: world.bodies.len(), colliders: world.colliders.len(), joints: world.impulseJoints.len(), registered: bodies.size };
  }

  return { register, step, grab, move, release, place, join, unjoin, retune, remove, census };
}

export type PhysicsWorld = Awaited<ReturnType<typeof createPhysicsWorld>>;
