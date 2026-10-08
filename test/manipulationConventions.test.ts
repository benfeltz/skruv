import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import type { Pose, Vec3 } from '../tools/validate/lib/geometry.js';
import { GESTURE, SNAP } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { createPackedWorldLayout } from '../src/game/boxLayout.js';
import { createGestureState } from '../src/game/gestureState.js';
import type { GestureEffect, GestureHit, PointerRecord } from '../src/game/gestureState.js';
import * as snapMath from '../src/game/snapMath.js';
import { applyTransform, findSnap } from '../src/game/snapMath.js';
import type { WorldConnector } from '../src/game/snapMath.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// cancel reads only the id; the fuzz below hands it a whole pointer record.
type FuzzGestures = Omit<ReturnType<typeof createGestureState>, 'cancel'> & { cancel(pointer: PointerRecord): GestureEffect | null };

describe('camera seam (1.1 camera unchanged when no part is touched)', () => {
  const router = read('src/scene/gestureRouter.ts');

  it('drives the camera only through enable()/disable(), never OrbitControls', () => {
    expect(router).not.toMatch(/import[^;]*OrbitControls/);
    expect(router).not.toMatch(/\bcontrols\./);
    expect(router).not.toMatch(/\.enabled\s*=/);
    const cameraCalls = [...router.matchAll(/cameraControls\.(\w+)/g)].map(([, name]) => name);
    expect(new Set(cameraCalls)).toEqual(new Set(['enable', 'disable']));
  });

  it('listens on every gesture-end path, including pointercancel', () => {
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'visibilitychange', 'blur']) {
      expect(router).toMatch(new RegExp(`addEventListener\\('${event}'`));
    }
  });

  it("takes pointerdown in the capture phase, ahead of OrbitControls' own listener", () => {
    expect(router).toMatch(/addEventListener\('pointerdown',\s*onPointerDown,\s*\{\s*capture:\s*true\s*\}\)/);
  });

  // Seeded random gestures: whatever mix of presses, moves, releases and cancels, once
  // every pointer has ended the camera is enabled again.
  it('hands the camera back after any sequence of gestures once every pointer has ended', () => {
    let seed = 1234;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const hits: (GestureHit | null)[] = [null, { kind: 'part' }, { kind: 'ring' }];
    for (let run = 0; run < 500; run++) {
      const g: FuzzGestures = createGestureState();
      const live = new Set<number>();
      let t = 0;
      for (let i = 0; i < 12; i++) {
        t += Math.floor(random() * 200);
        const id = 1 + Math.floor(random() * 3);
        const x = random() * 200;
        const y = random() * 200;
        const roll = random();
        if (!live.has(id)) {
          g.down({ id, x, y, t, hit: hits[Math.floor(random() * 3)], button: random() < 0.9 ? 0 : 2 });
          live.add(id);
        } else if (roll < 0.5) {
          g.move({ id, x, y, t });
        } else if (roll < 0.8) {
          g.up({ id, x, y, t });
          live.delete(id);
        } else {
          g.cancel({ id, x, y, t });
          live.delete(id);
        }
      }
      for (const id of live) (random() < 0.5 ? g.up : g.cancel)({ id, x: 0, y: 0, t: t + 1 });
      expect(g.cameraEnabled).toBe(true);
      expect(g.owner).toBeNull();
    }
  });
});

describe('physics boundary', () => {
  const world = read('src/physics/world.ts');

  it('keeps register/step as they were and adds grab/move/release', () => {
    // 1.7.1 extends register's options (colliders, friction) without changing a caller.
    expect(world).toMatch(/function register\(mesh: PoseTarget, \{ halfExtents, colliders = \[\{ halfExtents: halfExtents!, offset: \[0, 0, 0\] \}\], mass, friction, position, rotation \}: BodySpec\)/);
    expect(world).toMatch(/function step\(delta: number\)/);
    expect(world).toMatch(/function grab\(body: Body\)/);
    expect(world).toMatch(/function move\(body: Body, position: Vec3, rotation\?: Quat\)/);
    expect(world).toMatch(/function release\(body: Body\)/);
  });

  it('adds join/unjoin (1.4), retune (1.6) and exposes exactly that API', () => {
    expect(world).toMatch(/function join\(bodyA: Body, bodyB: Body, \{ anchorA, anchorB, rotation \}: JointFrame, mode: BondMode\)/);
    expect(world).toMatch(/function unjoin\(joint: PhysicsJoint\)/);
    expect(world).toMatch(/function retune\(\)/);
    expect(world).toMatch(/return \{ register, step, grab, move, release, place, join, unjoin, retune \};/);
  });

  // 1.7.1: the box is a part — one dynamic multi-collider body — so the 1.5 static slabs went.
  it('registers the flatpack box as one dynamic body, never static slabs', () => {
    expect(world).not.toMatch(/addStatic/);
    expect(read('src/scene/flatpack.ts')).toMatch(/physics\.register\(box, \{\n\s+colliders:/);
  });

  it('lets the box drag but never takes it into the gizmo, the highlight or the repack', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/const parts = \[flatpack\.base, flatpack\.lid\];/);
    expect(main).toMatch(/part !== flatpack\.base && part !== flatpack\.lid\);/);
    expect(main).toMatch(/if \(!part \|\| part === flatpack\.base\) \{/);
  });
});

