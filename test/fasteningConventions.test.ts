import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import type { FastenerKind } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, rotateVector } from '../tools/validate/lib/geometry.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';
import { FASTENER } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { createAssembly } from '../src/game/assembly.js';
import type { JointFrame } from '../src/game/assembly.js';
import { createFastener, transition } from '../src/game/fasteners.js';
import type { Fastener, FastenerEvent } from '../src/game/fasteners.js';
import { createGestureState, OWNER } from '../src/game/gestureState.js';
import type { PointerRecord } from '../src/game/gestureState.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsWorld } from '../src/physics/world.js';
import { createCompoundPhysics } from '../src/scene/compoundPhysics.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const typeOf = (id: string) => id.replace(/-\d+$/, '');
const IDENTITY: Quat = [0, 0, 0, 1];
const ALONG_X: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2]; // a rod's local +y onto world +x

describe('no correctness gate in the engine (decision 1)', () => {
  it('keeps the graph and fastener machines blind to the intended assembly', () => {
    for (const path of ['src/game/assembly.ts', 'src/game/fasteners.ts']) {
      expect(read(path)).not.toMatch(/\bMANIFEST\b|\bASSEMBLED\b|\bMANUAL\b|devLayout|boxLayout|bookletModel|booklet\s*\(/);
    }
  });
});

describe('every fastener is bidirectional (decision 2)', () => {
  const forward: Record<string, FastenerEvent[]> = {
    [KIND.DOWEL]: [{ type: 'tap' }],
    [KIND.PIN]: [{ type: 'tap' }],
    [KIND.FITTING]: [{ type: 'tap' }],
    [KIND.BOLT]: [{ type: 'crank', radians: FASTENER.screwRadians }],
    [KIND.CAM]: [{ type: 'crank', radians: FASTENER.quarterTurn }],
  };
  const reverse: Record<string, FastenerEvent[]> = {
    [KIND.DOWEL]: [{ type: 'pull' }],
    [KIND.PIN]: [{ type: 'pull' }],
    [KIND.FITTING]: [{ type: 'pull' }],
    [KIND.BOLT]: [{ type: 'crank', radians: -FASTENER.screwRadians }],
    [KIND.CAM]: [{ type: 'crank', radians: -FASTENER.quarterTurn }],
  };

  it.each(Object.keys(forward) as FastenerKind[])('%s fastens through its interaction and the reverse undoes it exactly', (kind) => {
    const run = (f: Fastener, events: FastenerEvent[]) => events.reduce((acc, e) => transition(acc, e, { captured: true }), f);
    const fastened = run(createFastener(kind), forward[kind]);
    expect(fastened.state).not.toBe('seated');
    expect(run(fastened, reverse[kind])).toEqual(createFastener(kind));
  });

  it('has no abstract undo or detach anywhere in the fastening code', () => {
    for (const path of ['src/game/assembly.ts', 'src/game/fasteners.ts', 'src/scene/gestureRouter.ts']) {
      expect(read(path)).not.toMatch(/\b(undo|detach)\w*\s*\(/i);
    }
  });
});

describe('joint fidelity tunables (decision 8)', () => {
  it('keeps the dowel-stage angular play in the 3–5° band, damped, in constants', () => {
    expect(FASTENER.angularPlayDegrees).toBeGreaterThanOrEqual(3);
    expect(FASTENER.angularPlayDegrees).toBeLessThanOrEqual(5);
    expect(FASTENER.playDamping).toBeGreaterThan(0);
  });

  it('drives the play joint from FASTENER with a zero-stiffness (slump, not spring) motor', () => {
    const world = read('src/physics/world.ts');
    expect(world).toMatch(/FASTENER\.angularPlayDegrees/);
    expect(world).toMatch(/jointConfigureMotor\(joint\.handle, axis, 0, 0, 0, FASTENER\.playDamping\)/);
  });

  it('turns a cam a quarter turn', () => {
    expect(FASTENER.quarterTurn).toBeCloseTo(Math.PI / 2);
  });
});

describe('cams can lock on the real catalog geometry', () => {
  // A side at the origin in assembled orientation; a horizontal panel doweled to it and a
  // cam bolt screwed into the same joint. Poses come from the graph's own bond frames.
  const levels = [
    { name: 'bottom', shelf: 'topBottomPanel', dowels: [0, 1], bolts: [2], recesses: [2] },
    { name: 'fixed shelf', shelf: 'fixedShelf', dowels: [3, 4], bolts: [5, 6], recesses: [2, 3] },
    { name: 'top', shelf: 'topBottomPanel', dowels: [7, 8], bolts: [9], recesses: [2] },
  ];
  const fromFrame = ({ anchorA, anchorB, rotation }: JointFrame): Pose => ({
    position: anchorA.map((v, i) => v - rotateVector(rotation, anchorB)[i]) as Vec3,
    rotation,
  });

  function corner({ shelf, dowels, bolts }: { shelf: string; dowels: number[]; bolts: number[] }, { press }: { press: boolean }) {
    const assembly = createAssembly(typeOf);
    const shelfId = `${shelf}-1`;
    const poses: Record<string, Pose> = { 'sidePanel-1': { position: [0, 0, 0], rotation: IDENTITY }, [shelfId]: { position: [0.4, 0, 0], rotation: IDENTITY } };
    dowels.forEach((hole, i) => {
      const dowel = `dowel-${i + 1}`;
      poses[dowel] = { position: [0, 0, 0], rotation: ALONG_X };
      assembly.seat({ partA: dowel, connectorA: 0, partB: 'sidePanel-1', connectorB: hole, mover: dowel });
      assembly.seat({ partA: shelfId, connectorA: i, partB: dowel, connectorB: 1, mover: shelfId });
      assembly.tap(dowel);
      // Unpressed on the shelf side: it stays a dowel's length out from the side.
      if (!press) assembly.apply(assembly.jointsOf(shelfId).find((j) => j.hardware === dowel)!.id, { type: 'pull' });
    });
    bolts.forEach((hole, i) => {
      const bolt = `camLockBolt-${i + 1}`;
      poses[bolt] = { position: [0, 0, 0], rotation: ALONG_X };
      const joint = assembly.seat({ partA: bolt, connectorA: 0, partB: 'sidePanel-1', connectorB: hole, mover: bolt });
      assembly.apply(joint.id, { type: 'crank', radians: FASTENER.screwRadians });
    });
    const bonds = assembly.bonds((id) => poses[id]);
    const pose = (id: string): Pose | null => {
      if (id === 'sidePanel-1') return poses[id];
      const bond = bonds.find((b) => b.b === id && b.a === 'sidePanel-1');
      return bond ? fromFrame(bond.frame) : null;
    };
    return { pose, shelfId };
  }

  const headOf = (pose: Pose) => connectorInWorld(PART_TYPES.camLockBolt.connectors[1], pose).position;
  const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

  it.each(levels)('$name: a pressed-flush panel brings every recess within capture of its bolt head', (level) => {
    const { pose, shelfId } = corner(level, { press: true });
    level.bolts.forEach((_, i) => {
      const head = headOf(pose(`camLockBolt-${i + 1}`)!);
      const recess = connectorInWorld(PART_TYPES[level.shelf].connectors[level.recesses[i]], pose(shelfId)!).position;
      expect(distance(head, recess)).toBeLessThanOrEqual(FASTENER.captureRadius);
    });
  });

  it('a panel left a dowel-length out is not bridged, so there is no flush pose to catch from', () => {
    const { pose, shelfId } = corner(levels[0], { press: false });
    expect(pose(shelfId)).toBeNull();
  });
});

describe('a fastened compound moves as one (compoundPhysics seam)', () => {
  type FakeBody = Body & { id: string };

  function rig() {
    const calls: (string | number[])[][] = [];
    // A stand-in rigid body: the seam reads its pose, the fake physics its id.
    const body = (id: string, position: Vec3) => ({ id, translation: () => ({ x: position[0], y: position[1], z: position[2] }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) }) as unknown as FakeBody;
    const parts = [
      { id: 'sidePanel-1', body: body('side', [0, 0, 0]) },
      { id: 'dowel-1', body: body('dowel', [0.02, 0, 0]) },
      { id: 'topBottomPanel-1', body: body('shelf', [0.4, 0, 0]) },
      { id: 'dowel-2', body: body('loose', [2, 0, 0]) },
    ] as unknown as Part[]; // no meshes: the seam only reads ids and bodies
    // Only the calls these tests make; the fake join takes no arguments.
    const physics = {
      grab: (b: FakeBody) => calls.push(['grab', b.id]),
      move: (b: FakeBody, position: Vec3) => calls.push(['move', b.id, position.map((v) => +v.toFixed(6))]),
      release: (b: FakeBody) => calls.push(['release', b.id]),
      join: () => 'joined',
    } as unknown as PhysicsWorld;
    const compound = new Set(['sidePanel-1', 'dowel-1', 'topBottomPanel-1']);
    const assembly = { compoundOf: (id: string) => (compound.has(id) ? compound : new Set([id])) };
    return { calls, parts, seam: createCompoundPhysics(physics, parts, assembly) as PhysicsWorld & { join: () => string } };
  }

  it('grabs, carries and releases every member through one of them', () => {
    const { calls, parts, seam } = rig();
    seam.grab(parts[0].body);
    seam.move(parts[0].body, [0, 0.1, 0]);
    seam.release(parts[0].body);
    expect(calls.filter(([op]) => op === 'grab').map(([, id]) => id).sort()).toEqual(['dowel', 'shelf', 'side']);
    expect(calls.filter(([op]) => op === 'move')).toEqual([
      ['move', 'side', [0, 0.1, 0]],
      ['move', 'dowel', [0.02, 0.1, 0]],
      ['move', 'shelf', [0.4, 0.1, 0]],
    ]);
    expect(calls.filter(([op]) => op === 'release').map(([, id]) => id).sort()).toEqual(['dowel', 'shelf', 'side']);
  });

  it('passes a free part and every other call straight through', () => {
    const { calls, parts, seam } = rig();
    seam.grab(parts[3].body);
    seam.move(parts[3].body, [3, 0, 0]);
    seam.release(parts[3].body);
    expect(calls).toEqual([['grab', 'loose'], ['move', 'loose', [3, 0, 0]], ['release', 'loose']]);
    expect(seam.join()).toBe('joined');
  });

  it('is what both the router and the gizmo are handed in main.js', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/createCompoundPhysics\(physics, parts, assembly\)/);
    expect(main.match(/physics: manipulation/g)).toHaveLength(2);
  });
});

