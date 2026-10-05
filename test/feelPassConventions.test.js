// Automated half of the 1.4.1 test plan: the feel pass's acceptance criteria and
// regression risks, checked against the real catalog and dev layout headlessly. Touch
// feel itself (phone pickability, sprue, assist, zoom-out) is manual — see Test Plan.md.

import { describe, expect, it } from 'vitest';
import { CAMERA, CAMERA_LIMITS, DECAL, GESTURE, PICK, ROOM, SNAP } from '../src/constants.js';
import { CONNECTOR, MANIFEST, PART_TYPES } from '../src/game/catalog.js';
import { decalPlacements } from '../src/game/decals.js';
import { createDevLayout } from '../src/game/devLayout.js';
import { easeToward } from '../src/game/dragMath.js';
import { createGestureState, OWNER } from '../src/game/gestureState.js';
import { isSmallPart, preferHit, rayBoxReach } from '../src/game/pickMath.js';
import { rotateVector } from '../src/game/snapMath.js';
import { clampCamera } from '../src/scene/cameraLimits.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, s) => a.map((v) => v * s);
const normalize = (a) => scale(a, 1 / Math.hypot(...a));
const conjugate = ([x, y, z, w]) => [-x, -y, -z, w];

// A world ray in a posed box's own frame.
function toLocal({ position, rotation }, origin, direction) {
  const inverse = conjugate(rotation);
  return [rotateVector(inverse, sub(origin, position)), rotateVector(inverse, direction)];
}

// Slab test: distance along the ray to where it enters an origin-centred box, or null.
function entry(origin, direction, half) {
  let near = 0;
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-12) {
      if (Math.abs(origin[i]) > half[i]) return null;
      continue;
    }
    const a = (-half[i] - origin[i]) / direction[i];
    const b = (half[i] - origin[i]) / direction[i];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return near <= far ? near : null;
}

const halfOf = (type) => PART_TYPES[type].size.map((d) => d / 2);
const proxyHalf = (type) => PART_TYPES[type].size.map((d) => Math.max(d, PICK.proxyMinSize) / 2);

// What the router's hitTest picks among `parts` (`{ id, type, position, rotation }`) for
// a ray, using the same proxies and preference rule — headless.
function pick(parts, origin, target) {
  const direction = normalize(sub(target, origin));
  let partHit = null;
  const proxyHits = [];
  for (const part of parts) {
    const [o, d] = toLocal(part, origin, direction);
    const real = entry(o, d, halfOf(part.type));
    if (real !== null && (!partHit || real < partHit.distance)) partHit = { part, distance: real };
    if (!isSmallPart(PART_TYPES[part.type].size, PICK)) continue;
    const fat = entry(o, d, proxyHalf(part.type));
    if (fat !== null) proxyHits.push({ part, distance: fat, ...rayBoxReach(o, d, halfOf(part.type)) });
  }
  return preferHit(partHit, proxyHits, PICK)?.part ?? null;
}

describe('every fastener and tool pickable on the dev layout (AC1)', () => {
  const layout = createDevLayout();
  const small = layout.filter(({ type }) => isSmallPart(PART_TYPES[type].size, PICK));

  it('covers every hardware type in the manifest', () => {
    expect(new Set(small.map((p) => p.type))).toEqual(
      new Set(['dowel', 'camLockBolt', 'camLock', 'shelfPin', 'nail', 'allenWrench', 'screwdriver']),
    );
  });

  // A phone camera ~1.4 m away, aimed a few millimetres off the part — where a fingertip
  // centred on a 2 mm nail actually lands.
  it.each(small.map((p) => [p.id, p]))('picks %s with a fingertip a few mm off it', (_, part) => {
    const eye = add(part.position, [0, 1, 1]);
    for (const offset of [[0.006, 0, 0], [0, 0, -0.006], [-0.004, 0, 0.004]]) {
      expect(pick(layout, eye, add(part.position, offset))?.id).toBe(part.id);
    }
  });
});

