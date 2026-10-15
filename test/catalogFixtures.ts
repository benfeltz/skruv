import type { CatalogEntry } from '../src/game/catalogModel.js';

// A catalog entry for the tests that only care about an item's id, name and box count: the
// category, colourway and size are placeholders, pinned where the real ones are (catalogModel.test.ts).
export const entry = (id: string, name: string, partCount: number): CatalogEntry => ({
  id,
  name,
  category: 'Thing',
  variants: [{ name: 'White', color: 'partPanel', article: '000.000.01' }],
  size: [10, 20, 30],
  partCount,
});
