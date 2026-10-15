import { describe, expect, it } from 'vitest';
import { PHYSICS, ROOM, STAGE } from '../src/constants.js';
import { LEFT_WALL_PIECES, colliderBoxes, sizeAndCentre, skyRect, stageBoxes, windowBoxes, windowOpening } from '../src/game/stageBoxes.js';
import type { StageBox } from '../src/game/stageBoxes.js';

const by = <N extends string>(boxes: StageBox<N>[], name: string) => boxes.find((box) => box.name === name)!;
const volume = (box: StageBox<string>) => sizeAndCentre(box).size.reduce((a, b) => a * b, 1);
const drawn = stageBoxes();
const w = ROOM.width / 2;
const d = ROOM.depth / 2;

describe('the stage as drawn', () => {
  it('has a slab whose top is the floor at y 0', () => {
    expect(by(drawn, 'slab').max[1]).toBe(0);
    expect(by(drawn, 'slab').min[1]).toBe(-STAGE.slabThickness);
  });

  it('puts the walls\' inner faces at the room\'s back and left edges, outside the footprint', () => {
    expect(by(drawn, 'backWall').max[2]).toBe(-d);
    for (const piece of LEFT_WALL_PIECES) expect(by(drawn, piece).max[0], piece).toBe(-w);
    expect(by(drawn, 'backWall').max[1]).toBe(STAGE.wallHeight);
    expect(by(drawn, 'leftWallAbove').max[1]).toBe(STAGE.wallHeight);
  });

  it('puts the lips on the front and right edges, outside the footprint', () => {
    expect(by(drawn, 'frontLip').min[2]).toBe(d);
    expect(by(drawn, 'rightLip').min[0]).toBe(w);
    expect(by(drawn, 'frontLip').max[1]).toBe(STAGE.lipHeight);
    expect(by(drawn, 'rightLip').max[1]).toBe(STAGE.lipHeight);
  });

  it('leaves the floor footprint clear above y 0 (the trim is visual only, below)', () => {
    for (const { name, min, max } of drawn) {
      if (name === 'slab') continue;
      const overlapsX = min[0] < w && max[0] > -w;
      const overlapsZ = min[2] < d && max[2] > -d;
      expect(overlapsX && overlapsZ, name).toBe(false);
    }
  });

  it('has no open front or right wall', () => {
    expect(drawn.map(({ name }) => name).sort()).toEqual(['backWall', 'frontLip', 'leftWallAbove', 'leftWallBack', 'leftWallBelow', 'leftWallFront', 'rightLip', 'slab']);
  });
});