describe('rotation defaults', () => {
  it('keeps the detent at 90° behind the toggle', () => {
    expect(GESTURE.detentStep).toBeCloseTo(Math.PI / 2);
  });

  it('starts the snap-rotate toggle off, so rotation is free until it turns detents on', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/createToggleButton\(\{ label: 'Snap rotate' \}\)/);
    expect(main).toMatch(/isFree: \(\) => !snapRotate\.pressed/);
    expect(read('src/scene/gizmo.ts')).toMatch(/quantizeAngle\([^)]*isFree\(\) \? 0 : GESTURE\.detentStep\)/);
  });
});

describe('snapping scope', () => {
  it('carries type-level compatibility only — no instance-level mating API', () => {
    // Type-level compatibility itself is the Flatpack vocabulary's (tools/validate/lib).
    expect(Object.keys(snapMath).sort()).toEqual(['applyTransform', 'findSnap']);
  });

  it('keeps the placed hold only until the first fastener engages (its 1.3 removal condition)', () => {
    const router = read('src/scene/gestureRouter.ts');
    const hold = router.slice(router.indexOf('if (snapped)'), router.indexOf('} else {', router.indexOf('if (snapped)')));
    expect(hold).not.toMatch(/physics\.release/);
    expect(hold).toMatch(/placed\.add\(part\)/);
    expect(router).not.toMatch(/TEMPORARY/);
    // reconcile() releases a held part once a bond holds it.
    const reconcile = router.slice(router.indexOf('function reconcile()'), router.indexOf('function holdLooseHardware()'));
    expect(reconcile).toMatch(/if \(!isBonded\(part\)\) continue;\s*placed\.delete\(part\);\s*physics\.release\(part\.body\);/);
  });

  it('reaches a hole from a part hovering at grab height (generous first)', () => {
    expect(SNAP.maxDistance).toBeGreaterThan(GESTURE.hoverLift);
  });
});

describe('snapping against the real catalog and the packed flatpack', () => {
  const world = (part: string, { position, rotation }: Pose): WorldConnector[] =>
    PART_TYPES[part].connectors.map(({ type, position: local, axis }) => ({
      type,
      position: rotateVector(rotation, local).map((v, i) => v + position[i]) as Vec3,
      axis: rotateVector(rotation, axis),
    }));

  // A side panel as the flatpack packs it: inner face (its dowel holes) facing up.
  const side = createPackedWorldLayout().find(({ id }) => id === 'sidePanel-1')!;
  const sideConnectors = world('sidePanel', side);
  const hole = sideConnectors.find(({ type }) => type === CONNECTOR.DOWEL_HOLE)!;

  it('lays the side panel with its dowel holes facing up', () => {
    expect(hole.axis[1]).toBeCloseTo(1);
  });

  it('seats an upright dowel hovering just above a hole, end in the mouth', () => {
    const halfLength = PART_TYPES.dowel.size[1] / 2;
    const pose: Pose = {
      position: [hole.position[0] + 0.01, hole.position[1] + halfLength + GESTURE.hoverLift, hole.position[2] - 0.01],
      rotation: [0, 0, 0, 1],
    };
    const snap = findSnap(world('dowel', pose), sideConnectors, SNAP)!;
    expect(snap).not.toBeNull();
    const seated = applyTransform(snap.transform, pose);
    const end = world('dowel', seated).find(({ position }) => position[1] < seated.position[1])!;
    end.position.forEach((v, i) => expect(v).toBeCloseTo(snap.to.position[i], 9));
    expect(end.axis[1]).toBeCloseTo(-1);
  });

  it('does not seat a dowel still lying flat', () => {
    const flat = createPackedWorldLayout().find(({ id }) => id === 'dowel-1')!;
    const pose: Pose = { position: [hole.position[0], hole.position[1] + 0.01, hole.position[2]], rotation: flat.rotation };
    expect(findSnap(world('dowel', pose), sideConnectors, SNAP)).toBeNull();
  });
});
