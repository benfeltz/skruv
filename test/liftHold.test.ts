import { describe, expect, it } from 'vitest';
import { LIFT_LINE } from '../src/constants.js';
import { PART_TYPES } from '../src/game/item.js';
import { createLiftHold } from '../src/scene/liftHold.js';
import type { Part } from '../src/game/partMesh.js';
import type { Body, PhysicsWorld } from '../src/physics/world.js';
import type { Quat, Vec3 } from '../tools/validate/lib/geometry.js';

type FakeBody = Body & { id: string; kinematic: boolean };

// A stood-up quarter turn about x: the shelf's 0.28 m depth becomes its height.
const UPENDED: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const shelfHalf = PART_TYPES.fixedShelf.size[1] / 2;

function rig() {
  const calls: (string | number[] | undefined)[][] = [];
  // A stand-in rigid body: the seam reads its pose, the fake physics its id.
  function body(id: string, [x, y, z]: Vec3) {
    const fake = {
      id,
      kinematic: false,
      isKinematic: () => fake.kinematic,
      translation: () => ({ x, y, z }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    };
    return fake as unknown as FakeBody;
  }
  const shelf = { id: 'fixedShelf-1', type: 'fixedShelf', body: body('shelf', [0.5, shelfHalf, -0.25]) } as unknown as Part;
  const other = { id: 'dowel-1', type: 'dowel', body: body('dowel', [2, 0.004, 0]) } as unknown as Part;
  const round = (v: number[]) => v.map((n) => +n.toFixed(6));
  // Only the calls the seam makes, recorded with the pose a move asked for.
  const physics = {
    grab: (b: FakeBody) => calls.push(['grab', b.id]) && (b.kinematic = true),
    move: (b: FakeBody, position: Vec3, rotation?: Quat) => calls.push(['move', b.id, round(position), rotation && round(rotation)]),
    release: (b: FakeBody) => calls.push(['release', b.id]) && (b.kinematic = false),
    step: () => 'stepped',
  } as unknown as PhysicsWorld;
  const hold = createLiftHold(physics);
  const ops = (op: string) => calls.filter(([name]) => name === op);
  return { calls, ops, shelf, other, hold };
}

describe('lift hold seam — idle passthrough (regression risk)', () => {
  it('passes grab, move and release straight through when nothing is held', () => {
    const { calls, shelf, hold } = rig();
    hold.grab(shelf.body);
    hold.move(shelf.body, [1, 0.3, 2], [0, 0, 0, 1]);
    hold.release(shelf.body);
    hold.update(1 / 60);
    expect(calls).toEqual([['grab', 'shelf'], ['move', 'shelf', [1, 0.3, 2], [0, 0, 0, 1]], ['release', 'shelf']]);
    expect(hold.held).toBeNull();
  });

  it('never swallows a release of a body it is not holding', () => {
    const { ops, shelf, other, hold } = rig();
    hold.begin(shelf);
    hold.grab(other.body);
    hold.release(other.body);
    expect(ops('release')).toEqual([['release', 'dowel']]);
  });

  it('passes every other call through', () => {
    const { hold } = rig();
    expect((hold as unknown as { step(): string }).step()).toBe('stepped');
  });

  it('is a passthrough again once the hold has ended', () => {
    const { calls, shelf, hold } = rig();
    hold.begin(shelf);
    hold.end();
    calls.length = 0;
    hold.grab(shelf.body);
    hold.move(shelf.body, [1, 0.3, 2]);
    hold.release(shelf.body);
    expect(calls).toEqual([['grab', 'shelf'], ['move', 'shelf', [1, 0.3, 2], undefined], ['release', 'shelf']]);
  });
});

describe('lift hold seam — holding', () => {
  it('begin grabs the body; update eases toward the target', () => {
    const { ops, shelf, hold } = rig();
    hold.begin(shelf);
    expect(ops('grab')).toEqual([['grab', 'shelf']]);
    expect(hold.held).toBe(shelf);
    hold.target(1);
    hold.update(1 / 60);
    const share = 1 - Math.exp(-LIFT_LINE.easeRate / 60);
    expect(hold.height).toBeCloseTo(shelfHalf + (1 - shelfHalf) * share, 9);
    for (let i = 0; i < 600; i++) hold.update(1 / 60);
    expect(hold.height).toBeCloseTo(1, 6);
  });

  it('easing changes y only: x, z stay fixed across updates', () => {
    const { ops, shelf, hold } = rig();
    hold.begin(shelf);
    hold.target(1.2);
    for (let i = 0; i < 10; i++) hold.update(1 / 60);
    const moves = ops('move');
    expect(moves).toHaveLength(10);
    for (const [, , [x, , z]] of moves as [string, string, number[]][]) {
      expect([x, z]).toEqual([0.5, -0.25]);
    }
  });

  it('jump puts the part at the height at once', () => {
    const { shelf, hold } = rig();
    hold.begin(shelf);
    hold.jump(0.8);
    expect(hold.height).toBe(0.8);
    hold.update(1 / 60);
    expect(hold.height).toBe(0.8);
  });

  it("a drag's move keeps the hold's y, and its x, z pass through", () => {
    const { ops, shelf, hold } = rig();
    hold.grab(shelf.body); // the drag was live first
    hold.begin(shelf);
    hold.jump(0.9);
    hold.move(shelf.body, [1.5, 0.05, 0.75], [0, 0, 0, 1]);
    expect(ops('grab')).toEqual([['grab', 'shelf']]); // begin did not grab again
    expect(ops('move').at(-1)).toEqual(['move', 'shelf', [1.5, 0.9, 0.75], [0, 0, 0, 1]]);
    hold.update(1 / 60);
    expect(ops('move').at(-1)).toEqual(['move', 'shelf', [1.5, 0.9, 0.75], [0, 0, 0, 1]]);
  });

  it("a drag's release during the hold is swallowed", () => {
    const { ops, shelf, hold } = rig();
    hold.begin(shelf);
    hold.grab(shelf.body);
    hold.release(shelf.body);
    expect(ops('release')).toEqual([]);
    expect(hold.held).toBe(shelf);
  });

  it('end with no other holder releases once', () => {
    const { ops, shelf, hold } = rig();
    hold.begin(shelf);
    hold.grab(shelf.body);
    hold.release(shelf.body);
    hold.end();
    hold.end();
    expect(ops('release')).toEqual([['release', 'shelf']]);
    expect(hold.held).toBeNull();
  });

  it("end while a drag still holds doesn't release; the drag's own release then goes through", () => {
    const { ops, shelf, hold } = rig();
    hold.begin(shelf);
    hold.grab(shelf.body);
    hold.end();
    expect(ops('release')).toEqual([]);
    hold.release(shelf.body);
    expect(ops('release')).toEqual([['release', 'shelf']]);
  });

  // The router re-grabs a seated part it already holds when a drag pulls it free, and
  // pairs that with one release (review round 2).
  it('grabs a body handed back to the simulation, however often it was grabbed before', () => {
    const { ops, shelf, hold } = rig();
    hold.grab(shelf.body); // held at its seat
    hold.grab(shelf.body); // dragged off it
    hold.release(shelf.body); // dropped
    hold.begin(shelf);
    expect(ops('grab')).toHaveLength(3);
    hold.end();
    expect(ops('release')).toHaveLength(2);
  });

  it('grabs a body put back by a repack while still listed as held', () => {
    const { ops, shelf, hold } = rig();
    hold.grab(shelf.body);
    (shelf.body as FakeBody).kinematic = false; // physics.place, outside the seam
    hold.begin(shelf);
    expect(ops('grab')).toHaveLength(2);
    hold.end();
    expect(ops('release')).toEqual([['release', 'shelf']]);
  });

  it('a turn that needs clearance raises the floor', () => {
    const { ops, shelf, hold } = rig();
    hold.begin(shelf);
    hold.jump(0); // asked for below the floor: lands resting on it
    expect(hold.height).toBeCloseTo(shelfHalf, 9);
    hold.move(shelf.body, [0.5, 0.05, -0.25], UPENDED);
    const standing = PART_TYPES.fixedShelf.size[2] / 2;
    expect(hold.height).toBeCloseTo(standing, 9);
    expect(ops('move').at(-1)![2]).toEqual([0.5, +standing.toFixed(6), -0.25]);
    hold.target(0);
    hold.update(1);
    expect(hold.height).toBeCloseTo(standing, 9);
  });
});
