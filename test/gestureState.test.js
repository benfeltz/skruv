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
    expect(resolveHit(ring, { part: neighbour, distance: 1.5 })).toEqual({ kind: 'part', part: neighbour, distance: 1.5 });
  });

  it('gives the ring a press where it is nearer than the part behind it', () => {
    expect(resolveHit(ring, { part: neighbour, distance: 3 })).toEqual({ kind: 'ring', ...ring });
  });

  it('gives a press on the selected part itself to the part when its face is nearer than the band', () => {
    expect(resolveHit(ring, { part: selected, distance: 1 })).toEqual({ kind: 'part', part: selected, distance: 1 });
  });

  it('still gives the ring a band in front of the selected part', () => {
    expect(resolveHit(ring, { part: selected, distance: 2.5 })).toEqual({ kind: 'ring', ...ring });
  });

  it('falls back to whichever was hit, or null for empty space', () => {
    expect(resolveHit(ring, null)).toEqual({ kind: 'ring', ...ring });
    expect(resolveHit(null, { part: neighbour, distance: 1 })).toMatchObject({ kind: 'part', part: neighbour });
    expect(resolveHit(null, null)).toBeNull();
  });
});

describe('lift channel (second finger during a part drag)', () => {
  const dragging = () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    g.move(at(1, 30, 0, 10));
    return g;
  };

  it('turns a second finger into the lift: upward travel raises, downward lowers', () => {
    const g = dragging();
    expect(g.down(at(2, 100, 200, 20))).toBeNull();
    expect(g.move(at(2, 100, 170, 30))).toEqual({ type: 'lift', owner: OWNER.DRAG_PART, hit: PART, dy: 30 });
    expect(g.move(at(2, 100, 180, 40))).toEqual({ type: 'lift', owner: OWNER.DRAG_PART, hit: PART, dy: -10 });
  });

  it('ends the lift when the second finger lifts, while the drag carries on', () => {
    const g = dragging();
    g.down(at(2, 100, 200, 20));
    g.move(at(2, 100, 150, 30));
    expect(g.up(at(2, 100, 150, 40))).toBeNull();
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.move(at(2, 100, 100, 50))).toBeNull();
    expect(g.move(at(1, 50, 0, 60))).toMatchObject({ type: 'dragMove', x: 50 });
    expect(g.up(at(1, 50, 0, 70))).toMatchObject({ type: 'dragEnd', owner: OWNER.DRAG_PART });
  });

  it('a cancelled lift finger leaves the drag alive', () => {
    const g = dragging();
    g.down(at(2, 100, 200, 20));
    expect(g.cancel(at(2, 100, 200, 30))).toBeNull();
    expect(g.phase).toBe('dragging');
    expect(g.move(at(1, 40, 0, 40))).toMatchObject({ type: 'dragMove' });
  });

  it('never moves the primary drag from the lift finger, nor lifts from the primary', () => {
    const g = dragging();
    g.down(at(2, 100, 200, 20));
    expect(g.move(at(2, 300, 200, 30))).toBeNull(); // sideways only: no lift, no drag
    expect(g.move(at(1, 30, -50, 40))).toMatchObject({ type: 'dragMove', x: 30, y: -50 });
  });

  it('keeps the camera disabled and unclaimed throughout, and hands it back at the end', () => {
    const g = dragging();
    g.down(at(2, 100, 200, 20));
    expect(g.cameraEnabled).toBe(false);
    g.move(at(2, 100, 120, 30));
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.cameraEnabled).toBe(false);
    g.up(at(1, 30, 0, 40));
    expect(g.cameraEnabled).toBe(true);
    // The lift finger outlives the drag: it never becomes a camera pointer or a tap.
    expect(g.move(at(2, 100, 100, 50))).toBeNull();
    expect(g.up(at(2, 100, 100, 60))).toBeNull();
    expect(g.owner).toBeNull();
    g.down(at(3, 0, 0, 70));
    expect(g.owner).toBe(OWNER.CAMERA);
  });

  it('takes only one lift finger; a third is ignored', () => {
    const g = dragging();
    g.down(at(2, 100, 200, 20));
    g.down(at(3, 200, 200, 30));
    expect(g.move(at(3, 200, 100, 40))).toBeNull();
    expect(g.move(at(2, 100, 190, 50))).toMatchObject({ type: 'lift', dy: 10 });
  });

  it('emits no lift before the press has become a drag', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, PART));
    g.down(at(2, 100, 200, 10));
    expect(g.move(at(2, 100, 150, 20))).toBeNull();
  });

  it('still ignores a second finger during a ring gesture', () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 0, 0, RING));
    g.move(at(1, 30, 0, 10));
    g.down(at(2, 100, 200, 20));
    expect(g.move(at(2, 100, 100, 30))).toBeNull();
    expect(g.owner).toBe(OWNER.GIZMO_RING);
  });

  it('lifts on the desktop wheel only while dragging a part (scroll up raises)', () => {
    const g = dragging();
    expect(g.wheel({ dy: -40 })).toEqual({ type: 'lift', owner: OWNER.DRAG_PART, hit: PART, dy: 40 });
    expect(g.wheel({ dy: 25 })).toMatchObject({ type: 'lift', dy: -25 });
    const idle = createGestureState(T);
    expect(idle.wheel({ dy: -40 })).toBeNull();
    idle.down(at(1, 0, 0, 0));
    expect(idle.wheel({ dy: -40 })).toBeNull(); // camera owns the wheel: zoom
  });
});

