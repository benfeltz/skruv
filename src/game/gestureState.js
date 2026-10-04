// Pointer-gesture state machine: decides who owns each touch — the camera, a part drag,
// or a gizmo ring — and classifies taps vs drags. Pure: it consumes plain pointer records
// `{ id, x, y, t, hit }` (CSS px, ms) built by src/scene/gestureRouter.js, where `hit` is
// null (empty space) or `{ kind: 'part' | 'ring', ... }` passed through untouched.

import { GESTURE } from '../constants.js';

export const OWNER = Object.freeze({
  CAMERA: 'camera',
  DRAG_PART: 'dragPart',
  GIZMO_RING: 'gizmoRing',
});

const OWNER_FOR_HIT = { part: OWNER.DRAG_PART, ring: OWNER.GIZMO_RING };

/**
 * Feed `down`/`move`/`up`/`cancel` with pointer records. Each returns an effect for the
 * router or null:
 *   { type: 'dragStart', owner, hit, x, y }  part/ring pointer passed the tap distance
 *   { type: 'dragMove', owner, hit, x, y }
 *   { type: 'dragEnd', owner, hit, x, y }
 *   { type: 'dragCancel', owner, hit }        pointercancel / interrupted mid-drag
 *   { type: 'tap', hit, x, y }                hit is null for an empty-space tap
 *
 * `cameraEnabled` is false only while a part or ring gesture is live; the router mirrors
 * it onto the camera after every event, so every end path hands the camera back.
 */
export function createGestureState(thresholds = GESTURE) {
  const { tapMaxDistance, tapMaxMs } = thresholds;

  let owner = null;
  let primary = null; // { id, hit, startX, startY, startT, dragging }
  const cameraPointers = new Set();
  let cameraMulti = false;

  const movedTooFar = (p, x, y) => Math.hypot(x - p.startX, y - p.startY) > tapMaxDistance;
  const isTap = (p, { x, y, t }) => !movedTooFar(p, x, y) && t - p.startT <= tapMaxMs;

  function reset() {
    owner = null;
    primary = null;
    cameraPointers.clear();
    cameraMulti = false;
  }

  function down({ id, x, y, t, hit }) {
    if (owner === null) {
      owner = (hit && OWNER_FOR_HIT[hit.kind]) || OWNER.CAMERA;
      primary = { id, hit: owner === OWNER.CAMERA ? null : hit, startX: x, startY: y, startT: t, dragging: false };
      if (owner === OWNER.CAMERA) cameraPointers.add(id);
      return null;
    }
    // Extra fingers join a camera gesture (pinch/pan) whatever they land on; during a part
    // or ring gesture the first owner keeps it and extra fingers are ignored.
    if (owner === OWNER.CAMERA) {
      cameraPointers.add(id);
      cameraMulti = true;
    }
    return null;
  }

  function move({ id, x, y }) {
    if (!primary || id !== primary.id) return null;
    if (owner === OWNER.CAMERA) {
      if (movedTooFar(primary, x, y)) primary.dragging = true;
      return null;
    }
    if (!primary.dragging) {
      if (!movedTooFar(primary, x, y)) return null;
      primary.dragging = true;
      return { type: 'dragStart', owner, hit: primary.hit, x, y };
    }
    return { type: 'dragMove', owner, hit: primary.hit, x, y };
  }

  function up(event) {
    const { id, x, y } = event;
    if (owner === OWNER.CAMERA) {
      if (!cameraPointers.delete(id)) return null;
      const tapped = primary && id === primary.id && !cameraMulti && !primary.dragging && isTap(primary, event);
      if (cameraPointers.size === 0) reset();
      return tapped ? { type: 'tap', hit: null, x, y } : null;
    }
    if (!primary || id !== primary.id) return null;
    const ended = { owner, hit: primary.hit, x, y };
    const tapped = !primary.dragging && isTap(primary, event);
    const wasDragging = primary.dragging;
    reset();
    if (wasDragging) return { type: 'dragEnd', ...ended };
    return tapped ? { type: 'tap', hit: ended.hit, x, y } : null;
  }

  function cancel({ id }) {
    if (owner === OWNER.CAMERA) {
      if (!cameraPointers.delete(id)) return null;
      // A cancelled finger can never complete a tap.
      cameraMulti = true;
      if (cameraPointers.size === 0) reset();
      return null;
    }
    if (!primary || id !== primary.id) return null;
    return cancelAll();
  }

  /** Abandon whatever is live (page hidden, focus lost). */
  function cancelAll() {
    const effect =
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
