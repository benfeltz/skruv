import { LIFT_LINE } from '../constants.js';
import { PART_TYPES } from '../game/item.js';
import { rotatedHalfExtents } from '../game/dragMath.js';
import { easeHeight, liftRange } from '../game/liftLine.js';
import type { LiftRange } from '../game/liftLine.js';
import type { Part } from '../game/partMesh.js';
import type { Body, PhysicsWorld } from '../physics/world.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

/** What `createLiftHold` adds to the physics it wraps — see there. */
export interface LiftHold {
  begin(part: Part): void;
  target(height: number): void;
  jump(height: number): void;
  end(): void;
  update(delta: number): void;
  readonly held: Part | null;
  readonly height: number;
}

/** A part's lift range turned by `rotation`: a part stood on end needs more floor clearance. */
export function liftRangeOf(part: Part, rotation: Quat): LiftRange {
  const [, halfHeight] = rotatedHalfExtents(PART_TYPES[part.type].size.map((d) => d / 2), rotation);
  return liftRange(halfHeight);
}

const clampTo = (y: number, [min, max]: LiftRange) => Math.min(max, Math.max(min, y));

/**
 * Physics seam for the elevation line (src/ui/liftLine.ts): while a finger is on the line,
 * the held part stays in mid-air at the line's height. `begin(part)` takes the part's body
 * over (unless a drag or turn already has it), `target(height)` eases it there in
 * `update(delta)`, `jump(height)` puts it there at once, and `end()` hands it back to the
 * simulation at rest — so it drops, as releasing a lift always has.
 *
 * While holding body B:
 *   move(B)    only y is replaced by the hold's height — x, z and rotation pass through, so
 *              holding never moves the part toward the camera. A rotation that needs more
 *              floor clearance raises the height with it.
 *   grab(B)    a drag or turn is another holder.
 *   release(B) from that holder is swallowed: the line still holds the part. `end()` lets
 *              go only when no other holder remains; one still dragging releases it itself.
 * With nothing held, and for every other body and call, it is a pure passthrough to
 * `physics` — the same shape as src/scene/compoundPhysics.ts, which it wraps.
 */
export function createLiftHold(physics: PhysicsWorld): PhysicsWorld & LiftHold {
  // Grabs through this seam not yet released, per body: the drags' and turns' holds.
  const holders = new Map<Body, number>();
  let hold: { part: Part; x: number; z: number; rotation: Quat; height: number; goal: number } | null = null;

  const holding = (body: Body) => hold?.part.body === body;
  const rangeNow = () => liftRangeOf(hold!.part, hold!.rotation);

  // The y a move of the held body gets: the hold's height, raised to the floor clearance
  // its rotation needs.
  function heldY() {
    hold!.height = clampTo(hold!.height, rangeNow());
    hold!.goal = clampTo(hold!.goal, rangeNow());
    return hold!.height;
  }

  function grab(body: Body) {
    holders.set(body, (holders.get(body) ?? 0) + 1);
    physics.grab(body);
  }

  function move(body: Body, position: Vec3, rotation?: Quat) {
    if (!holding(body)) return physics.move(body, position, rotation);
    if (rotation) hold!.rotation = rotation;
    [hold!.x, , hold!.z] = position;
    physics.move(body, [hold!.x, heldY(), hold!.z], rotation);
  }

  function release(body: Body) {
    const count = holders.get(body) ?? 0;
    if (count > 1) holders.set(body, count - 1);
    else holders.delete(body);
    if (!holding(body)) physics.release(body);
  }

  function begin(part: Part) {
    const { body } = part;
    if (!holders.has(body)) physics.grab(body);
    const { x, y, z } = body.translation();
    const r = body.rotation();
    hold = { part, x, z, rotation: [r.x, r.y, r.z, r.w], height: y, goal: y };
  }

  function target(height: number) {
    if (hold) hold.goal = clampTo(height, rangeNow());
  }

  function jump(height: number) {
    if (hold) hold.goal = hold.height = clampTo(height, rangeNow());
  }

  function end() {
    if (!hold) return;
    const { body } = hold.part;
    hold = null;
    if (!holders.has(body)) physics.release(body);
  }

  function update(delta: number) {
    if (!hold) return;
    hold.height = easeHeight(hold.height, hold.goal, LIFT_LINE.easeRate, delta);
    physics.move(hold.part.body, [hold.x, heldY(), hold.z], hold.rotation);
  }

  return {
    ...physics,
    grab,
    move,
    release,
    begin,
    target,
    jump,
    end,
    update,
    get held() {
      return hold?.part ?? null;
    },
    get height() {
      return hold?.height ?? 0;
    },
  };
}