describe('the window', () => {
  const win = STAGE.window;
  const trim = windowBoxes();
  const { z0, z1, y0, y1 } = windowOpening();

  it('is 1.0 × 1.6 m with its bottom at 0.8 m, centred on z = 0', () => {
    expect(z1 - z0).toBeCloseTo(1.0, 9);
    expect(y1 - y0).toBeCloseTo(1.6, 9);
    expect(y0).toBe(0.8);
    expect((z0 + z1) / 2).toBe(0);
  });

  it('is the old wall minus exactly the opening: four pieces tile it', () => {
    const wall = (ROOM.depth + STAGE.lipThickness) * STAGE.wallHeight * STAGE.wallThickness;
    const opening = (z1 - z0) * (y1 - y0) * STAGE.wallThickness;
    const total = LEFT_WALL_PIECES.reduce((sum, piece) => sum + volume(by(drawn, piece)), 0);
    expect(total).toBeCloseTo(wall - opening, 9);
    for (const piece of LEFT_WALL_PIECES) {
      const b = by(drawn, piece);
      const insideOpening = b.min[2] < z1 && b.max[2] > z0 && b.min[1] < y1 && b.max[1] > y0;
      expect(insideOpening, piece).toBe(false);
    }
  });

  it('puts the casing on the wall\'s inner face, casingProud into the room', () => {
    for (const name of ['casingFront', 'casingBack', 'casingHead']) {
      expect(by(trim, name).min[0], name).toBe(-w);
      expect(by(trim, name).max[0], name).toBeCloseTo(-w + win.casingProud, 9);
    }
    expect(by(trim, 'casingFront').min[2]).toBe(z1);
    expect(by(trim, 'casingBack').max[2]).toBe(z0);
    expect(by(trim, 'casingHead').min[1]).toBe(y1);
  });

  it('puts the sill under the opening, past the casing by sillDepth, with the apron beneath', () => {
    const sill = by(trim, 'sill');
    expect(sill.max[1]).toBe(y0);
    expect(sill.max[0]).toBeCloseTo(-w + win.casingProud + win.sillDepth, 9);
    const apron = by(trim, 'apron');
    expect(apron.max[1]).toBe(sill.min[1]);
    expect(apron.max[0]).toBeCloseTo(-w + win.casingProud, 9);
  });

  it('splits the sashes with a horizontal rail at the opening\'s mid-height and no vertical bar', () => {
    const rail = by(trim, 'rail');
    expect((rail.min[1] + rail.max[1]) / 2).toBeCloseTo((y0 + y1) / 2, 9);
    expect(rail.max[2] - rail.min[2]).toBeGreaterThan(rail.max[1] - rail.min[1]);
    const mid = by(trim, 'rail');
    const bars = trim.filter((b) => b.min[2] > z0 + win.frame && b.max[2] < z1 - win.frame && b.name !== 'rail');
    expect(bars).toEqual([]);
    expect(mid.min[2]).toBe(z0 + win.frame);
  });

  it('keeps all trim at the wall face or in the opening, none behind the wall', () => {
    for (const b of trim) {
      expect(b.min[0], b.name).toBeGreaterThanOrEqual(-w - STAGE.wallThickness);
      expect(b.max[0], b.name).toBeLessThanOrEqual(-w + win.casingProud + win.sillDepth + 1e-9);
    }
  });

  it('stands in the footprint only as casing, sill and apron, no lower than the apron\'s foot', () => {
    const lowest = y0 - win.sillThickness - win.apron;
    for (const b of trim) {
      if (b.max[0] <= -w) continue;
      expect(['casingFront', 'casingBack', 'casingHead', 'sill', 'apron'], b.name).toContain(b.name);
      expect(b.min[1], b.name).toBeGreaterThanOrEqual(lowest - 1e-9);
    }
  });

  it('puts the sky outside the opening, centred on it, facing the room', () => {
    const sky = skyRect();
    expect(sky.centre[0]).toBeLessThan(-w - STAGE.wallThickness);
    expect(sky.centre[1]).toBe((y0 + y1) / 2);
    expect(sky.centre[2]).toBe(0);
    expect(sky.width).toBeGreaterThan(z1 - z0);
    expect(sky.height).toBeGreaterThan(y1 - y0);
  });
});

describe('the stage as colliders', () => {
  const solid = colliderBoxes(PHYSICS.roomColliderThickness);

  it('keeps every inner face where it is drawn', () => {
    expect(by(solid, 'slab').max[1]).toBe(0);
    expect(by(solid, 'backWall').max[2]).toBe(-d);
    expect(by(solid, 'leftWall').max[0]).toBe(-w);
    expect(by(solid, 'frontLip').min[2]).toBe(d);
    expect(by(solid, 'rightLip').min[0]).toBe(w);
  });

  it('carries the walls up to the lift ceiling and leaves the lips as drawn', () => {
    expect(by(solid, 'backWall').max[1]).toBe(ROOM.height);
    expect(by(solid, 'leftWall').max[1]).toBe(ROOM.height);
    expect(by(solid, 'frontLip')).toEqual(by(drawn, 'frontLip'));
    expect(by(solid, 'rightLip')).toEqual(by(drawn, 'rightLip'));
  });

  it('keeps one solid left wall across the opening', () => {
    expect(solid.filter((b) => b.name.startsWith('leftWall'))).toHaveLength(1);
    const { z0, z1, y0, y1 } = windowOpening();
    const left = by(solid, 'leftWall');
    expect(left.min[2]).toBeLessThanOrEqual(z0);
    expect(left.max[2]).toBeGreaterThanOrEqual(z1);
    expect(left.min[1]).toBe(0);
    expect(left.max[1]).toBeGreaterThanOrEqual(y1);
    expect(left.min[1]).toBeLessThanOrEqual(y0);
  });

  it('holds no collider for the trim', () => {
    const names = solid.map(({ name }) => name).sort();
    expect(names).toEqual(['backWall', 'frontLip', 'leftWall', 'rightLip', 'slab']);
  });

  it('is at least as thick as it is drawn, so a fast part cannot tunnel', () => {
    for (const name of ['slab', 'backWall', 'leftWall']) {
      const axis = by(solid, name).outward.findIndex((v) => v !== 0);
      expect(sizeAndCentre(by(solid, name)).size[axis], name).toBeGreaterThanOrEqual(PHYSICS.roomColliderThickness);
    }
  });
});
