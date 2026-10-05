import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GESTURE, SNAP } from '../src/constants.js';
import { CONNECTOR, PART_TYPES } from '../src/game/catalog.js';
import { createDevLayout } from '../src/game/devLayout.js';
import { createGestureState } from '../src/game/gestureState.js';
import * as snapMath from '../src/game/snapMath.js';
import { applyTransform, findSnap, rotateVector } from '../src/game/snapMath.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('camera seam (1.1 camera unchanged when no part is touched)', () => {
  const router = read('src/scene/gestureRouter.js');

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
    const hits = [null, { kind: 'part' }, { kind: 'ring' }];
    for (let run = 0; run < 500; run++) {
      const g = createGestureState();
      const live = new Set();
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
  const world = read('src/physics/world.js');

  it('keeps register/step as they were and adds grab/move/release', () => {
    expect(world).toMatch(/function register\(mesh, \{ halfExtents, mass, position, rotation \}\)/);
    expect(world).toMatch(/function step\(delta\)/);
    expect(world).toMatch(/return \{ register, step, grab, move, release \};/);
  });
});

describe('rotation defaults', () => {
  it('uses 90° detents by default', () => {
    expect(GESTURE.detentStep).toBeCloseTo(Math.PI / 2);
  });

  it('starts the free-rotate toggle off and feeds it to the gizmo as the only way out of detents', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/createToggleButton\(\{ label: 'Free rotate' \}\)/);
    expect(main).toMatch(/isFree: \(\) => freeRotate\.pressed/);
    expect(read('src/scene/gizmo.js')).toMatch(/quantizeAngle\([^)]*isFree\(\) \? 0 : GESTURE\.detentStep\)/);
  });
});

describe('snapping scope', () => {
  it('carries type-level compatibility only — no instance-level mating API', () => {
    expect(Object.keys(snapMath).sort()).toEqual(
      [
        'COMPATIBLE',
        'applyTransform',
        'areCompatible',
        'findSnap',
        'multiplyQuaternions',
        'rotateVector',
        'rotationBetween',
      ].sort(),
    );
  });

  it('marks the kinematic "placed" hold as temporary until PR 4', () => {
    const router = read('src/scene/gestureRouter.js');
    const hold = router.slice(router.indexOf('if (snapped)'), router.indexOf('} else {', router.indexOf('if (snapped)')));
    expect(hold).toMatch(/TEMPORARY/);
    expect(hold).toMatch(/PR 4/);
    expect(hold).not.toMatch(/physics\.release/);
  });

  it('reaches a hole from a part hovering at grab height (generous first)', () => {
    expect(SNAP.maxDistance).toBeGreaterThan(GESTURE.hoverLift);
  });
});

describe('snapping against the real catalog and dev layout', () => {
  const world = (part, { position, rotation }) =>
    PART_TYPES[part].connectors.map(({ type, position: local, axis }) => ({
      type,
      position: rotateVector(rotation, local).map((v, i) => v + position[i]),
      axis: rotateVector(rotation, axis),
    }));

  // A side panel as the dev layout lays it: inner face (its dowel holes) facing up.
  const side = createDevLayout().find(({ id }) => id === 'sidePanel-1');
  const sideConnectors = world('sidePanel', side);
  const hole = sideConnectors.find(({ type }) => type === CONNECTOR.DOWEL_HOLE);

  it('lays the side panel with its dowel holes facing up', () => {
    expect(hole.axis[1]).toBeCloseTo(1);
  });

  it('seats an upright dowel hovering just above a hole, end in the mouth', () => {
    const halfLength = PART_TYPES.dowel.size[1] / 2;
    const pose = {
      position: [hole.position[0] + 0.01, hole.position[1] + halfLength + GESTURE.hoverLift, hole.position[2] - 0.01],
      rotation: [0, 0, 0, 1],
    };
    const snap = findSnap(world('dowel', pose), sideConnectors, SNAP);
    expect(snap).not.toBeNull();
    const seated = applyTransform(snap.transform, pose);
    const end = world('dowel', seated).find(({ position }) => position[1] < seated.position[1]);
    end.position.forEach((v, i) => expect(v).toBeCloseTo(snap.to.position[i], 9));
    expect(end.axis[1]).toBeCloseTo(-1);
  });

  it('does not seat a dowel still lying flat', () => {
    const flat = createDevLayout().find(({ id }) => id === 'dowel-1');
    const pose = { position: [hole.position[0], hole.position[1] + 0.01, hole.position[2]], rotation: flat.rotation };
    expect(findSnap(world('dowel', pose), sideConnectors, SNAP)).toBeNull();
  });
});