describe('panel grabs near hardware stay panel grabs (regression risk, both directions)', () => {
  // A side panel as the dev layout lays it, holes up, with a dowel standing in one hole.
  const side = createDevLayout().find(({ id }) => id === 'sidePanel-1');
  const holeIndex = PART_TYPES.sidePanel.connectors.findIndex((c) => c.type === CONNECTOR.DOWEL_HOLE);
  const hole = PART_TYPES.sidePanel.connectors[holeIndex];
  const mouth = add(side.position, rotateVector(side.rotation, hole.position));
  const up = rotateVector(side.rotation, hole.axis);
  const dowelHalf = PART_TYPES.dowel.size[1] / 2;
  const dowel = { id: 'dowel-1', type: 'dowel', position: add(mouth, scale(up, dowelHalf - 0.015)), rotation: [0, 0, 0, 1] };
  const scene = [side, dowel];
  const top = add(dowel.position, [0, dowelHalf, 0]);

  it('stands the dowel upright in the hole', () => {
    expect(up[1]).toBeCloseTo(1);
  });

  it('picks the panel 10 cm from the dowel', () => {
    // Toward the panel's middle, so the press stays on the panel (the hole is near its end).
    const inward = normalize([side.position[0] - mouth[0], 0, side.position[2] - mouth[2]]);
    for (const distance of [0.1, 0.15]) {
      const target = add(mouth, scale(inward, distance));
      expect(pick(scene, add(target, [0, 1, 0.8]), target)?.id).toBe(side.id);
    }
  });

  it('picks the panel when a close-up press grazes the dowel proxy but not the finger radius', () => {
    // 0.5 m away the finger reaches ~1.25 cm; this ray clips the 4 cm proxy ~1.8 cm out.
    const target = add(mouth, [0.018, 0, 0]);
    const eye = add(target, [0, 0.5, 0]);
    const direction = normalize(sub(target, eye));
    const [o, d] = toLocal(dowel, eye, direction);
    expect(entry(o, d, proxyHalf('dowel'))).not.toBeNull();
    expect(pick(scene, eye, target)?.id).toBe(side.id);
  });

  it('picks the dowel when the finger is on it, though the panel lies right behind', () => {
    for (const offset of [[0.004, 0, 0], [0, 0, 0.006], [0, 0, 0]]) {
      const target = add(top, offset);
      expect(pick(scene, add(target, [0, 1, 0.8]), target)?.id).toBe(dowel.id);
    }
  });
});

describe('fasteners sunk in a panel stay hidden behind it (1.4.1 review)', () => {
  // A side panel standing as assembled (inner face +x) with a dowel seated in a dowel hole,
  // half in the panel: its 4 cm proxy pokes ~4 mm out of the panel's outer face.
  const side = { id: 'sidePanel-1', type: 'sidePanel', position: [0, 1.01, 0], rotation: [0, 0, 0, 1] };
  const hole = PART_TYPES.sidePanel.connectors.find((c) => c.type === CONNECTOR.DOWEL_HOLE);
  const mouth = add(side.position, hole.position);
  // Quarter turn about z: the dowel's long y axis along the hole's x axis.
  const dowel = { id: 'dowel-1', type: 'dowel', position: mouth, rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] };
  const scene = [side, dowel];

  it('pokes the proxy out of the outer face — the case that needs guarding', () => {
    const outer = side.position[0] - PART_TYPES.sidePanel.size[0] / 2;
    expect(dowel.position[0] - PICK.proxyMinSize / 2).toBeLessThan(outer);
  });

  it('picks the panel when pressed from outside, right over the hidden dowel', () => {
    const eye = add(mouth, [-1, 0.05, 0]);
    expect(pick(scene, eye, mouth)?.id).toBe(side.id);
  });

  it('picks the dowel from the inner side, where it stands proud', () => {
    const eye = add(mouth, [1, 0.05, 0]);
    expect(pick(scene, eye, mouth)?.id).toBe(dowel.id);
  });
});

