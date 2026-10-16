import { describe, expect, it } from 'vitest';
import { ROOM } from '../src/constants.js';
import { wallPieces } from '../src/game/stageBoxes.js';
import { STAGE_WALLS, wallHidden } from '../src/scene/stageCutaway.js';

const { back, left } = STAGE_WALLS;
const hidden = (eye: [number, number, number]) => ({ back: wallHidden(eye, back), left: wallHidden(eye, left) });

describe('the stage walls', () => {
  it('stand on the room\'s back and left edges, facing in', () => {
    expect(back).toEqual({ point: [0, 0, -ROOM.depth / 2], inward: [0, 0, 1] });
    expect(left).toEqual({ point: [-ROOM.width / 2, 0, 0], inward: [1, 0, 0] });
  });

  it('read each wall as one plane: every piece\'s inner face is the wall\'s', () => {
    for (const [name, wall] of [['left', left], ['back', back]] as const) {
      for (const piece of wallPieces(name)) {
        expect(piece.outward, piece.name).toEqual(wall.inward.map((v) => 0 - v));
        const axis = wall.inward.findIndex((v) => v !== 0);
        expect(piece.max[axis], piece.name).toBe(wall.point[axis]);
      }
    }
  });
});

describe('wallHidden', () => {
  it('shows both walls to an eye in front of the room', () => {
    expect(hidden([0.5, 2, ROOM.depth])).toEqual({ back: false, left: false });
  });

  it('shows both walls to an eye inside the room', () => {
    expect(hidden([0, 1, 0])).toEqual({ back: false, left: false });
  });

  it('hides only the back wall behind it', () => {
    expect(hidden([0, 2, -ROOM.depth])).toEqual({ back: true, left: false });
  });

  it('hides only the left wall behind it', () => {
    expect(hidden([-ROOM.width, 2, 0])).toEqual({ back: false, left: true });
  });

  it('hides both from behind the corner', () => {
    expect(hidden([-ROOM.width, 2, -ROOM.depth])).toEqual({ back: true, left: true });
  });

  it('counts an eye exactly on a wall\'s plane as visible', () => {
    expect(hidden([-ROOM.width / 2, 2, -ROOM.depth / 2])).toEqual({ back: false, left: false });
  });

  it('ignores height: an eye over the wall tops, behind the wall, still hides it', () => {
    expect(hidden([0, 20, -ROOM.depth])).toEqual({ back: true, left: false });
  });
});
