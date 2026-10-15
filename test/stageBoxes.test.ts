import { describe, expect, it } from 'vitest';
import { PHYSICS, ROOM, STAGE } from '../src/constants.js';
import { colliderBoxes, sizeAndCentre, stageBoxes } from '../src/game/stageBoxes.js';
import type { StageBox } from '../src/game/stageBoxes.js';

const by = (boxes: StageBox[], name: string) => boxes.find((box) => box.name === name)!;
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
    expect(by(drawn, 'leftWall').max[0]).toBe(-w);
    expect(by(drawn, 'backWall').max[1]).toBe(STAGE.wallHeight);
    expect(by(drawn, 'leftWall').max[1]).toBe(STAGE.wallHeight);
  });

  it('puts the lips on the front and right edges, outside the footprint', () => {
    expect(by(drawn, 'frontLip').min[2]).toBe(d);
    expect(by(drawn, 'rightLip').min[0]).toBe(w);
    expect(by(drawn, 'frontLip').max[1]).toBe(STAGE.lipHeight);
    expect(by(drawn, 'rightLip').max[1]).toBe(STAGE.lipHeight);
  });

  it('leaves the floor footprint clear above y 0', () => {
    for (const { name, min, max } of drawn) {
      if (name === 'slab') continue;
      const overlapsX = min[0] < w && max[0] > -w;
      const overlapsZ = min[2] < d && max[2] > -d;
      expect(overlapsX && overlapsZ, name).toBe(false);
    }
  });

  it('has no open front or right wall', () => {
    expect(drawn.map(({ name }) => name).sort()).toEqual(['backWall', 'frontLip', 'leftWall', 'rightLip', 'slab']);
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

  it('is at least as thick as it is drawn, so a fast part cannot tunnel', () => {
    for (const name of ['slab', 'backWall', 'leftWall']) {
      const a = sizeAndCentre(by(drawn, name)).size;
      const b = sizeAndCentre(by(solid, name)).size;
      expect(Math.min(...b.filter((v, i) => v !== a[i]))).toBeGreaterThanOrEqual(PHYSICS.roomColliderThickness);
    }
  });
});
