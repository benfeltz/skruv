import { carryPose } from '../game/assembly.js';

/**
 * Physics seam that moves a fastened compound as one. Grabbing any part of a compound
 * grabs every part of it, each `move` carries them all by the same rigid motion, and
 * releasing lets them all go — so a carcass is never dragged or turned by one kinematic
 * part fighting its joints and the floor. Free parts, and every other call, pass straight
 * through to `physics`.
 *
 * Membership is the assembly's (`compoundOf`), taken when the grab starts.
 */
export function createCompoundPhysics(physics, parts, assembly) {
  const partByBody = new Map(parts.map((part) => [part.body, part]));
  const partById = new Map(parts.map((part) => [part.id, part]));
  let carried = null; // { body, start, members: [{ body, start }] }

  function poseOf(body) {
    const { x, y, z } = body.translation();
    const r = body.rotation();
    return { position: [x, y, z], rotation: [r.x, r.y, r.z, r.w] };
  }

  function grab(body) {
    physics.grab(body);
    const part = partByBody.get(body);
    const members = part ? [...assembly.compoundOf(part.id)].filter((id) => id !== part.id) : [];
    if (members.length === 0) return;
    carried = {
      body,
      start: poseOf(body),
      members: members.map((id) => {
        const { body: member } = partById.get(id);
        physics.grab(member);
        return { body: member, start: poseOf(member) };
      }),
    };
  }

  function move(body, position, rotation) {
    physics.move(body, position, rotation);
    if (carried?.body !== body) return;
    const to = { position, rotation: rotation ?? carried.start.rotation };
    for (const member of carried.members) {
      const pose = carryPose(carried.start, to, member.start);
      physics.move(member.body, pose.position, pose.rotation);
    }
  }

  function release(body) {
    physics.release(body);
    if (carried?.body !== body) return;
    for (const member of carried.members) physics.release(member.body);
    carried = null;
  }

  return { ...physics, grab, move, release };
}
