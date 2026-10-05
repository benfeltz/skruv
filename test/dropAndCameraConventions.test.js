// Automated half of the 1.4.1 test plan for review rounds 3–7 (Ben's chat feedback): the
// drop guide's hole glow and the reworked camera, checked against the real catalog, dev
// layout and shipped constants. Feel (drag, pinch, orbit) is manual — see Test Plan.md.

import { describe, expect, it } from 'vitest';
import { CAMERA, CAMERA_LIMITS, DECAL, DROP, ROOM } from '../src/constants.js';
import { PART_TYPES } from '../src/game/catalog.js';
import { decalPlacements, socketUnder } from '../src/game/decals.js';
import { createDevLayout } from '../src/game/devLayout.js';
import { rotateVector } from '../src/game/snapMath.js';
import { clampCamera, clampTarget, clampTargetAlongView, panSpeedAt, seatOnFloor } from '../src/scene/cameraLimits.js';

const add = (a, b) => a.map((v, i) => v + b[i]);
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

describe('drop-line hole glow is never ambiguous (round 3)', () => {
  it.each(Object.entries(PART_TYPES).filter(([, p]) => decalPlacements(p.connectors).length > 1))(
    '%s: no two holes are both within reach of one landing spot',
    (_, part) => {
      const holes = decalPlacements(part.connectors).map((d) => part.connectors[d.index].position);
      for (let i = 0; i < holes.length; i++) {
        for (let j = i + 1; j < holes.length; j++) expect(dist(holes[i], holes[j])).toBeGreaterThan(2 * DROP.holeReach);
      }
    },
  );

  it('counts a landing anywhere on a hole marking as over that hole', () => {
    for (const radius of Object.values(DECAL.radius)) expect(DROP.holeReach).toBeGreaterThanOrEqual(radius);
  });

  it('keeps the drop glow dimmer than the seat flash, so a seat still reads', () => {
    expect(DROP.glowIntensity).toBeGreaterThan(0);
    expect(DROP.glowIntensity).toBeLessThan(1);
  });

  // The side panels as the dev layout lays them, holes up: a drop a few mm off any hole
  // lights that hole; a drop on bare panel lights none.
  const side = createDevLayout().find(({ id }) => id === 'sidePanel-1');
  const sockets = PART_TYPES.sidePanel.connectors
    .map((c, index) => ({ index, type: c.type, position: add(side.position, rotateVector(side.rotation, c.position)) }));

  it.each(sockets.map((s) => [s.index, s]))('a drop 4 mm off side-panel hole #%s lights that hole', (_, socket) => {
    expect(socketUnder(add(socket.position, [0.003, 0, -0.0026]), sockets, DROP.holeReach)).toBe(socket);
  });

  it('a drop on bare panel between the holes lights nothing', () => {
    expect(socketUnder(side.position, sockets, DROP.holeReach)).toBeNull();
  });
});

describe('shipped camera, from the first frame (rounds 4–6)', () => {
  const eye = CAMERA.startPosition;
  const seated = seatOnFloor(eye, CAMERA.startTarget, CAMERA_LIMITS);

  it('orbits about the floor spot in view from the start, within zoom-out range', () => {
    expect(seated[1]).toBeCloseTo(CAMERA_LIMITS.targetHeight[0], 9);
    expect(dist(eye, seated)).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
    expect(clampTarget(seated, ROOM, CAMERA_LIMITS)).toEqual(seated);
  });

  it('can bring the camera to within minDistance of any part laid out on the floor', () => {
    for (const { position: [x, , z] } of createDevLayout()) {
      // Target on the part, camera minDistance back along a 60° line of sight.
      const target = [x, 0, z];
      const camera = add(target, [0, CAMERA_LIMITS.minDistance * Math.cos(Math.PI / 3), CAMERA_LIMITS.minDistance * Math.sin(Math.PI / 3)]);
      expect(clampTargetAlongView(target, camera, ROOM, CAMERA_LIMITS)).toEqual(target);
      expect(clampCamera(camera, ROOM, CAMERA_LIMITS)).toEqual(camera);
    }
  });

  it('pans at a usable rate across the whole zoom range', () => {
    const { minDistance, panReference } = CAMERA_LIMITS;
    // Ground a swipe covers is distance × speed: never slowed, and at the closest zoom at
    // least a third of what it covers at the reference distance.
    for (const d of [minDistance, 0.3, 0.6, 1, panReference, 3]) expect(panSpeedAt(d, CAMERA_LIMITS)).toBeGreaterThanOrEqual(1);
    expect(minDistance * panSpeedAt(minDistance, CAMERA_LIMITS)).toBeGreaterThanOrEqual(panReference / 3);
  });

  it('keeps the floor clearance above the near plane, so a low close-up never clips the floor', () => {
    expect(CAMERA_LIMITS.floorClearance).toBeGreaterThan(CAMERA.near);
  });

  it('lets a zoomed-out camera rise over the 3 m walls while staying inside them', () => {
    const high = clampCamera([0, CAMERA_LIMITS.maxDistance, 99], ROOM, CAMERA_LIMITS);
    expect(high[1]).toBeGreaterThan(ROOM.height);
    expect(Math.abs(high[2])).toBeLessThanOrEqual(ROOM.depth / 2 - CAMERA_LIMITS.wallMargin);
  });
});