describe('picking among neighbouring hardware — real layouts (1.4.1 review, round 6)', () => {
  const upright = [0, 0, 0, 1];
  const flat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2]; // long y axis laid along x
  const standing = (id, type, [x, z]) => ({ id, type, position: [x, PART_TYPES[type].size[1] / 2, z], rotation: upright });
  const lying = (id, type, [x, z]) => ({ id, type, position: [x, PART_TYPES[type].size[0] / 2, z], rotation: flat });
  const top = (p) => add(p.position, [0, p.rotation === upright ? PART_TYPES[p.type].size[1] / 2 : PART_TYPES[p.type].size[0] / 2, 0]);

  // Each layout: parts, then presses [description, part pressed, eye offset from its top, expected id].
  const layouts = [
    {
      name: 'cam lock 3.4 cm from its bolt (CAM_INSET)',
      parts: [standing('camLock-1', 'camLock', [0, 0]), standing('camLockBolt-1', 'camLockBolt', [0.034, 0])],
      presses: [
        ['the cam lock, seen over the bolt', 'camLock-1', [0.9, 1.2, 0], 'camLock-1'],
        // Low enough that the bolt really blocks the view: the bolt is what is touched.
        ['the cam lock hidden behind the bolt', 'camLock-1', [0.9, 0.4, 0], 'camLockBolt-1'],
        ['the bolt, seen past the cam lock', 'camLockBolt-1', [-0.9, 0.7, 0], 'camLockBolt-1'],
        ['the cam lock from above', 'camLock-1', [0, 1, 0.3], 'camLock-1'],
      ],
    },
    {
      name: 'two spare dowels lying side by side, 1.5 cm apart',
      parts: [lying('dowel-13', 'dowel', [0, 0]), lying('dowel-14', 'dowel', [0, 0.015])],
      presses: [
        ['the far dowel, over the near one', 'dowel-13', [0, 0.6, 0.9], 'dowel-13'],
        ['the near dowel', 'dowel-14', [0, 0.6, 0.9], 'dowel-14'],
        ['the near dowel from the other side', 'dowel-14', [0, 0.6, -0.9], 'dowel-14'],
      ],
    },
    {
      name: 'a pin and a nail standing 2 cm apart',
      parts: [standing('shelfPin-1', 'shelfPin', [0, 0]), standing('nail-1', 'nail', [0.02, 0])],
      presses: [
        ['the nail, behind the pin', 'nail-1', [-1, 0.5, 0], 'nail-1'],
        ['the pin, behind the nail', 'shelfPin-1', [1, 0.5, 0], 'shelfPin-1'],
      ],
    },
  ];

  for (const { name, parts, presses } of layouts) {
    describe(name, () => {
      it.each(presses)('a press squarely on %s picks it', (_, id, eye, expected) => {
        const target = top(parts.find((p) => p.id === id));
        // Aim just under the top, onto the part itself.
        const aim = add(target, [0, -0.002, 0]);
        expect(pick(parts, add(aim, eye), aim)?.id).toBe(expected);
      });
    });
  }
});

