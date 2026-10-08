// Pointer-gesture state machine: decides who owns each touch — the camera, a part drag,
// or a gizmo ring — and classifies taps vs drags. Pure: it consumes plain pointer records
// `{ id, x, y, t, hit, button }` (CSS px, ms) built by src/scene/gestureRouter.js, where
// `hit` is null (empty space) or `{ kind: 'part' | 'ring', ... }` passed through untouched,
// and `button` is the pressed button (0 = primary: every touch and pen; default 0).

import { GESTURE } from '../constants.js';

export const OWNER = Object.freeze({
  CAMERA: 'camera',
  DRAG_PART: 'dragPart',
  GIZMO_RING: 'gizmoRing',
});

export type Owner = (typeof OWNER)[keyof typeof OWNER];

/** What a press landed on: a part or a gizmo ring, the rest passed through untouched. */
export interface GestureHit {
  kind: 'part' | 'ring';
}

/** A pointer record, as the router builds it (CSS px, ms). */
export interface PointerRecord<H extends GestureHit = GestureHit> {
  id: number;
  x: number;
  y: number;
  t: number;
  hit?: H | null;
  button?: number;
}

/** What `down`/`move`/`up`/`cancel`/`wheel` hand the router — see `createGestureState`. */
export type GestureEffect<H extends GestureHit = GestureHit> =
  | { type: 'dragStart' | 'dragMove' | 'dragEnd'; owner: Owner | null; hit: H | null; x: number; y: number }
  | { type: 'dragCancel'; owner: Owner | null; hit: H | null }
  | { type: 'tap'; hit: H | null; x: number; y: number }
  | { type: 'lift'; owner: Owner | null; hit: H | null; dy: number; x?: number; y?: number };

// The pointer that started the gesture.
interface Primary<H> {
  id: number;
  hit: H | null;
  startX: number;
  startY: number;
  startT: number;
  dragging: boolean;
  lastY: number;
  spentY: number;
  canTap: boolean;
}

const OWNER_FOR_HIT = { part: OWNER.DRAG_PART, ring: OWNER.GIZMO_RING };

/**
 * What a press lands on, from the nearest gizmo-ring and part raycast hits (each null or
 * `{ distance, ... }`). The rings draw on top but are fat, invisible-banded targets, so a
 * ring only wins when it is nearer than the part — whichever part that is. A press on the
 * selected part's own face drags it (stand a panel up, then carry it off); a band in front
 * of it still turns it.
 */
export function resolveHit<R extends { distance: number }, P extends { distance: number }>(
  ringHit: R | null,
  partHit: P | null,
): ({ kind: 'ring' } & R) | ({ kind: 'part' } & P) | null {
  if (ringHit && (!partHit || ringHit.distance <= partHit.distance)) {
    return { kind: 'ring' as const, ...ringHit };
  }
  return partHit ? { kind: 'part' as const, ...partHit } : null;
}

/**
 * Feed `down`/`move`/`up`/`cancel` with pointer records. Each returns an effect for the
 * router or null:
 *   { type: 'dragStart', owner, hit, x, y }  part/ring pointer passed the tap distance
 *   { type: 'dragMove', owner, hit, x, y }
 *   { type: 'dragEnd', owner, hit, x, y }
 *   { type: 'dragCancel', owner, hit }        pointercancel / interrupted mid-drag
 *   { type: 'tap', hit, x, y }                hit is null for an empty-space tap
 *   { type: 'lift', owner, hit, dy }          raise (+) / lower (−) the dragged part, CSS px
 *   { type: 'lift', owner, hit, dy, x, y }    the same from the primary pointer under the
 *                                             modifier; x, y is where it drags to now
 *
 * A second finger during a part gesture is the lift channel: its vertical travel (up is
 * positive) raises the held part, and lifting it ends the lift while the drag carries on.
 * `wheel` is the desktop stand-in. The camera never sees the lift finger.
 *
 * `modifier(held)` is the desktop's other lift: the router feeds it whether Shift is down
 * (this module never reads keys). While held during a part drag, the primary pointer's
 * vertical travel lifts instead of moving the part across the floor, and its horizontal
 * travel still drags. The travel spent on lifting stays spent: dragMove/lift effects
 * report y less that travel, so letting go of Shift resumes the plane drag mid-gesture
 * without the part jumping.
 *
 * `cameraEnabled` is false only while a part or ring gesture is live; the router mirrors
 * it onto the camera after every event, so every end path hands the camera back.
 */
