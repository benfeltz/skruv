import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/constants.js';
import { createPhysicsWorld } from '../src/physics/world.js';
import type { PhysicsWorld } from '../src/physics/world.js';
import type { JointFrame } from '../src/game/assembly.js';

// Bodies leave the world: `remove` takes a registered body's joints, colliders and the body
// out of Rapier and out of the world's own bookkeeping, so an item swap's teardown leaves
// nothing behind for `step` or `retune` to trip on. Headless, real Rapier.
const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const box = (physics: PhysicsWorld, x: number) =>
  physics.register(stubMesh(), { halfExtents: [0.1, 0.1, 0.1], mass: 1, position: [x, 0.5, 0], rotation: [0, 0, 0, 1] });
// A body of two glued cuboids: remove takes every collider, not just the first.
const twoBlocks = (physics: PhysicsWorld, x: number) =>
  physics.register(stubMesh(), {
    colliders: [
      { halfExtents: [0.1, 0.1, 0.1], offset: [-0.1, 0, 0] },
      { halfExtents: [0.1, 0.1, 0.1], offset: [0.1, 0, 0] },
    ],
    mass: 1,
    position: [x, 0.5, 0],
    rotation: [0, 0, 0, 1],
  });
const frame: JointFrame = { anchorA: [0.15, 0, 0], anchorB: [-0.15, 0, 0], rotation: [0, 0, 0, 1] };
const run = (physics: PhysicsWorld, seconds: number) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
};

describe('world.remove', () => {
  it("throws on a body it doesn't hold, and leaves every other body's record alone", async () => {
    const physics = await createPhysicsWorld();
    const a = box(physics, 0);
    const kept = box(physics, 0.5);
    physics.remove(a);
    const before = physics.census();
    expect(() => physics.remove(a)).toThrow('not registered');
    expect(physics.census()).toEqual(before);
    // The survivor is still synced: stepped, it falls.
    run(physics, 0.5);
    expect(kept.translation().y).toBeLessThan(0.2);
  });

  it('takes a body and every collider it has back out, to the baseline', async () => {
    const physics = await createPhysicsWorld();
    const baseline = physics.census();
    const a = box(physics, 0);
    const b = twoBlocks(physics, 0.5);
    expect(physics.census()).toEqual({ ...baseline, bodies: baseline.bodies + 2, colliders: baseline.colliders + 3, registered: 2 });
    physics.remove(a);
    physics.remove(b);
    expect(physics.census()).toEqual(baseline);
  });

  it('steps and retunes after a removal without touching the dead body', async () => {
    const physics = await createPhysicsWorld();
    const a = box(physics, 0);
    const kept = box(physics, 0.5);
    run(physics, 0.2);
    physics.remove(a);
    expect(() => run(physics, 0.5)).not.toThrow();
    expect(() => physics.retune()).not.toThrow();
    // The one left is still simulated: it fell to the floor.
    expect(kept.translation().y).toBeLessThan(0.2);
  });

  it('removes a jointed pair cleanly, whichever side goes first', async () => {
    for (const mode of ['rigid', 'embed', 'play'] as const) {
      for (const first of ['a', 'b'] as const) {
        const physics = await createPhysicsWorld();
        const baseline = physics.census();
        const a = box(physics, 0);
        const b = box(physics, 0.3);
        physics.join(a, b, frame, mode);
        run(physics, 0.1);
        const [gone, left] = first === 'a' ? [a, b] : [b, a];
        physics.remove(gone);
        // The joint went with the body; the one left stands alone.
        expect(physics.census(), `${mode}, ${first} first`).toEqual({ ...baseline, bodies: baseline.bodies + 1, colliders: baseline.colliders + 1, registered: 1 });
        expect(() => run(physics, 0.2)).not.toThrow();
        expect(() => physics.retune()).not.toThrow();
        physics.remove(left);
        expect(physics.census(), `${mode}, ${first} first`).toEqual(baseline);
      }
    }
  });

  it('frees embedded hardware to collide again when its host goes', async () => {
    const physics = await createPhysicsWorld();
    const host = box(physics, 0);
    const pin = box(physics, 0.3);
    physics.join(host, pin, frame, 'embed');
    expect(pin.collider(0).collisionGroups()).toBe(0);
    physics.remove(host);
    expect(pin.collider(0).collisionGroups()).toBe(0xffffffff);
  });

  it('leaves joints between other bodies alone', async () => {
    const physics = await createPhysicsWorld();
    const a = box(physics, 0);
    const b = box(physics, 0.3);
    const c = box(physics, 0.6);
    physics.join(a, b, frame, 'rigid');
    const before = physics.census();
    physics.remove(c);
    expect(physics.census()).toEqual({ ...before, bodies: before.bodies - 1, colliders: before.colliders - 1, registered: before.registered - 1 });
    expect(physics.census().joints).toBe(1);
  });
});

describe('world.slide', () => {
  it('throws on a joint that is not a slide', async () => {
    const physics = await createPhysicsWorld();
    const joint = physics.join(box(physics, 0), box(physics, 0.3), frame, 'rigid');
    expect(() => physics.slide(joint, 0.05)).toThrow('not a slide joint');
  });
});