describe('hole decals on every socket in the box (AC3)', () => {
  const SOCKETS = new Set([
    CONNECTOR.DOWEL_HOLE,
    CONNECTOR.CAM_BOLT_HOLE,
    CONNECTOR.CAM_LOCK_RECESS,
    CONNECTOR.SHELF_PIN_HOLE,
    CONNECTOR.NAIL_HOLE,
  ]);

  it('marks every socket connector of every part instance once', () => {
    const decals = MANIFEST.flatMap(({ type }) => decalPlacements(PART_TYPES[type].connectors));
    const sockets = MANIFEST.flatMap(({ type }) => PART_TYPES[type].connectors.filter((c) => SOCKETS.has(c.type)));
    expect(decals).toHaveLength(sockets.length);
    expect(decals.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(PART_TYPES))('lays %s decals on its faces, just proud, no wider than a face', (_, part) => {
    const half = part.size.map((d) => d / 2);
    for (const { index, position, radius } of decalPlacements(part.connectors)) {
      const { axis } = part.connectors[index];
      const normal = axis.findIndex((v) => Math.abs(v) === 1);
      // On the face its hole opens on, the surface offset outside it.
      expect(Math.abs(position[normal])).toBeCloseTo(half[normal] + DECAL.surfaceOffset, 9);
      // A hole on a 16 mm edge must still fit across that edge.
      expect(2 * radius).toBeLessThan(Math.max(...part.size.filter((_, i) => i !== normal)));
    }
  });
});

describe('seat assist feel (AC4)', () => {
  const seat = { position: [0.05, 0, 0.03], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
  const start = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const run = (fps, seconds) => {
    let pose = start;
    for (let i = 0; i < Math.round(fps * seconds); i++) pose = easeToward(pose, seat, SNAP.assistStrength, 1 / fps);
    return pose;
  };
  const gap = (pose) => Math.hypot(...sub(pose.position, seat.position));

  it('glides most of the way into the seat within a quarter second', () => {
    expect(gap(run(60, 0.25))).toBeLessThan(0.15 * gap(start));
  });

  it('feels the same at 30, 60 and 120 fps', () => {
    const at60 = run(60, 0.5);
    for (const fps of [30, 120]) {
      run(fps, 0.5).position.forEach((v, i) => expect(v).toBeCloseTo(at60.position[i], 9));
    }
  });

  it('starts from a seat within reach of the snap search', () => {
    expect(SNAP.assistStrength).toBeGreaterThan(0);
    expect(SNAP.flashMs).toBeGreaterThan(0);
  });
});

describe('Shift-drag lift (AC5)', () => {
  it('spends exactly the vertical travel made under Shift on lift, and none after', () => {
    const g = createGestureState({ tapMaxDistance: 10, tapMaxMs: 300 });
    const hit = { kind: 'part' };
    g.down({ id: 1, x: 0, y: 300, t: 0, hit });
    g.move({ id: 1, x: 20, y: 300, t: 10 });
    g.modifier(true);
    let lifted = 0;
    for (const y of [280, 250, 260, 200]) lifted += g.move({ id: 1, x: 20, y, t: 20 })?.dy ?? 0;
    expect(lifted).toBe(100);
    g.modifier(false);
    expect(g.move({ id: 1, x: 40, y: 180, t: 30 })).toMatchObject({ type: 'dragMove', x: 40, y: 280 });
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.cameraEnabled).toBe(false);
  });

  it('keeps the phone second-finger rate and gives the desktop its own gentler one', () => {
    expect(GESTURE.liftRate).toBe(0.004);
    expect(GESTURE.desktopLiftRate).toBeGreaterThan(0);
    expect(GESTURE.desktopLiftRate).toBeLessThan(GESTURE.liftRate);
  });
});

describe('dollhouse zoom-out keeps its protections (AC6, regression risk)', () => {
  it('never lets the camera through a wall horizontally, nor under the floor', () => {
    for (const point of [[99, -5, 99], [-99, 0, -99], [0, -1, 99]]) {
      const [x, y, z] = clampCamera(point, ROOM, CAMERA_LIMITS);
      expect(Math.abs(x)).toBeLessThanOrEqual(ROOM.width / 2 - CAMERA_LIMITS.wallMargin);
      expect(Math.abs(z)).toBeLessThanOrEqual(ROOM.depth / 2 - CAMERA_LIMITS.wallMargin);
      expect(y).toBeGreaterThan(CAMERA.near);
    }
  });

  it('leaves the walls taller than the standing bookcase', () => {
    expect(ROOM.height).toBeGreaterThan(PART_TYPES.sidePanel.size[1] + GESTURE.ceilingMargin);
  });
});
