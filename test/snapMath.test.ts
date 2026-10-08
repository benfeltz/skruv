import { describe, expect, it } from 'vitest';
import { areCompatible, COMPATIBLE, CONNECTOR } from '../tools/validate/lib/vocabulary.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import { SNAP } from '../src/constants.js';
import { applyTransform, findSnap } from '../src/game/snapMath.js';
import type { SnapTransform, WorldConnector } from '../src/game/snapMath.js';
import type { Pose, Quat, Vec3 } from '../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../tools/validate/lib/vocabulary.js';

const DEG = Math.PI / 180;
const TOL = { maxDistance: 0.05, maxAngle: 30 * DEG };
const c = (type: ConnectorType, position: Vec3, axis: Vec3): WorldConnector => ({ type, position, axis });
const expectVec = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));

// A hole in a panel's top face, mouth facing up.
const HOLE = c(CONNECTOR.DOWEL_HOLE, [1, 0.016, 2], [0, 1, 0]);

describe('type compatibility', () => {
  it('pairs every fastener end with its hole, in either direction', () => {
    expect(areCompatible(CONNECTOR.DOWEL_END, CONNECTOR.DOWEL_HOLE)).toBe(true);
    expect(areCompatible(CONNECTOR.DOWEL_HOLE, CONNECTOR.DOWEL_END)).toBe(true);
    expect(areCompatible(CONNECTOR.CAM_LOCK_BODY, CONNECTOR.CAM_LOCK_RECESS)).toBe(true);
    expect(areCompatible(CONNECTOR.BACK_FITTING_HOLE, CONNECTOR.BACK_FITTING_TIP)).toBe(true);
    expect(areCompatible(CONNECTOR.WRENCH_TIP, CONNECTOR.BOLT_HEAD)).toBe(true);
  });

  it('never pairs incompatible types', () => {
    expect(areCompatible(CONNECTOR.DOWEL_END, CONNECTOR.CAM_BOLT_HOLE)).toBe(false);
    expect(areCompatible(CONNECTOR.DOWEL_HOLE, CONNECTOR.DOWEL_HOLE)).toBe(false);
    expect(areCompatible(CONNECTOR.BACK_FITTING_TIP, CONNECTOR.SHELF_PIN_HOLE)).toBe(false);
    expect(areCompatible(CONNECTOR.PIN_TIP, CONNECTOR.BACK_FITTING_HOLE)).toBe(false);
  });

  it('pairs the screwdriver tip with a cam slot and nothing else', () => {
    expect(areCompatible(CONNECTOR.SCREWDRIVER_TIP, CONNECTOR.CAM_SLOT)).toBe(true);
    expect(areCompatible(CONNECTOR.CAM_SLOT, CONNECTOR.SCREWDRIVER_TIP)).toBe(true);
    const others = Object.values(CONNECTOR).filter((t) => t !== CONNECTOR.CAM_SLOT);
    for (const type of others) expect(areCompatible(CONNECTOR.SCREWDRIVER_TIP, type)).toBe(false);
    // The allen wrench keeps hex bolts; it never turns a cam.
    expect(areCompatible(CONNECTOR.WRENCH_TIP, CONNECTOR.CAM_SLOT)).toBe(false);
  });

  it('covers every catalog connector type exactly once', () => {
    const covered = [...Object.keys(COMPATIBLE), ...Object.values(COMPATIBLE)].sort();
    expect(covered).toEqual(Object.values(CONNECTOR).sort());
  });
});

