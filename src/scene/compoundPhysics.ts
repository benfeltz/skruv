import { carryPose } from '../game/assembly.js';
import { poseOf } from '../physics/world.js';
import type { Assembly, PartId } from '../game/assembly.js';
import type { Part } from '../game/partMesh.js';
import type { Body, PhysicsWorld } from '../physics/world.js';
import type { Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

/**
 * Physics seam that moves a fastened compound as one. Grabbing any part of a compound
 * grabs every part of it, each `move` carries them all by the same rigid motion, and
 * releasing lets them all go — so a carcass is never dragged or turned by one kinematic
 * part fighting its joints and the floor. Several compounds can be held at once (one carried,
 * one held still under it as a fit is offered); each is keyed by the body that grabbed it.
 * Free parts, and every other call, pass straight through to `physics`.
 *
 * Membership is the assembly's (`compoundOf`), taken when the grab starts.
 */
export function createCompoundPhysics(physics: PhysicsWorld, parts: Part[], assembly: Pick<Assembly, 'compoundOf'>): PhysicsWorld {
  const partByBody = new Map(parts.map((part) => [part.body, part]));
  const partById = new Map<PartId, Part>(parts.map((part) => [part.id, part]));
  // The body that grabbed each compound held → where it was, and its other members with theirs.
  const carried = new Map<Body, { start: Pose; members: { body: Body; start: Pose }[] }>();

  function grab(body: Body) {
    physics.grab(body);
    const part = partByBody.get(body);
    const members = part ? [...assembly.compoundOf(part.id)].filter((id) => id !== part.id) : [];
    if (members.length === 0) return;
    carried.set(body, {
      start: poseOf(body),
      members: members.map((id) => {
        const { body: member } = partById.get(id)!;
        physics.grab(member);
        return { body: member, start: poseOf(member) };
      }),
    });
  }

  function move(body: Body, position: Vec3, rotation?: Quat) {
    physics.move(body, position, rotation);
    const held = carried.get(body);
    if (!held) return;
    const to: Pose = { position, rotation: rotation ?? held.start.rotation };
    for (const member of held.members) {
      const pose = carryPose(held.start, to, member.start);
      physics.move(member.body, pose.position, pose.rotation);
    }
  }

  function release(body: Body) {
    physics.release(body);
    const held = carried.get(body);
    if (!held) return;
    for (const member of held.members) physics.release(member.body);
    carried.delete(body);
  }

  return { ...physics, grab, move, release };
}
