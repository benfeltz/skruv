import { describe, expect, it } from 'vitest';
import { PHYSICS, RESET, ROOM } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { hasEscaped } from '../src/game/dragMath.js';
import { baseRest, boxPoseOf, createPackedWorldLayout, lidRest, PACKED_BOX as BOX, respawnSpots } from '../src/game/boxLayout.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import type { Body, PhysicsWorld } from '../src/physics/world.js';
import type { PackedPart } from '../src/game/boxLayout.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';
import { createFlatpack } from './support/flatpackPhysics.js';

// 1.7.1 acceptance, headless Rapier: the box is a part the player drags, and reset and
// recovery follow it wherever it ends up. The same pure layout calls main.js wires, driven
// against the real physics module; feel (scrape, drag) stays a device check.

const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const run = (physics: PhysicsWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
};
const poseOf = (body: Body): Pose => {
  const t = body.translation();
  const r = body.rotation();
  return { position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w] };
};
const yawed = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
const [width] = BOX.inner;

function spawnBox(physics: PhysicsWorld) {
  const base = createFlatpack(physics);
  const lid = physics.register(stubMesh(), { halfExtents: PART_TYPES.boxLid.size.map((d) => d / 2) as Vec3, mass: PART_TYPES.boxLid.mass!, ...lidRest() });
  const parts = createPackedWorldLayout().map(({ id, type, position, rotation }) => {
    const part = PART_TYPES[type];
    return { id, type, body: physics.register(stubMesh(), { halfExtents: part.size.map((d) => d / 2) as Vec3, mass: part.mass!, position, rotation }) };
  });
  return { base, lid, parts };
}

// The player's drag, as the router does it: take the body over, walk it there, let go.
function drag(physics: PhysicsWorld, body: Body, to: Pose, steps = 120) {
  const from = poseOf(body);
  physics.grab(body);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    physics.move(body, from.position.map((v, k) => v + (to.position[k] - v) * t) as Vec3, i === steps ? to.rotation : undefined);
    physics.step(PHYSICS.timestep);
  }
  physics.move(body, to.position, to.rotation);
  physics.step(PHYSICS.timestep);
  physics.release(body);
}

// A map whose every lookup is known present: the packed layout holds every part.
type Lookup<V> = Omit<Map<string, V>, 'get'> & { get(id: string): V };

// main.js's repack: stand the box upright where it is, then pack every part and the lid into it.
function repack(physics: PhysicsWorld, { base, lid, parts }: ReturnType<typeof spawnBox>) {
  const box = boxPoseOf(poseOf(base));
  const upright = baseRest(box);
  physics.place(base, upright.position, upright.rotation);
  const packed = new Map(createPackedWorldLayout(box).map((p) => [p.id, p])) as Lookup<PackedPart>;
  for (const { id, body } of parts) physics.place(body, packed.get(id).position, packed.get(id).rotation);
  const closed = lidRest(box);
  physics.place(lid, closed.position, closed.rotation);
  return { box, packed, closed };
}

describe('the box moved across the room, then reset (1.7.1 #13)', () => {
  it('repacks every part into the box where it now sits, settling as the boot pack does', async () => {
    const physics = await createPhysicsWorld();
    const flatpack = spawnBox(physics);
    run(physics, 2);
    // Unbox: everything out onto the floor beside the box, then drag the empty box away and turn it.
    const spots = respawnSpots([...flatpack.parts.map((p) => p.type), 'boxLid']);
    flatpack.parts.forEach(({ body }, i) => physics.place(body, spots[i].position, spots[i].rotation));
    physics.place(flatpack.lid, spots.at(-1)!.position, spots.at(-1)!.rotation);
    run(physics, 3);
    const target: Pose = { position: [-2.4, 0, -1.5], rotation: yawed(0.6) };
    drag(physics, flatpack.base, { position: baseRest(target).position.map((v, k) => v + (k === 1 ? 0.03 : 0)) as Vec3, rotation: target.rotation });
    run(physics, 3);

    const { box, packed, closed } = repack(physics, flatpack);
    // Where the box was dragged to, give or take its drop and settle.
    expect(Math.hypot(box.position[0] - target.position[0], box.position[2] - target.position[2])).toBeLessThan(0.01);
    run(physics, 30);
    for (const { id, body } of flatpack.parts) {
      const { position } = poseOf(body);
      expect(Math.hypot(...position.map((v, k) => v - packed.get(id).position[k])), id).toBeLessThan(0.007);
      expect(body.isSleeping(), id).toBe(true);
    }
    expect(poseOf(flatpack.lid).position[1]).toBeCloseTo(closed.position[1], 2);
    const rest = baseRest(box).position;
    expect(Math.hypot(...poseOf(flatpack.base).position.map((v, k) => v - rest[k]))).toBeLessThan(0.002);
  });
});

describe('recovery beside a box dragged against a wall (1.7.1 #13)', () => {
  it('sets a whole batch down on the open side, in the room, clear of the box', async () => {
    const physics = await createPhysicsWorld();
    const { base, parts } = spawnBox(physics);
    // Box pushed up against the +x wall, length along z: its +x side has no room for the patch.
    const atWall: Pose = { position: [ROOM.width / 2 - width / 2 - BOX.wall - 0.1, 0, 0], rotation: [0, 0, 0, 1] };
    const rest = baseRest(atWall);
    for (const { body } of parts) physics.place(body, [0, -5, 0], [0, 0, 0, 1]); // out of the room
    physics.place(base, rest.position, rest.rotation);
    run(physics, 1);

    const box = boxPoseOf(poseOf(base));
    const types = parts.map((p) => p.type);
    const spots = respawnSpots(types, box);
    parts.forEach(({ body }, i) => physics.place(body, spots[i].position, spots[i].rotation));
    run(physics, 5);
    for (const { id, body } of parts) {
      const { position } = poseOf(body);
      expect(hasEscaped(position, ROOM, RESET.escapeMargin), id).toBe(false);
      // Out past the box's −x wall (the box is unturned), on the side away from the room's wall.
      expect(position[0] - box.position[0], id).toBeLessThan(-(width / 2 + BOX.wall));
    }
  });
});
