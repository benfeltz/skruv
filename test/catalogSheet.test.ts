import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI, CATALOG } from '../src/constants.js';
import { buildTarget, createCatalog } from '../src/game/catalogModel.js';
import { fanOffset, STACK_DEPTH, STACK_SLOT } from '../src/game/cornerStack.js';

// The catalog sheet's logic (1.9.1), headless: what BUILD IT picks on each page, and where
// each booklet sits in the corner stack. The sheet's touch feel and the fan's look are
// manual checks on a phone.

const entries = [
  { id: 'johnny', name: 'JOHNNY', partCount: 60 },
  { id: 'blank', name: 'BLANK', partCount: 9 },
];

describe('buildTarget', () => {
  const pages = createCatalog(entries, new Set(['blank']));

  it('picks the item on a buildable page only', () => {
    expect(pages.map(buildTarget)).toEqual([null, null, pages[2]]);
    expect(buildTarget(pages[2])).toMatchObject({ id: 'blank', name: 'BLANK' });
  });

  it('leaves a sold-out page inert', () => {
    const soldOut = pages[1];
    expect(soldOut).toMatchObject({ kind: 'item', id: 'johnny', pickable: false });
    expect(buildTarget(soldOut)).toBeNull();
  });
});

describe('the corner stack', () => {
  it('puts the catalog behind the manual, in the corner', () => {
    expect(STACK_SLOT.catalog).toBeGreaterThan(STACK_SLOT.manual);
    expect(STACK_DEPTH).toBe(STACK_SLOT.catalog);
  });

  it('fans the front one toward the room; the one behind stays in the corner, turned', () => {
    const stack = { fanX: 10, fanY: 44, fanTurn: -0.12 };
    // + 0 folds a signed zero into 0. The manual moves and doesn't turn; the catalog only turns.
    const front = fanOffset(STACK_SLOT.manual, stack);
    expect({ ...front, turn: front.turn + 0 }).toEqual({ x: 10, y: -44, turn: 0 });
    const back = fanOffset(STACK_SLOT.catalog, stack);
    expect({ x: back.x + 0, y: back.y + 0, turn: back.turn }).toEqual({ x: 0, y: 0, turn: -0.12 });
  });

  // Ben's 1.9.1 test: a pointer heading for the manual must never cross the catalog. A
  // pointer comes from the room, above and to the right of the corner: cast rays from the
  // manual's centre into that quarter (straight right round to straight up) and walk each
  // out — no point on any ray, once off the manual, may be on the catalog. With the shipped
  // knobs, and at the ends of their ?tune ranges.
  it.each([
    ['shipped', CATALOG.stack],
    ['tight', { fanX: 0, fanY: 20, fanTurn: -0.12 }],
    ['wide', { fanX: 40, fanY: 80, fanTurn: 0.12 }],
  ])('leaves every path from the room to the manual clear of the catalog (%s)', (_, stack) => {
    const w = BOOKLET_UI.thumbWidth;
    const h = (w * BOOKLET.pageSize[1]) / BOOKLET.pageSize[0];
    // A thumb as a polygon: its box at the corner (origin at its bottom-left, y down),
    // moved and turned about its centre as CSS does.
    const thumb = (slot: number) => {
      const { x, y, turn } = fanOffset(slot, stack);
      const [cx, cy] = [w / 2 + x, -h / 2 + y];
      return [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].map(([px, py]) => [cx + px * Math.cos(turn) - py * Math.sin(turn), cy + px * Math.sin(turn) + py * Math.cos(turn)]);
    };
    const inside = (poly: number[][], [px, py]: number[]) =>
      poly.every(([ax, ay], i) => {
        const [bx, by] = poly[(i + 1) % poly.length];
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0;
      });
    const manual = thumb(STACK_SLOT.manual);
    const catalog = thumb(STACK_SLOT.catalog);
    const [mx, my] = [manual.reduce((sum, [x]) => sum + x, 0) / 4, manual.reduce((sum, [, y]) => sum + y, 0) / 4];
    const crossings: string[] = [];
    for (let degrees = 0; degrees <= 90; degrees++) {
      const a = (degrees * Math.PI) / 180;
      for (let r = 0; r < 600; r += 0.5) {
        const p = [mx + r * Math.cos(a), my - r * Math.sin(a)];
        if (!inside(manual, p) && inside(catalog, p)) crossings.push(`${degrees}° at ${r}px`);
      }
    }
    expect(crossings).toEqual([]);
  });

  it('leaves a thumb-sized strip of catalog showing below the manual', () => {
    expect(CATALOG.stack.fanY).toBeGreaterThanOrEqual(BOOKLET_UI.thumbWidth / 2);
  });
});