export function createGestureState<H extends GestureHit = GestureHit>(thresholds: { tapMaxDistance: number; tapMaxMs: number } = GESTURE) {
  const { tapMaxDistance, tapMaxMs } = thresholds;

  let owner: Owner | null = null;
  let primary: Primary<H> | null = null; // { id, hit, startX, startY, startT, dragging }
  let lift: { id: number; y: number } | null = null; // { id, y } — the second finger of a part gesture
  // Keyboard state, not pointer state: it outlives every gesture until the router clears it.
  let modifierHeld = false;
  const cameraPointers = new Set<number>();
  let cameraMulti = false;

  const movedTooFar = (p: Primary<H>, x: number, y: number) => Math.hypot(x - p.startX, y - p.startY) > tapMaxDistance;
  const isTap = (p: Primary<H>, { x, y, t }: PointerRecord<H>) => p.canTap && !movedTooFar(p, x, y) && t - p.startT <= tapMaxMs;

  function reset() {
    owner = null;
    primary = null;
    lift = null;
    cameraPointers.clear();
    cameraMulti = false;
  }

  function down({ id, x, y, t, hit, button = 0 }: PointerRecord<H>): GestureEffect<H> | null {
    if (owner === null) {
      // Only the primary button picks up parts or rings; mouse right/middle presses are
      // the camera's pan and zoom.
      owner = (button === 0 && hit && OWNER_FOR_HIT[hit.kind]) || OWNER.CAMERA;
      primary = {
        id,
        hit: owner === OWNER.CAMERA ? null : (hit ?? null),
        startX: x,
        startY: y,
        startT: t,
        dragging: false,
        lastY: y,
        // Vertical travel spent lifting under the modifier (CSS px).
        spentY: 0,
        // A right/middle click is never a tap — it must not deselect.
        canTap: button === 0,
      };
      if (owner === OWNER.CAMERA) cameraPointers.add(id);
      return null;
    }
    // Extra fingers join a camera gesture (pinch/pan) whatever they land on. During a part
    // gesture the first owner keeps it and the second finger becomes the lift channel;
    // during a ring gesture, and beyond a second finger, extras are ignored.
    if (owner === OWNER.CAMERA) {
      cameraPointers.add(id);
      cameraMulti = true;
    } else if (owner === OWNER.DRAG_PART && !lift) {
      lift = { id, y };
    }
    return null;
  }

  const liftEffect = (dy: number): Extract<GestureEffect<H>, { type: 'lift' }> | null =>
    primary && primary.dragging && dy !== 0 ? { type: 'lift', owner, hit: primary.hit, dy } : null;

  function move({ id, x, y }: PointerRecord<H>): GestureEffect<H> | null {
    if (lift && id === lift.id) {
      const dy = lift.y - y;
      lift.y = y;
      return liftEffect(dy);
    }
    if (!primary || id !== primary.id) return null;
    if (owner === OWNER.CAMERA) {
      if (movedTooFar(primary, x, y)) primary.dragging = true;
      return null;
    }
    if (!primary.dragging) {
      if (!movedTooFar(primary, x, y)) return null;
      primary.dragging = true;
      primary.lastY = y;
      return { type: 'dragStart', owner, hit: primary.hit, x, y };
    }
    const dy = y - primary.lastY;
    primary.lastY = y;
    if (modifierHeld && owner === OWNER.DRAG_PART && dy !== 0) {
      primary.spentY += dy;
      // Dragging, and dy is non-zero: there is a lift.
      return { ...liftEffect(-dy)!, x, y: y - primary.spentY };
    }
    return { type: 'dragMove', owner, hit: primary.hit, x, y: y - primary.spentY };
  }

  function up(event: PointerRecord<H>): GestureEffect<H> | null {
    const { id, x, y } = event;
    if (owner === OWNER.CAMERA) {
      if (!cameraPointers.delete(id)) return null;
      const tapped = primary && id === primary.id && !cameraMulti && !primary.dragging && isTap(primary, event);
      if (cameraPointers.size === 0) reset();
      return tapped ? { type: 'tap', hit: null, x, y } : null;
    }
    if (lift && id === lift.id) {
      lift = null;
      return null;
    }
    if (!primary || id !== primary.id) return null;
    const ended = { owner, hit: primary.hit, x, y: y - primary.spentY };
    const tapped = !primary.dragging && isTap(primary, event);
    const wasDragging = primary.dragging;
    reset();
    if (wasDragging) return { type: 'dragEnd', ...ended };
    return tapped ? { type: 'tap', hit: ended.hit, x, y } : null;
  }

  function cancel({ id }: Pick<PointerRecord<H>, 'id'>): GestureEffect<H> | null {
    if (owner === OWNER.CAMERA) {
      if (!cameraPointers.delete(id)) return null;
      // A cancelled finger can never complete a tap.
      cameraMulti = true;
      if (cameraPointers.size === 0) reset();
      return null;
    }
    if (lift && id === lift.id) {
      lift = null;
      return null;
    }
    if (!primary || id !== primary.id) return null;
    return cancelAll();
  }

  /** Desktop lift: wheel delta (CSS px, positive = scroll down) while a part is dragged. */
  function wheel({ dy }: { dy: number }): GestureEffect<H> | null {
    return owner === OWNER.DRAG_PART ? liftEffect(-dy) : null;
  }

  /** Desktop lift modifier (Shift): whether it is held, fed by the router. */
  function modifier(held: boolean) {
    modifierHeld = held;
  }

  /** Abandon whatever is live (page hidden, focus lost). */
  function cancelAll(): GestureEffect<H> | null {
    const effect: GestureEffect<H> | null =
      primary && primary.dragging && owner !== OWNER.CAMERA
        ? { type: 'dragCancel', owner, hit: primary.hit }
        : null;
    reset();
    return effect;
  }

  return {
    down,
    move,
    up,
    cancel,
    cancelAll,
    wheel,
    modifier,
    get owner() {
      return owner;
    },
    /** 'idle' | 'pending' (pressed, not yet a drag) | 'dragging'. */
    get phase() {
      if (!primary) return owner === null ? 'idle' : 'pending';
      return primary.dragging ? 'dragging' : 'pending';
    },
    get cameraEnabled() {
      return owner !== OWNER.DRAG_PART && owner !== OWNER.GIZMO_RING;
    },
  };
}
