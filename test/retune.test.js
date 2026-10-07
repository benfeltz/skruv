import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, describe, expect, it } from 'vitest';
import { FASTENER, PHYSICS } from '../src/constants.js';
import { createTunables } from '../src/game/tunables.js';
import { createPhysicsWorld } from '../src/physics/world.js';

// The physics applier under real Rapier: values baked into bodies, colliders and play
// joints at creation follow a live knob once `retune` runs.
const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const box = (physics, x) =>
  physics.register(stubMesh(), { halfExtents: [0.1, 0.1, 0.1], mass: 1, position: [x, 0.5, 0], rotation: [0, 0, 0, 1] });

describe('world.retune', () => {
  const tunables = createTunables();
  afterEach(() => tunables.reset());

  it('re-applies damping, friction and joint play to what already exists', async () => {
    const physics = await createPhysicsWorld();
    const a = box(physics, 0);
    const b = box(physics, 0.3);
    const joint = physics.join(a, b, { anchorA: [0.15, 0, 0], anchorB: [-0.15, 0, 0], rotation: [0, 0, 0, 1] }, 'play');
    const limit = () => joint.rawSet.jointLimitsMax(joint.handle, RAPIER.JointAxis.AngX);
    expect(limit()).toBeCloseTo((FASTENER.angularPlayDegrees * Math.PI) / 180, 6);

    tunables.set('physics.linearDamping', 1.25);
    tunables.set('physics.angularDamping', 0.75);
    tunables.set('physics.friction', 0.2);
    tunables.set('joint.angularPlay', 10);
    // Written through, but not yet applied to what Rapier already made.
    expect(a.linearDamping()).toBeCloseTo(0.1, 6);

    physics.retune();
    expect(a.linearDamping()).toBeCloseTo(1.25, 6);
    expect(b.angularDamping()).toBeCloseTo(0.75, 6);
    expect(a.collider(0).friction()).toBeCloseTo(0.2, 6);
    expect(limit()).toBeCloseTo((10 * Math.PI) / 180, 6);
    expect(PHYSICS.friction).toBe(0.2);
  });
});