describe('lift channel never leaks to the camera (regression risk, step 2)', () => {
  // Seeded random extra fingers during a part drag: the camera stays off and unclaimed
  // until the primary finger ends, whatever the lift finger does.
  it('keeps the part gesture owned and the camera disabled until the primary lifts', () => {
    let seed = 99;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 300; run++) {
      const g = createGestureState();
      g.down({ id: 1, x: 0, y: 0, t: 0, hit: { kind: 'part' } });
      g.move({ id: 1, x: 40, y: 0, t: 10 });
      const extras = new Set();
      for (let i = 0; i < 10; i++) {
        const id = 2 + Math.floor(random() * 3);
        const point: PointerRecord = { id, x: random() * 300, y: random() * 300, t: 20 + i * 10, hit: random() < 0.5 ? null : { kind: 'part' } };
        if (!extras.has(id)) {
          g.down(point);
          extras.add(id);
        } else if (random() < 0.6) g.move(point);
        else {
          (random() < 0.5 ? g.up : g.cancel)(point);
          extras.delete(id);
        }
        expect(g.owner).toBe(OWNER.DRAG_PART);
        expect(g.cameraEnabled).toBe(false);
      }
      expect(g.up({ id: 1, x: 40, y: 0, t: 500 })).toMatchObject({ type: 'dragEnd' });
      expect(g.cameraEnabled).toBe(true);
    }
  });
});
