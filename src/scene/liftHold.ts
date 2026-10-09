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
  begin(part: Part, by: Keeper): void;
  target(height: number): void;
  jump(height: number): void;
  end(by?: Keeper): void;
  update(delta: number): void;
  readonly held: Part | null;
  readonly height: number;
}

/** What keeps a held part up: a finger on the line, or Shift held down (the desktop's hold). */
export type Keeper = 'line' | 'key';

/** A part's lift range turned by `rotation`: a part stood on end needs more floor clearance. */
export function liftRangeOf(part: Part, rotation: Quat): LiftRange {
  const [, halfHeight] = rotatedHalfExtents(PART_TYPES[part.type].size.map((d) => d / 2), rotation);
  return liftRange(halfHeight);
}

const clampTo = (y: number, [min, max]: LiftRange) => Math.min(max, Math.max(min, y));

/**
 * Physics seam for the elevation line (src/ui/liftLine.ts): while a finger is on the line,
 * or Shift is held, the held part stays in mid-air at the line's height. `begin(part, by)`
 * takes the part's body over (unless it is already under direct control) and counts `by`
 * as keeping it up, `target(height)` eases it there in `update(delta)`, `jump(height)` puts
 * it there at once, and `end(by)` lets `by` go: once no keeper is left, the body goes back
 * to the simulation at rest — so it drops, as releasing a lift always has. `end()` drops it
 * whoever keeps it (a seat, a repack, the app put away).
 *
 * While holding body B:
 *   move(B)    only y is replaced by the hold's height — x, z and rotation pass through, so
 *              holding never moves the part toward the camera. A rotation that needs more
 *              floor clearance raises the height with it.
 *   grab(B)    a drag or turn is another holder.
 *   release(B) from that holder is swallowed: the line still holds the part. `end()` lets
 *              go only when no other holder remains; one still dragging releases it itself.
 * Holding is per body, not counted: the router re-grabs a seated part it already holds
 * when a drag pulls it free, and pairs that with one release.
 * With nothing held, and for every other body and call, it is a pure passthrough to
 * `physics` — the same shape as src/scene/compoundPhysics.ts, which it wraps.
 */
export function createLiftHold(physics: PhysicsWorld): PhysicsWorld & LiftHold {
  // Bodies grabbed through this seam and not yet released: the drags', turns' and seats' holds.
  const holders = new Set<Body>();
  // Where each of them was last moved to: ahead of the simulation until the next step.
  const moved = new Map<Body, Vec3>();
  let hold: { part: Part; x: number; z: number; rotation: Quat; height: number; goal: number } | null = null;
  const keepers = new Set<Keeper>();

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
    holders.add(body);
    physics.grab(body);
  }

  function move(body: Body, position: Vec3, rotation?: Quat) {
    if (holders.has(body)) moved.set(body, position);
    if (!holding(body)) return physics.move(body, position, rotation);
    if (rotation) hold!.rotation = rotation;
    [hold!.x, , hold!.z] = position;
    physics.move(body, [hold!.x, heldY(), hold!.z], rotation);
  }

  function release(body: Body) {
    holders.delete(body);
    moved.delete(body);
    if (!holding(body)) physics.release(body);
  }

  function begin(part: Part, by: Keeper) {
    // A second keeper joins the hold as it is, mid-ease and all.
    if (hold) {
      if (hold.part === part) keepers.add(by);
      return;
    }
    keepers.add(by);
    const { body } = part;
    // A body the simulation has is nobody's, whatever was left behind (a repack's place).
    if (!body.isKinematic()) {
      holders.delete(body);
      moved.delete(body);
      physics.grab(body);
    }
    // Under a drag, where it was last put; else where the simulation has it.
    const t = body.translation();
    const [x, y, z] = moved.get(body) ?? [t.x, t.y, t.z];
    const r = body.rotation();
    hold = { part, x, z, rotation: [r.x, r.y, r.z, r.w], height: y, goal: y };
  }

  function target(height: number) {
    if (hold) hold.goal = clampTo(height, rangeNow());
  }

  function jump(height: number) {
    if (hold) hold.goal = hold.height = clampTo(height, rangeNow());
  }

  function end(by?: Keeper) {
    if (!hold) return;
    if (by) keepers.delete(by);
    else keepers.clear();
    if (keepers.size > 0) return;
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
