import { describe, expect, it } from 'vitest';
import { placeLayout } from '../tools/validate/lib/geometry.js';
import { DISPLAY, PHYSICS } from '../src/constants.js';
import { createAssembly, seatHome } from '../src/game/assembly.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { createPackedWorldLayout, lidRest, respawnSpots } from '../src/game/boxLayout.js';
import { createPhysicsWorld } from '../src/physics/world.js';

// Headless Rapier runs of the 1.5 start state — the real physics module, no renderer.
// Meshes are stubs: `register` only copies poses onto them.
const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });
const run = (physics, seconds) => {
  for (let t = 0; t < seconds; t += PHYSICS.timestep) physics.step(PHYSICS.timestep);
};
const y = (body) => body.translation().y;

function spawn(physics, records) {
  return new Map(
    records.map(({ id, type, position, rotation }) => {
      const part = PART_TYPES[type];
      const body = physics.register(stubMesh(), { halfExtents: part.size.map((d) => d / 2), mass: part.mass, position, rotation });
      return [id, { type, body, start: position }];
    }),
  );
}

describe('the packed flatpack under physics', () => {
  it('settles within 5 mm, keeps the lid on its walls, and falls asleep', async () => {
    const physics = await createPhysicsWorld();
    const { createFlatpack } = await import('./support/flatpackPhysics.js');
    createFlatpack(physics);
    const lid = lidRest();
    const lidBody = physics.register(stubMesh(), { halfExtents: PART_TYPES.boxLid.size.map((d) => d / 2), mass: PART_TYPES.boxLid.mass, ...lid });
    const parts = spawn(physics, createPackedWorldLayout());
    run(physics, 30);
    for (const [id, { body, start }] of parts) expect(Math.abs(y(body) - start[1]), id).toBeLessThan(0.005);
    expect(y(lidBody)).toBeCloseTo(lid.position[1], 3);
    for (const [id, { body }] of parts) expect(body.isSleeping(), id).toBe(true);
  });
});

describe('the display shelf under physics', () => {
  it('stands: every part within 2 mm of its assembled pose, shelves on their pins', async () => {
    const physics = await createPhysicsWorld();
    const layout = ASSEMBLED;
    const half = DISPLAY.yaw / 2;
    const posed = placeLayout(layout.parts, { position: DISPLAY.position, rotation: [0, Math.sin(half), 0, Math.cos(half)] });
    const parts = spawn(physics, posed);
    const assembly = createAssembly((id) => parts.get(id).type);
    seatHome(
      assembly,
      layout.joints.map((j) => ({
        partA: j.hardware,
        connectorA: j.hardwareConnector,
        partB: j.host,
        connectorB: j.hostConnector,
        mover: j.mover,
        ctx: { through: j.through, captured: j.captured },
      })),
    );
    // What the router's reconcile does on `sync()`: one physics joint per bond.
    const poseOf = (id) => {
      const { body } = parts.get(id);
      const t = body.translation();
      const r = body.rotation();
      return { position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w] };
    };
    for (const bond of assembly.bonds(poseOf)) physics.join(parts.get(bond.a).body, parts.get(bond.b).body, bond.frame, bond.mode);
    run(physics, 10);
    for (const [id, { body, start }] of parts) {
      const t = body.translation();
      expect(Math.hypot(t.x - start[0], t.y - start[1], t.z - start[2]), id).toBeLessThan(0.002);
    }
  });
});

describe('recovered parts under physics', () => {
  it('land beside the box and stay in the room, a whole batch at once', async () => {
    const physics = await createPhysicsWorld();
    const types = createPackedWorldLayout().map((p) => p.type);
    const spots = respawnSpots(types);
    const bodies = types.map((type, i) => spawn(physics, [{ id: `${type}-${i}`, type, ...spots[i] }]).values().next().value.body);
    run(physics, 5);
    for (const body of bodies) {
      const t = body.translation();
      expect(t.y).toBeGreaterThan(0);
      expect(Math.abs(t.x)).toBeLessThan(5);
      expect(Math.abs(t.z)).toBeLessThan(5);
    }
  });
});
