import { describe, expect, it } from 'vitest';
import { CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { connectorInWorld, multiplyQuaternions, rotateVector } from '../tools/validate/lib/geometry.js';
import { PANEL } from '../src/constants.js';
import { ASSEMBLED, PART_TYPES } from '../src/game/item.js';
import { findFits, heldOffer, isPanelType, preferredPoses, preferredRelatives, preferredTargets, preferredThrough, rankFits } from '../src/game/panelFit.js';
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

  // Review round 1: one dowel tapped home a sink lower, the other still proud.
  it('pairs both holes over dowels standing at different depths', () => {
    const home: WorldConnector = { ...ENDS[0], position: [ENDS[0].position[0], ENDS[0].position[1] - 0.015, ENDS[0].position[2]] };
    const from = skewed(SEAT, 20 * DEG, ENDS[1].position, [0.02, 0.03, 0]);
    const fits = findFits(world('topBottomPanel', from), from, [home, ENDS[1]], PANEL);
    expect(fits.filter((fit) => fit.pairs.length === 2)).toHaveLength(1);
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

describe('where it goes, and ranking (1.8.3.1 Step 2)', () => {
  const relatives = preferredRelatives(ASSEMBLED, PART_TYPES);
  const assembled = (id: string) => ASSEMBLED.parts.find((part) => part.id === id)!;
  // Where the bottom panel goes on the flat side panel.
  const preferred = preferredPoses(relatives, 'sidePanel', SIDE, 'topBottomPanel');

  it("places the bottom panel on a side panel as the finished JOHNNY has it", () => {
    const side = assembled('sidePanel-1');
    const bottom = assembled('topBottomPanel-1');
    const poses = preferredPoses(relatives, 'sidePanel', side, 'topBottomPanel');
    expect(poses.some((pose) => gap(pose.position, bottom.position) < 1e-9 && angleBetween(pose.rotation, bottom.rotation) < 1e-6)).toBe(true);
    // Either side panel counts: the other one's pairing is kept too.
    const other = preferredPoses(relatives, 'sidePanel', assembled('sidePanel-2'), 'topBottomPanel');
    expect(other.some((pose) => gap(pose.position, bottom.position) < 1e-9 && angleBetween(pose.rotation, bottom.rotation) < 1e-6)).toBe(true);
    // Hardware is never a host or a panel.
    expect(relatives.has('dowel')).toBe(false);
    for (const byPanel of relatives.values()) expect(byPanel.has('dowel')).toBe(false);
  });

  it('ranks where it goes first, and still offers a fit one hole off after it', () => {
    // Halfway between the right seat and one hole along: both in the window.
    const from = { ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.03, SEAT.position[2] + 0.09] as Vec3 };
    const ranked = rankFits(findFits(world('topBottomPanel', from), from, ENDS, PANEL), preferred, PANEL);
    expect(ranked[0].preferred).toBe(true);
    expect(ranked[0].pairs).toHaveLength(2);
    expect(gap(ranked[0].pose.position, SEAT.position)).toBeLessThan(1e-6);
    // Its hole 3 on the dowel where hole 4 belongs: one pair, not where it goes.
    const hole3 = world('topBottomPanel', from)[3];
    const off = ranked.findIndex(({ pairs: [first, ...rest] }) => rest.length === 0 && first.end === ENDS[1] && gap(first.hole.position, hole3.position) < 1e-9);
    expect(off).toBeGreaterThan(0);
    expect(ranked[off].preferred).toBe(false);
  });

  it('with nothing where it goes, ranks the fit with the most pairs first, then the nearest', () => {
    const from = { ...SEAT, position: [SEAT.position[0], SEAT.position[1] + 0.03, SEAT.position[2] + 0.09] as Vec3 };
    const ranked = rankFits(findFits(world('topBottomPanel', from), from, ENDS, PANEL), [], PANEL);
    expect(ranked.every((fit) => !fit.preferred)).toBe(true);
    expect(ranked[0].pairs).toHaveLength(2);
    for (let i = 1; i < ranked.length; i++) {
      const [a, b] = [ranked[i - 1], ranked[i]];
      expect(a.pairs.length > b.pairs.length || (a.pairs.length === b.pairs.length && a.distance <= b.distance)).toBe(true);
    }
  });

  it('finds the dowel ends where it goes, standing proud or not', () => {
    const at = preferred.find((pose) => angleBetween(pose.rotation, SEAT.rotation) < 1e-6)!;
    expect(preferredTargets(world('topBottomPanel', at), ENDS, PANEL)).toEqual(ENDS);
    // Pushed home: each end a dowel sink lower.
    const home = ENDS.map((end) => ({ ...end, position: [end.position[0], end.position[1] - 0.015, end.position[2]] as Vec3 }));
    expect(preferredTargets(world('topBottomPanel', at), home, PANEL)).toEqual(home);
    // Nowhere near: nothing.
    const away = { ...at, position: [at.position[0] + 0.5, at.position[1], at.position[2]] as Vec3 };
    expect(preferredTargets(world('topBottomPanel', away), ENDS, PANEL)).toEqual([]);
  });
});

describe('where it goes through a panel it carries (1.8.3.4 Step 3)', () => {
  const byRole = (id: string): Pose => ASSEMBLED.parts.find((part) => part.id === id)!;
  const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const turn = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
  // A rigid move: a quarter turn about a tilted axis, then a shift.
  const SPIN: Quat = (() => {
    const axis: Vec3 = [0.3, 0.8, -0.5];
    const n = Math.hypot(...axis);
    const s = Math.sin(Math.PI / 4);
    return [(axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s, Math.cos(Math.PI / 4)];
  })();
  const moved = ({ position, rotation }: Pose): Pose => ({
    position: rotateVector(SPIN, position).map((v, i) => v + [0.7, 0.2, -1.1][i]) as Vec3,
    rotation: multiplyQuaternions(SPIN, rotation),
  });

  it("maps a member at its assembled place to the grabbed panel's assembled place", () => {
    // The fixed shelf and the bottom panel picked up together, as they sit in the finished
    // JOHNNY but anywhere in the room: the shelf where it goes puts the bottom panel where it goes.
    const shelf = byRole('fixedShelf-1');
    const bottom = byRole('topBottomPanel-1');
    const pose = preferredThrough(shelf, moved(shelf), moved(bottom));
    expect(gap(pose.position, bottom.position)).toBeLessThan(1e-9);
    expect(turn(pose.rotation, bottom.rotation)).toBeLessThan(1e-6);
  });

  it('is the identity for the grabbed panel itself', () => {
    const bottom = moved(byRole('topBottomPanel-1'));
    const pose = preferredThrough(bottom, bottom, bottom);
    expect(gap(pose.position, bottom.position)).toBeLessThan(1e-9);
    expect(turn(pose.rotation, bottom.rotation)).toBeLessThan(1e-6);
  });
});

// 1.8.3.4 phone finding 1: a fit on offer holds, so a trembling finger, the line easing or a
// nudged carcass never flips it frame to frame.
describe('heldOffer: the fit on offer holds (1.8.3.4 phone finding 1)', () => {
  const WINDOW = { holdReach: PANEL.holdReach, holdTurn: PANEL.holdTurn, offerMargin: PANEL.offerMargin };
  const turned = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const finger = (x: number, rotation: Quat = [0, 0, 0, 1]): Pose => ({ position: [x, 0, 0], rotation });
  // An offer seating the panel at x, as `key`; taken with the finger at `taken`, if on offer already.
  const offer = (key: string, x: number, { preferred = false, pairs = 2, taken = null as Pose | null } = {}) => ({
    key,
    position: [x, 0.3, 0] as Vec3,
    rotation: [0, 0, 0, 1] as Quat,
    preferred,
    pairs: Array.from({ length: pairs }, () => ({ hole: { type: CONNECTOR.DOWEL_HOLE, position: [0, 0, 0] as Vec3, axis: [0, 1, 0] as Vec3 }, end: { type: CONNECTOR.DOWEL_END, position: [0, 0, 0] as Vec3, axis: [0, -1, 0] as Vec3 } })),
    ...(taken ? { taken } : {}),
  });

  it('takes the first offer, noting where the finger had the panel; none while none is found', () => {
    const next = offer('a', 0.05);
    expect(heldOffer(null, next, finger(0), WINDOW)).toEqual({ ...next, taken: finger(0) });
    expect(heldOffer(null, null, finger(0), WINDOW)).toBeNull();
  });

  it('keeps the offer through a gap in the search while the finger stays near where it was taken', () => {
    const current = offer('a', 0.6, { taken: finger(0) });
    // The fit's own swing puts it far from the finger: that never lets it go.
    expect(heldOffer(current, null, finger(PANEL.holdReach - 0.01), WINDOW)).toBe(current);
  });

  it('lets it go once the finger has moved, or turned, the panel out of the window since', () => {
    const current = offer('a', 0, { taken: finger(0) });
    expect(heldOffer(current, null, finger(PANEL.holdReach + 0.01), WINDOW)).toBeNull();
    const next = offer('b', 0.01);
    const turn = finger(0, turned(PANEL.holdTurn + 0.05));
    expect(heldOffer(current, next, turn, WINDOW)).toEqual({ ...next, taken: turn });
  });

  it('keeps the same fit found again as it was offered — seat assist never chases its seats', () => {
    const current = offer('a', 0.03, { taken: finger(0) });
    expect(heldOffer(current, offer('a', 0.05), finger(0.01), WINDOW)).toBe(current);
  });

  it('takes the same fit found again once it has come to be where it goes', () => {
    const current = offer('a', 0.03, { taken: finger(0) });
    const now = offer('a', 0.04, { preferred: true });
    expect(heldOffer(current, now, finger(0.01), WINDOW)).toEqual({ ...now, taken: finger(0) });
  });

  it('holds against another fit as good — the same place by other pairs — unless clearly nearer', () => {
    const current = offer('a', 0.03, { taken: finger(0) });
    expect(heldOffer(current, offer('b', 0.03), finger(0.02), WINDOW)).toBe(current);
    expect(heldOffer(current, offer('b', 0.03 - PANEL.offerMargin / 2), finger(0), WINDOW)).toBe(current);
    const slid = offer('b', 0.1);
    const far = offer('a', 0.5, { taken: finger(0) });
    expect(heldOffer(far, slid, finger(0.05), WINDOW)).toEqual({ ...slid, taken: finger(0.05) });
  });

  it('gives way to where it goes, and to more pairs, but never the other way', () => {
    const wrong = offer('a', 0.01, { taken: finger(0) });
    const right = offer('b', 0.1, { preferred: true });
    expect(heldOffer(wrong, right, finger(0), WINDOW)).toEqual({ ...right, taken: finger(0) });
    expect(heldOffer({ ...right, taken: finger(0) }, offer('a', 0.01), finger(0), WINDOW)).toEqual({ ...right, taken: finger(0) });
    const fewer = offer('a', 0.01, { taken: finger(0) });
    const more = offer('c', 0.1, { pairs: 3 });
    expect(heldOffer(fewer, more, finger(0), WINDOW)).toEqual({ ...more, taken: finger(0) });
    expect(heldOffer({ ...more, taken: finger(0) }, offer('a', 0.01), finger(0), WINDOW)).toEqual({ ...more, taken: finger(0) });
  });
});
