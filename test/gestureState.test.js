import { describe, expect, it } from 'vitest';
import { createGestureState, OWNER, resolveHit } from '../src/game/gestureState.js';

const T = { tapMaxDistance: 10, tapMaxMs: 300 };
const PART = { kind: 'part', id: 'sidePanel-1' };
const RING = { kind: 'ring', axis: 'y' };
const at = (id, x, y, t = 0, hit = null) => ({ id, x, y, t, hit });

describe('gesture ownership', () => {
  it('leaves a no-hit press with the camera, which stays enabled throughout', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0));
    expect(g.owner).toBe(OWNER.CAMERA);
    expect(g.cameraEnabled).toBe(true);
    expect(g.move(at(1, 80, 40, 50))).toBeNull();
    expect(g.cameraEnabled).toBe(true);
    expect(g.up(at(1, 80, 40, 100))).toBeNull();
    expect(g.owner).toBeNull();
    expect(g.cameraEnabled).toBe(true);
  });

  it('lets a press on a part claim the gesture and disable the camera', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.phase).toBe('pending');
    expect(g.cameraEnabled).toBe(false);
  });

  it('gives a press on a gizmo ring to the ring', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, RING));
    expect(g.owner).toBe(OWNER.GIZMO_RING);
    expect(g.move(at(1, 20, 0, 10))).toEqual({ type: 'dragStart', owner: OWNER.GIZMO_RING, hit: RING, x: 20, y: 0 });
  });

  it('ignores a second pointer during a part drag; the first owner keeps it', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    g.move(at(1, 30, 0, 10));
    expect(g.down(at(2, 100, 100, 20))).toBeNull();
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.move(at(2, 150, 100, 30))).toBeNull();
    expect(g.up(at(2, 150, 100, 40))).toBeNull();
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.move(at(1, 40, 0, 50))).toMatchObject({ type: 'dragMove', x: 40 });
    expect(g.up(at(1, 40, 0, 60))).toMatchObject({ type: 'dragEnd', owner: OWNER.DRAG_PART, hit: PART });
    expect(g.cameraEnabled).toBe(true);
  });

  it('keeps a second finger landing on a part with the camera gesture (pinch)', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0));
    g.down(at(2, 50, 50, 10, PART));
    expect(g.owner).toBe(OWNER.CAMERA);
    expect(g.cameraEnabled).toBe(true);
    expect(g.up(at(1, 0, 0, 20))).toBeNull();
    expect(g.owner).toBe(OWNER.CAMERA);
    expect(g.up(at(2, 50, 50, 30))).toBeNull();
    expect(g.owner).toBeNull();
  });
});

describe('tap vs drag', () => {
  it('resolves a press within both thresholds as a tap on the part', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    expect(g.move(at(1, 10, 0, 100))).toBeNull();
    expect(g.up(at(1, 10, 0, 300))).toEqual({ type: 'tap', hit: PART, x: 10, y: 0 });
    expect(g.cameraEnabled).toBe(true);
  });

  it('starts a drag once movement passes the tap distance', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    expect(g.move(at(1, 10.5, 0, 20))).toMatchObject({ type: 'dragStart', owner: OWNER.DRAG_PART, hit: PART });
    expect(g.phase).toBe('dragging');
    expect(g.up(at(1, 0, 0, 40))).toMatchObject({ type: 'dragEnd' });
  });

  it('is neither tap nor drag when held past the tap time without moving', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    expect(g.up(at(1, 0, 0, 301))).toBeNull();
    expect(g.owner).toBeNull();
    expect(g.cameraEnabled).toBe(true);
  });

  it('reports an empty-space tap with a null hit', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0));
    expect(g.up(at(1, 3, 3, 100))).toEqual({ type: 'tap', hit: null, x: 3, y: 3 });
  });

  it('does not report a tap after an empty-space orbit returns to its start', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0));
    g.move(at(1, 50, 0, 50));
    expect(g.up(at(1, 0, 0, 100))).toBeNull();
  });

  it('does not report a tap after a two-finger camera gesture', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0));
    g.down(at(2, 40, 0, 10));
    g.up(at(2, 40, 0, 20));
    expect(g.up(at(1, 0, 0, 30))).toBeNull();
  });
});