describe('modifier channel (Shift-held drag lifts on desktop)', () => {
  const dragging = () => {
    const g = createGestureState(T);
    g.down(at(1, 0, 100, 0, PART));
    g.move(at(1, 30, 100, 10)); // dragStart
    return g;
  };

  it('turns vertical travel into lift while held; horizontal travel still drags', () => {
    const g = dragging();
    g.modifier(true);
    expect(g.move(at(1, 40, 80, 20))).toEqual({ type: 'lift', owner: OWNER.DRAG_PART, hit: PART, dy: 20, x: 40, y: 100 });
    expect(g.move(at(1, 40, 90, 30))).toMatchObject({ type: 'lift', dy: -10, x: 40, y: 100 });
    // Sideways only: a plain plane drag, at the height the drag left off.
    expect(g.move(at(1, 70, 90, 40))).toEqual({ type: 'dragMove', owner: OWNER.DRAG_PART, hit: PART, x: 70, y: 100 });
  });

  it('resumes the plane drag mid-gesture on release, without a jump', () => {
    const g = dragging();
    g.modifier(true);
    g.move(at(1, 30, 60, 20)); // 40 px spent lifting
    g.modifier(false);
    expect(g.move(at(1, 30, 50, 30))).toEqual({ type: 'dragMove', owner: OWNER.DRAG_PART, hit: PART, x: 30, y: 90 });
    expect(g.up(at(1, 30, 50, 40))).toMatchObject({ type: 'dragEnd', y: 90 });
  });

  it('changes nothing for an unmodified drag', () => {
    const g = dragging();
    expect(g.move(at(1, 30, 60, 20))).toEqual({ type: 'dragMove', owner: OWNER.DRAG_PART, hit: PART, x: 30, y: 60 });
  });

  it('starts every gesture with nothing spent, though the key stays held across gestures', () => {
    const g = dragging();
    g.modifier(true);
    g.move(at(1, 30, 60, 20));
    g.up(at(1, 30, 60, 30));
    g.down(at(1, 0, 100, 40, PART));
    expect(g.move(at(1, 30, 100, 50))).toMatchObject({ type: 'dragStart', y: 100 });
    expect(g.move(at(1, 30, 70, 60))).toMatchObject({ type: 'lift', dy: 30, y: 100 });
  });

  it('only lifts a part drag — never a ring turn or the camera', () => {
    const ring = createGestureState(T);
    ring.modifier(true);
    ring.down(at(1, 0, 100, 0, RING));
    ring.move(at(1, 30, 100, 10));
    expect(ring.move(at(1, 30, 60, 20))).toMatchObject({ type: 'dragMove', owner: OWNER.GIZMO_RING, y: 60 });
    const camera = createGestureState(T);
    camera.modifier(true);
    camera.down(at(1, 0, 100, 0));
    expect(camera.move(at(1, 30, 40, 10))).toBeNull();
    expect(camera.cameraEnabled).toBe(true);
  });

  it('emits nothing before the press has become a drag', () => {
    const g = createGestureState(T);
    g.modifier(true);
    g.down(at(1, 0, 100, 0, PART));
    expect(g.move(at(1, 0, 95, 10))).toBeNull();
  });

  it('keeps the camera off a second pointer while Shift-lifting, and hands it back at the end', () => {
    const g = dragging();
    g.modifier(true);
    g.down(at(2, 200, 200, 20));
    expect(g.owner).toBe(OWNER.DRAG_PART);
    expect(g.cameraEnabled).toBe(false);
    // The second pointer is still the lift channel, never a camera pointer.
    expect(g.move(at(2, 200, 180, 30))).toEqual({ type: 'lift', owner: OWNER.DRAG_PART, hit: PART, dy: 20 });
    expect(g.move(at(1, 30, 80, 40))).toMatchObject({ type: 'lift', dy: 20 });
    expect(g.cameraEnabled).toBe(false);
    g.up(at(1, 30, 80, 50));
    expect(g.cameraEnabled).toBe(true);
    expect(g.move(at(2, 200, 100, 60))).toBeNull();
    expect(g.up(at(2, 200, 100, 70))).toBeNull();
    expect(g.owner).toBeNull();
  });

  it('a cancelled Shift-lift drag reports a cancel and hands the camera back', () => {
    const g = dragging();
    g.modifier(true);
    g.move(at(1, 30, 60, 20));
    expect(g.cancel(at(1, 30, 60, 30))).toMatchObject({ type: 'dragCancel', owner: OWNER.DRAG_PART });
    expect(g.cameraEnabled).toBe(true);
  });
});

describe('camera invariant under the modifier', () => {
  // Seeded random gestures with Shift toggling at random: the camera never claims a pointer
  // during a part gesture, and is handed back once every pointer has ended.
  it('never enables the camera mid part-gesture and always hands it back', () => {
    let seed = 4321;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const hits = [null, PART, RING];
    for (let run = 0; run < 500; run++) {
      const g = createGestureState(T);
      const live = new Set();
      let t = 0;
      for (let i = 0; i < 14; i++) {
        t += Math.floor(random() * 200);
        if (random() < 0.2) g.modifier(random() < 0.5);
        const id = 1 + Math.floor(random() * 3);
        const p = at(id, random() * 200, random() * 200, t);
        if (!live.has(id)) {
          g.down({ ...p, hit: hits[Math.floor(random() * 3)] });
          live.add(id);
        } else if (random() < 0.6) g.move(p);
        else {
          (random() < 0.7 ? g.up : g.cancel)(p);
          live.delete(id);
        }
        if (g.owner === OWNER.DRAG_PART || g.owner === OWNER.GIZMO_RING) expect(g.cameraEnabled).toBe(false);
      }
      for (const id of live) g.up(at(id, 0, 0, t + 1));
      expect(g.cameraEnabled).toBe(true);
      expect(g.owner).toBeNull();
    }
  });
});
