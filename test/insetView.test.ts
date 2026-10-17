import { describe, expect, it } from 'vitest';
import { INSET } from '../src/constants.js';
import { insetCameraPose, insetFrame, insetLayout, insetOrtho, insideInset, ringReach } from '../src/game/insetView.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3) => Math.hypot(...a);

describe('insetLayout', () => {
  it('flips at the square', () => {
    expect(insetLayout({ width: 390, height: 844 })).toBe('portrait');
    expect(insetLayout({ width: 844, height: 390 })).toBe('landscape');
    expect(insetLayout({ width: 600, height: 600 })).toBe('landscape');
  });
});

describe('insetFrame', () => {
  it('sits top-centre in portrait, its diameter a share of the shorter side', () => {
    const { centre, radius } = insetFrame({ width: 390, height: 844 });
    expect(radius * 2).toBeCloseTo(0.42 * 390);
    expect(centre[0]).toBe(195);
    expect(centre[1]).toBeCloseTo(INSET.portrait.top + ringReach() + radius);
  });

  it('clamps the diameter to the layout’s min and max', () => {
    expect(insetFrame({ width: 200, height: 400 }).radius * 2).toBe(INSET.portrait.min);
    expect(insetFrame({ width: 1200, height: 2000 }).radius * 2).toBe(INSET.portrait.max);
    expect(insetFrame({ width: 400, height: 200 }).radius * 2).toBe(INSET.landscape.min);
    expect(insetFrame({ width: 2000, height: 1200 }).radius * 2).toBe(INSET.landscape.max);
  });

  it('keeps the portrait circle below the top safe inset', () => {
    const { centre, radius } = insetFrame({ width: 390, height: 844 }, { top: 47, right: 0 });
    expect(centre[1] - radius - ringReach()).toBeCloseTo(47 + INSET.portrait.top);
  });

  it('sits on the right under the cluster in landscape, clear of the safe insets', () => {
    const viewport = { width: 844, height: 390 };
    const { centre, radius } = insetFrame(viewport, { top: 0, right: 47 });
    expect(centre[0] + radius + ringReach()).toBeCloseTo(844 - 47 - INSET.landscape.right);
    expect(centre[1] - radius - ringReach()).toBeCloseTo(INSET.landscape.top);
    expect(centre[1] + radius + ringReach()).toBeLessThan(viewport.height);
  });

  // The turn ring encircles the circle: its whole grab band must stay on screen, and inside the clearance the
  // circle alone had from the safe insets and the control cluster, in both orientations.
  it.each([
    [320, 568],
    [390, 844],
    [800, 1000],
    [568, 320],
    [844, 390],
    [1000, 800],
  ])('leaves the turn ring’s band on screen and inside the old clearances at %i x %i', (width, height) => {
    const safe = { top: 47, right: 20 };
    const viewport = { width, height };
    const { centre, radius } = insetFrame(viewport, safe);
    const outer = radius + ringReach();
    const layout = insetLayout(viewport);
    expect(centre[0] - outer).toBeGreaterThanOrEqual(0);
    expect(centre[0] + outer).toBeLessThanOrEqual(width - safe.right);
    expect(centre[1] + outer).toBeLessThanOrEqual(height);
    expect(centre[1] - outer).toBeCloseTo(safe.top + INSET[layout].top, 6);
    if (layout === 'landscape') expect(centre[0] + outer).toBeCloseTo(width - safe.right - INSET.landscape.right, 6);
  });

  it('takes its layout from the argument when given', () => {
    const forced = insetFrame({ width: 390, height: 844 }, undefined, 'landscape');
    expect(forced.centre[0]).toBeGreaterThan(195);
  });
});

describe('insideInset', () => {
  const frame = { centre: [100, 100] as [number, number], radius: 50 };
  it('is true on the rim and inside, false just outside', () => {
    expect(insideInset([150, 100], frame)).toBe(true);
    expect(insideInset([100, 100], frame)).toBe(true);
    expect(insideInset([150.5, 100], frame)).toBe(false);
    expect(insideInset([135, 135], frame)).toBe(true);
    expect(insideInset([136, 136], frame)).toBe(false);
  });
});

describe('insetCameraPose', () => {
  const tilt = (INSET.camera.tilt * Math.PI) / 180;

  it('looks at a vertical screw from above and toward the side the main camera faces', () => {
    // The main camera sits on the +z side looking toward -z; the screw goes down into its hole.
    const pose = insetCameraPose([0.1, 0.5, 0.2], [0, -1, 0], [0, 0, -1]);
    const direction = sub(pose.target, pose.position);
    expect(norm(direction)).toBeCloseTo(INSET.camera.distance);
    expect(pose.position[1]).toBeGreaterThan(0.5);
    expect(pose.position[2]).toBeGreaterThan(0.2);
    expect(pose.position[0]).toBeCloseTo(0.1);
    const unit = direction.map((v) => v / INSET.camera.distance) as Vec3;
    expect(dot(unit, [0, -1, 0])).toBeCloseTo(Math.cos(tilt));
  });

  it('keeps up perpendicular to the view direction and unit length', () => {
    const pose = insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, -1]);
    const direction = sub(pose.target, pose.position);
    expect(dot(pose.up, direction)).toBeCloseTo(0);
    expect(norm(pose.up)).toBeCloseTo(1);
    expect(pose.up[1]).toBeGreaterThan(0);
  });

  it('turns toward the azimuth’s side, so a camera on the other side flips the tilt', () => {
    const a = insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, -1]);
    const b = insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, 1]);
    expect(a.position[2]).toBeGreaterThan(0);
    expect(b.position[2]).toBeLessThan(0);
  });

  it('uses only the part of the azimuth perpendicular to the hole', () => {
    const pose = insetCameraPose([0, 0, 0], [0, -1, 0], [0.6, -0.5, -0.4]);
    const direction = sub(pose.target, pose.position);
    const unit = direction.map((v) => v / INSET.camera.distance) as Vec3;
    expect(dot(unit, [0, -1, 0])).toBeCloseTo(Math.cos(tilt));
  });

  it('falls back to world up when the azimuth runs along the hole', () => {
    const pose = insetCameraPose([0, 0, 0], [0, 0, -1], [0, 0, -1]);
    for (const v of [...pose.position, ...pose.up]) expect(Number.isFinite(v)).toBe(true);
    const direction = sub(pose.target, pose.position);
    expect(dot(direction.map((v) => v / INSET.camera.distance) as Vec3, [0, 0, -1])).toBeCloseTo(Math.cos(tilt));
    expect(dot(pose.up, direction)).toBeCloseTo(0);
  });

  it('stays finite when the azimuth is zero and the hole is vertical', () => {
    const pose = insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, 0]);
    for (const v of [...pose.position, ...pose.up]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('insetOrtho', () => {
  it('frames frameHeight metres tall with depth either side of the joint', () => {
    const o = insetOrtho();
    expect(o.top - o.bottom).toBeCloseTo(INSET.camera.frameHeight);
    expect(o.right - o.left).toBeCloseTo(INSET.camera.frameHeight);
    expect(o.near).toBeCloseTo(INSET.camera.distance - INSET.depth);
    expect(o.far).toBeCloseTo(INSET.camera.distance + INSET.depth);
  });

  it('widens by the aspect', () => {
    const o = insetOrtho(0.2, 2);
    expect(o.right - o.left).toBeCloseTo(0.4);
  });
});