describe('non-primary buttons', () => {
  const press = (button, hit = null) => ({ ...at(1, 0, 0, 0, hit), button });

  it('never reports a stationary right or middle click as a tap (no deselect)', () => {
    for (const button of [1, 2]) {
      const g = createGestureState(T);
      g.down(press(button));
      expect(g.up(at(1, 0, 0, 100))).toBeNull();
      expect(g.owner).toBeNull();
    }
  });

  it('leaves a right press on a part with the camera (pan), never a part drag', () => {
    const g = createGestureState(T);
    g.down(press(2, PART));
    expect(g.owner).toBe(OWNER.CAMERA);
    expect(g.cameraEnabled).toBe(true);
  });

  it('still taps on the primary button', () => {
    const g = createGestureState(T);
    g.down(press(0));
    expect(g.up(at(1, 0, 0, 100))).toMatchObject({ type: 'tap', hit: null });
  });
});

describe('cancel', () => {
  it('cancels a live part drag, resets, and re-enables the camera', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    g.move(at(1, 30, 0, 10));
    expect(g.cancel(at(1, 30, 0, 20))).toEqual({ type: 'dragCancel', owner: OWNER.DRAG_PART, hit: PART });
    expect(g.owner).toBeNull();
    expect(g.phase).toBe('idle');
    expect(g.cameraEnabled).toBe(true);
    expect(g.up(at(1, 30, 0, 30))).toBeNull();
  });

  it('cancels a pending part press silently and hands the camera back', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    expect(g.cancel(at(1, 0, 0, 10))).toBeNull();
    expect(g.cameraEnabled).toBe(true);
  });

  it('ignores cancel from a pointer it is not tracking', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    g.move(at(1, 30, 0, 10));
    expect(g.cancel(at(9, 0, 0, 20))).toBeNull();
    expect(g.owner).toBe(OWNER.DRAG_PART);
  });

  it('clears a camera gesture on cancel and never reports it as a tap', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0));
    g.down(at(2, 5, 5, 0));
    g.cancel(at(2, 5, 5, 10));
    expect(g.up(at(1, 0, 0, 20))).toBeNull();
    expect(g.owner).toBeNull();
  });

  it('cancelAll abandons a ring drag and returns the cancel effect', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, RING));
    g.move(at(1, 30, 0, 10));
    expect(g.cancelAll()).toEqual({ type: 'dragCancel', owner: OWNER.GIZMO_RING, hit: RING });
    expect(g.cameraEnabled).toBe(true);
    expect(g.cancelAll()).toBeNull();
  });

  it('accepts a fresh gesture after a cancel', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    g.cancel(at(1, 0, 0, 10));
    g.down(at(2, 0, 0, 20));
    expect(g.owner).toBe(OWNER.CAMERA);
  });
});

describe('resolveHit', () => {
  const selected = { id: 'sidePanel-1' };
  const neighbour = { id: 'fixedShelf-1' };
  const ring = { axis: 'x', distance: 2 };

  it('gives a press on a neighbouring part in front of a ring band to the part', () => {
    expect(resolveHit(ring, { part: neighbour, distance: 1.5 }, selected)).toEqual({ kind: 'part', part: neighbour, distance: 1.5 });
  });

  it('gives the ring a press where it is nearer than the part behind it', () => {
    expect(resolveHit(ring, { part: neighbour, distance: 3 }, selected)).toEqual({ kind: 'ring', ...ring });
  });

  it('gives the ring a press on the selected part itself, whatever the distance', () => {
    expect(resolveHit(ring, { part: selected, distance: 1 }, selected)).toEqual({ kind: 'ring', ...ring });
  });

  it('falls back to whichever was hit, or null for empty space', () => {
    expect(resolveHit(ring, null, selected)).toEqual({ kind: 'ring', ...ring });
    expect(resolveHit(null, { part: neighbour, distance: 1 }, null)).toMatchObject({ kind: 'part', part: neighbour });
    expect(resolveHit(null, null, null)).toBeNull();
  });
});
