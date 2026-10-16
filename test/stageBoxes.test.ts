import { describe, expect, it } from 'vitest';
import { PHYSICS, ROOM, STAGE } from '../src/constants.js';
import {
  WALL_NAMES,
  colliderBoxes,
  sizeAndCentre,
  skyRects,
  stageBoxes,
  wallBox,
  wallPieces,
  windowBoxes,
  windowOpenings,
  windowProblems,
} from '../src/game/stageBoxes.js';
import type { StageBox, WallName } from '../src/game/stageBoxes.js';

const by = <N extends string>(boxes: StageBox<N>[], name: string) => boxes.find((box) => box.name === name)!;
const volume = (box: StageBox<string>) => sizeAndCentre(box).size.reduce((a, b) => a * b, 1);
const drawn = stageBoxes();
const w = ROOM.width / 2;
const d = ROOM.depth / 2;
const win = STAGE.window;
// Per wall: the axis it runs along, the one through it, and where its inner face is.
const AXES: Record<WallName, { along: 0 | 2; across: 0 | 2; inner: number }> = {
  left: { along: 2, across: 0, inner: -w },
  back: { along: 0, across: 2, inner: -d },
};

describe('the stage as drawn', () => {
  it('has a slab whose top is the floor at y 0', () => {
    expect(by(drawn, 'slab').max[1]).toBe(0);
    expect(by(drawn, 'slab').min[1]).toBe(-STAGE.slabThickness);
  });

  it('puts the walls\' inner faces at the room\'s back and left edges, outside the footprint', () => {
    for (const name of WALL_NAMES) {
      const { across, inner } = AXES[name];
      for (const piece of wallPieces(name)) {
        expect(piece.max[across], piece.name).toBe(inner);
        expect(piece.max[1], piece.name).toBeLessThanOrEqual(STAGE.wallHeight);
      }
      expect(wallBox(name).max[1]).toBe(STAGE.wallHeight);
    }
  });

  it('stands as high as the lift ceiling', () => {
    expect(STAGE.wallHeight).toBe(ROOM.height);
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
    const names = drawn.map(({ name }) => name);
    expect(names.filter((n) => n.includes('Wall') && !n.startsWith('left') && !n.startsWith('back'))).toEqual([]);
    expect(names).toContain('frontLip');
    expect(names).toContain('rightLip');
  });
});