describe('findSnap', () => {
  it('finds a compatible pair within tolerance', () => {
    const end = c(CONNECTOR.DOWEL_END, [1.02, 0.04, 2], [0, -1, 0]);
    const snap = findSnap([end], [HOLE], TOL)!;
    expect(snap).toMatchObject({ from: end, to: HOLE });
    expect(snap.distance).toBeCloseTo(Math.hypot(0.02, 0.024));
    expect(snap.angle).toBeCloseTo(0);
  });

  it('never matches incompatible types, however close', () => {
    const bolt = c(CONNECTOR.BOLT_THREAD, HOLE.position, [0, -1, 0]);
    expect(findSnap([bolt], [HOLE], TOL)).toBeNull();
  });

  it('rejects a pair just outside the distance tolerance', () => {
    const inside = c(CONNECTOR.DOWEL_END, [1, 0.016 + 0.0499, 2], [0, -1, 0]);
    const outside = c(CONNECTOR.DOWEL_END, [1, 0.016 + 0.0501, 2], [0, -1, 0]);
    expect(findSnap([inside], [HOLE], TOL)).not.toBeNull();
    expect(findSnap([outside], [HOLE], TOL)).toBeNull();
  });

  it('rejects a pair just outside the angle tolerance', () => {
    const tilted = (deg: number): Vec3 => [Math.sin(deg * DEG), -Math.cos(deg * DEG), 0];
    expect(findSnap([c(CONNECTOR.DOWEL_END, [1, 0.03, 2], tilted(29.9))], [HOLE], TOL)).not.toBeNull();
    expect(findSnap([c(CONNECTOR.DOWEL_END, [1, 0.03, 2], tilted(30.1))], [HOLE], TOL)).toBeNull();
  });

  it('rejects an end pointing out of the hole rather than into it', () => {
    expect(findSnap([c(CONNECTOR.DOWEL_END, [1, 0.03, 2], [0, 1, 0])], [HOLE], TOL)).toBeNull();
  });

  it('picks the nearest of several candidates', () => {
    const far = c(CONNECTOR.DOWEL_HOLE, [1.03, 0.016, 2], [0, 1, 0]);
    const near = c(CONNECTOR.DOWEL_HOLE, [1.01, 0.016, 2], [0, 1, 0]);
    const end = c(CONNECTOR.DOWEL_END, [1, 0.03, 2], [0, -1, 0]);
    expect(findSnap([end], [far, near], TOL)!.to).toBe(near);
  });

  it('returns a transform that seats the connector and anti-aligns the axes', () => {
    const axis: Vec3 = [Math.sin(20 * DEG), -Math.cos(20 * DEG), 0];
    const end = c(CONNECTOR.DOWEL_END, [1.01, 0.04, 2.01], axis);
    const { transform } = findSnap([end], [HOLE], TOL)!;
    const moved = add(rotateVector(transform.rotation, end.position), transform.translation);
    expectVec(moved, HOLE.position);
    expectVec(rotateVector(transform.rotation, end.axis), [0, -1, 0]);
  });

  it('uses generous-first tolerances by default', () => {
    expect(SNAP.maxDistance).toBeGreaterThan(0);
    expect(SNAP.maxAngle).toBeGreaterThan(0);
  });
});

describe('applyTransform', () => {
  it('carries a body pose so its connector lands on the target', () => {
    // Body at the origin, unrotated; its connector sits 0.015 below the centre.
    const pose: Pose = { position: [1.01, 0.05, 2], rotation: [0, 0, 0, 1] };
    const end = c(CONNECTOR.DOWEL_END, [1.01, 0.035, 2], [0, -1, 0]);
    const { transform } = findSnap([end], [HOLE], TOL)!;
    const seated = applyTransform(transform, pose);
    expectVec(seated.position, [1, 0.031, 2]);
    expectVec(seated.rotation, [0, 0, 0, 1]);
  });

  it('composes the correction onto the body rotation', () => {
    const quarterY: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const transform: SnapTransform = { rotation: quarterY, translation: [0, 0, 0] };
    const { rotation } = applyTransform(transform, { position: [0, 0, 0], rotation: quarterY });
    expectVec(rotateVector(rotation, [1, 0, 0]), [-1, 0, 0]);
  });
});

function add(a: number[], b: number[]) {
  return a.map((v, i) => v + b[i]);
}
