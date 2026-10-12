import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/constants.js';
import { buildTarget, createCatalog } from '../src/game/catalogModel.js';
import { fanOffset, STACK_SLOT } from '../src/game/cornerStack.js';

// The catalog sheet's logic (1.9.1), headless: what BUILD IT picks on each page, and where
// each booklet sits in the corner stack. The sheet's touch feel and the fan's look are
// manual checks on a phone.

const entries = [
  { id: 'johnny', name: 'JOHNNY', partCount: 60 },
  { id: 'blank', name: 'BLANK', partCount: 9 },
];

describe('buildTarget', () => {
  const pages = createCatalog(entries, ['johnny', 'blank'], new Set(['blank']));

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
  it('puts the catalog behind the manual', () => {
    expect(STACK_SLOT.catalog).toBeGreaterThan(STACK_SLOT.manual);
  });

  it('leaves the front booklet where the thumb has always sat', () => {
    // No move at all (a signed zero is still no move).
    expect(Object.values(fanOffset(STACK_SLOT.manual, CATALOG.stack)).every((v) => v === 0)).toBe(true);
  });

  it('fans each place back by the stack knobs, up the screen', () => {
    const stack = { fanX: 10, fanY: 44, fanTurn: -0.12 };
    expect(fanOffset(1, stack)).toEqual({ x: 10, y: -44, turn: -0.12 });
    expect(fanOffset(2, stack)).toEqual({ x: 20, y: -88, turn: -0.24 });
  });
});