describe('the windows', () => {
  it('are one in the left wall, centred, and two evenly spaced in the back wall', () => {
    const left = windowOpenings('left');
    expect(left).toHaveLength(1);
    expect((left[0].a0 + left[0].a1) / 2).toBe(0);
    const back = windowOpenings('back');
    expect(back).toHaveLength(2);
    const centres = back.map((o) => (o.a0 + o.a1) / 2);
    // Equal gaps: edge, window, gap, window, edge — the room's extent in thirds.
    expect(centres[1] - centres[0]).toBeCloseTo(ROOM.width / 3, 9);
    expect(centres[0] + centres[1]).toBeCloseTo(0, 9);
  });

  it('are all 1.0 × 1.6 m with their bottom at 0.8 m', () => {
    for (const name of WALL_NAMES) {
      for (const o of windowOpenings(name)) {
        expect(o.a1 - o.a0).toBeCloseTo(1.0, 9);
        expect(o.y1 - o.y0).toBeCloseTo(1.6, 9);
        expect(o.y0).toBe(0.8);
      }
    }
  });

  it('leave a wall that is the old wall minus exactly the openings: the pieces tile it', () => {
    for (const name of WALL_NAMES) {
      const openings = windowOpenings(name);
      const cut = openings.reduce((sum, o) => sum + (o.a1 - o.a0) * (o.y1 - o.y0) * STAGE.wallThickness, 0);
      const total = wallPieces(name).reduce((sum, piece) => sum + volume(piece), 0);
      expect(total, name).toBeCloseTo(volume(wallBox(name)) - cut, 9);
      const { along } = AXES[name];
      for (const piece of wallPieces(name)) {
        for (const o of openings) {
          const inside = piece.min[along] < o.a1 && piece.max[along] > o.a0 && piece.min[1] < o.y1 && piece.max[1] > o.y0;
          expect(inside, `${piece.name} in an opening`).toBe(false);
        }
      }
    }
  });

  it('put the casing on the wall\'s inner face, casingProud into the room', () => {
    for (const name of WALL_NAMES) {
      const { across, inner } = AXES[name];
      const trim = windowBoxes(name);
      for (const part of ['CasingLow', 'CasingHigh', 'CasingHead']) {
        const box = by(trim, `${name}Window0${part}`);
        expect(box.min[across], box.name).toBe(inner);
        expect(box.max[across], box.name).toBeCloseTo(inner + win.casingProud, 9);
      }
    }
  });

  it('put the sill under the opening, past the casing by sillDepth, with the apron beneath', () => {
    for (const name of WALL_NAMES) {
      const { across, inner } = AXES[name];
      const trim = windowBoxes(name);
      const sill = by(trim, `${name}Window0Sill`);
      expect(sill.max[1]).toBe(win.sill);
      expect(sill.max[across]).toBeCloseTo(inner + win.casingProud + win.sillDepth, 9);
      const apron = by(trim, `${name}Window0Apron`);
      expect(apron.max[1]).toBe(sill.min[1]);
      expect(apron.max[across]).toBeCloseTo(inner + win.casingProud, 9);
    }
  });

  it('split the sashes with a horizontal rail at mid-height and no vertical bar', () => {
    for (const name of WALL_NAMES) {
      const { along } = AXES[name];
      const trim = windowBoxes(name);
      windowOpenings(name).forEach((o, i) => {
        const rail = by(trim, `${name}Window${i}Rail`);
        expect((rail.min[1] + rail.max[1]) / 2).toBeCloseTo((o.y0 + o.y1) / 2, 9);
        expect(rail.max[along] - rail.min[along]).toBeGreaterThan(rail.max[1] - rail.min[1]);
        const bars = trim.filter(
          (b) => b.name.startsWith(`${name}Window${i}`) && b.min[along] > o.a0 + win.frame && b.max[along] < o.a1 - win.frame && !b.name.endsWith('Rail'),
        );
        expect(bars).toEqual([]);
      });
    }
  });

  it('keep all trim at the wall face or in the opening, none behind the wall', () => {
    for (const name of WALL_NAMES) {
      const { across, inner } = AXES[name];
      for (const b of windowBoxes(name)) {
        expect(b.min[across], b.name).toBeGreaterThanOrEqual(inner - STAGE.wallThickness);
        expect(b.max[across], b.name).toBeLessThanOrEqual(inner + win.casingProud + win.sillDepth + 1e-9);
      }
    }
  });

  it('stand in the footprint only as casing, sill and apron, no lower than the apron\'s foot', () => {
    const lowest = win.sill - win.sillThickness - win.apron;
    for (const name of WALL_NAMES) {
      const { across, inner } = AXES[name];
      for (const b of windowBoxes(name)) {
        if (b.max[across] <= inner) continue;
        expect(b.name).toMatch(/Casing|Sill|Apron/);
        expect(b.min[1], b.name).toBeGreaterThanOrEqual(lowest - 1e-9);
      }
    }
  });

  it('do not touch each other\'s casings', () => {
    const trim = windowBoxes('back');
    const first = trim.filter((b) => b.name.startsWith('backWindow0'));
    const second = trim.filter((b) => b.name.startsWith('backWindow1'));
    const reach = Math.max(...first.map((b) => b.max[0]));
    expect(reach).toBeLessThan(Math.min(...second.map((b) => b.min[0])));
  });

  it('stand each in front of a sky outside the wall, facing the room, not above the wall top', () => {
    for (const name of WALL_NAMES) {
      const { across, inner } = AXES[name];
      const skies = skyRects(name);
      expect(skies).toHaveLength(win.count[name]);
      for (const sky of skies) {
        expect(sky.centre[across]).toBeLessThan(inner - STAGE.wallThickness);
        expect(sky.centre[1] + sky.height / 2).toBeLessThanOrEqual(STAGE.wallHeight + 1e-9);
        expect(sky.centre[1] - sky.height / 2).toBeGreaterThanOrEqual(0);
        expect(sky.width).toBeGreaterThan(win.width);
      }
    }
  });

  it('reach far enough past the opening to cover the steepest view the reveal lets through', () => {
    expect(win.skyMargin).toBeGreaterThanOrEqual(win.skyGap * (win.width / STAGE.wallThickness) - 1e-9);
  });

  it('are rejected when they do not fit the walls', () => {
    expect(windowProblems()).toEqual([]);
    expect(windowProblems({ ...win, height: 2.2 })).toContain('the casing head rises above the wall top');
    expect(windowProblems({ ...win, sill: 0.05 })).toContain('the apron reaches below the floor');
    expect(windowProblems({ ...win, frame: 0.5 })).toContain('the frame leaves no room for the sashes');
    expect(windowProblems({ ...win, width: 2.9 })).toContain('the back wall\'s windows and casings do not fit along it');
  });
});

describe('the stage as colliders', () => {
  const solid = colliderBoxes(PHYSICS.roomColliderThickness);

  it('keeps every inner face where it is drawn', () => {
    expect(by(solid, 'slab').max[1]).toBe(0);
    for (const name of WALL_NAMES) expect(by(solid, `${name}Wall`).max[AXES[name].across]).toBe(AXES[name].inner);
    expect(by(solid, 'frontLip').min[2]).toBe(d);
    expect(by(solid, 'rightLip').min[0]).toBe(w);
  });

  it('carries the walls up to the lift ceiling and leaves the lips as drawn', () => {
    for (const name of WALL_NAMES) expect(by(solid, `${name}Wall`).max[1]).toBe(ROOM.height);
    expect(by(solid, 'frontLip')).toEqual(by(drawn, 'frontLip'));
    expect(by(solid, 'rightLip')).toEqual(by(drawn, 'rightLip'));
  });

  it('keeps each wall one solid box across its windows, and no collider for the trim', () => {
    expect(solid.map(({ name }) => name).sort()).toEqual(['backWall', 'frontLip', 'leftWall', 'rightLip', 'slab']);
    for (const name of WALL_NAMES) {
      const { along } = AXES[name];
      const box = by(solid, `${name}Wall`);
      for (const o of windowOpenings(name)) {
        expect(box.min[along]).toBeLessThanOrEqual(o.a0);
        expect(box.max[along]).toBeGreaterThanOrEqual(o.a1);
        expect(box.min[1]).toBeLessThanOrEqual(o.y0);
        expect(box.max[1]).toBeGreaterThanOrEqual(o.y1);
      }
    }
  });

  it('is at least as thick as it is drawn, so a fast part cannot tunnel', () => {
    for (const name of ['slab', 'backWall', 'leftWall']) {
      const axis = by(solid, name).outward.findIndex((v) => v !== 0);
      expect(sizeAndCentre(by(solid, name)).size[axis], name).toBeGreaterThanOrEqual(PHYSICS.roomColliderThickness);
    }
  });
});
