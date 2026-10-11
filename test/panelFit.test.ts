import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, rotateVector } from '../tools/validate/lib/geometry.js';
import { PANEL } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { findFits, isPanelType } from '../src/game/panelFit.js';
import type { WorldConnector } from '../src/game/snapMath.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';

// Whole-panel fit (1.8.3.1) on JOHNNY's real catalog: a side panel lying flat, holes up,
// dowels standing in its two bottom dowel holes, and the bottom panel carried onto them.

const DEG = Math.PI / 180;
const HALF_TURN_Z: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // the side panel's hole faces up
const SIDE: Pose = { position: [0, 0.008, 0], rotation: HALF_TURN_Z };
const DOWEL_LENGTH = PART_TYPES.dowel.size[1];
// The bottom panel's local +x (its right-hand holes' axis) pointing down.
const HOLES_DOWN: Quat = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];

const world = (type: string, pose: Pose): WorldConnector[] =>
  PART_TYPES[type].connectors.map((c) => ({ type: c.type, ...connectorInWorld(c, pose) }));

// The free top end of a dowel standing in side-panel hole `index`, seated at its mouth.
function dowelTop(index: number): WorldConnector {
  const hole = world('sidePanel', SIDE)[index];
  return { type: CONNECTOR.DOWEL_END, position: hole.position.map((v, i) => v + hole.axis[i] * DOWEL_LENGTH) as Vec3, axis: hole.axis };
}

const ENDS = [dowelTop(0), dowelTop(1)];
// The bottom panel seated on both: its holes 3 and 4 on the dowels' top ends.
const SEAT: Pose = (() => {
  const local = PART_TYPES.topBottomPanel.connectors[3].position;
  const offset = rotateVector(HOLES_DOWN, local);
  return { position: ENDS[0].position.map((v, i) => v - offset[i]) as Vec3, rotation: HOLES_DOWN };
})();

// `pose` turned by `angle` about the vertical line through `centre`, and moved by `shift`.
function skewed(pose: Pose, angle: number, centre: Vec3, shift: Vec3 = [0, 0, 0]): Pose {
  const turn: Quat = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const arm = rotateVector(turn, pose.position.map((v, i) => v - centre[i]) as Vec3);
  return {
    position: arm.map((v, i) => v + centre[i] + shift[i]) as Vec3,
    rotation: multiplyQuaternions(turn, pose.rotation),
  };
}

const angleBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('findFits (1.8.3.1 Step 1)', () => {
  it('fits a panel skewed 30° about its first dowel onto both dowels, its spin solved', () => {
    const from = skewed(SEAT, 30 * DEG, ENDS[0].position, [0.02, 0.03, 0]);
    const fits = findFits(world('topBottomPanel', from), from, ENDS, PANEL);
    const both = fits.filter((fit) => fit.pairs.length === 2);
    expect(both).toHaveLength(1);
    const [fit] = both;
    expect(gap(fit.pose.position, SEAT.position)).toBeLessThan(1e-6);
    expect(angleBetween(fit.pose.rotation, SEAT.rotation)).toBeLessThan(1e-6);
    expect(fit.pairs.map((p) => p.end).sort((a, b) => ENDS.indexOf(a) - ENDS.indexOf(b))).toEqual(ENDS);
    expect(new Set(fit.pairs.map((p) => p.hole.type))).toEqual(new Set([CONNECTOR.DOWEL_HOLE]));
  });

  it('gives a one-pair fit on a single dowel', () => {
    const from = skewed(SEAT, 10 * DEG, ENDS[0].position, [0, 0.03, 0]);
    const fits = findFits(world('topBottomPanel', from), from, [ENDS[0]], PANEL);
    expect(fits.length).toBeGreaterThan(0);
    for (const fit of fits) expect(fit.pairs).toHaveLength(1);
  });

  it('offers nothing outside the window', () => {
    const far = { ...SEAT, position: SEAT.position.map((v, i) => v + (i === 1 ? PANEL.maxDistance + 0.01 : 0)) as Vec3 };
    expect(findFits(world('topBottomPanel', far), far, ENDS, PANEL)).toEqual([]);
    // Tipped past maxAngle about the x axis through the first dowel's end.
    const tilt = PANEL.maxAngle + 5 * DEG;
    const turn: Quat = [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)];
    const centre = ENDS[0].position;
    const arm = rotateVector(turn, SEAT.position.map((v, i) => v - centre[i]) as Vec3);
    const tipped: Pose = { position: arm.map((v, i) => v + centre[i]) as Vec3, rotation: multiplyQuaternions(turn, SEAT.rotation) };
    expect(findFits(world('topBottomPanel', tipped), tipped, ENDS, PANEL)).toEqual([]);
  });

  it('never pairs an end that does not take the hole', () => {
    const bolt: WorldConnector = { ...ENDS[1], type: CONNECTOR.BOLT_THREAD };
    const from = skewed(SEAT, 20 * DEG, ENDS[0].position);
    const fits = findFits(world('topBottomPanel', from), from, [ENDS[0], bolt], PANEL);
    expect(fits.length).toBeGreaterThan(0);
    for (const fit of fits) expect(fit.pairs.map((p) => p.end)).not.toContain(bolt);
  });
});

describe('isPanelType (1.8.3.1 Step 1)', () => {
  it('is true for the panels that carry holes', () => {
    for (const type of ['sidePanel', 'topBottomPanel', 'fixedShelf', 'plinth', 'backPanel']) expect(isPanelType(PART_TYPES[type]), type).toBe(true);
  });

  it('is false for hardware, tools, and parts with no connectors (the lid, the base)', () => {
    for (const type of ['dowel', 'camLockBolt', 'camLock', 'shelfPin', 'backFitting', 'allenWrench', 'screwdriver', 'boxLid', 'boxBase', 'adjustableShelf']) {
      expect(isPanelType(PART_TYPES[type]), type).toBe(false);
    }
  });
});
