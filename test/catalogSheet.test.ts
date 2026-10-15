import { describe, expect, it } from 'vitest';
import { buildTarget, createCatalog } from '../src/game/catalogModel.js';
import { entry } from './catalogFixtures.js';

// The catalog sheet's logic (1.9.1), headless: what BUILD IT picks on each page. The sheet's touch
// feel and the page's look are manual checks on a phone.

const entries = [
  entry('johnny', 'JOHNNY', 60),
  entry('blank', 'BLANK', 9),
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
