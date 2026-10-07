import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/constants.js';
import { MANIFEST as CATALOG_MANIFEST, PART_TYPES as CATALOG_PART_TYPES } from '../src/game/catalog.js';
import { IDENTITY, MANIFEST, PART_TYPES, SPARES } from '../src/game/item.js';

// Guard while catalog.js still exists: the pack, loaded, is exactly today's data.
const withoutIds = (types) =>
  Object.fromEntries(Object.entries(types).map(([type, part]) => [type, { ...part, connectors: part.connectors.map(({ id, ...c }) => c) }]));

describe('src/game/item.js', () => {
  it('loads the same part types as catalog.js, connectors in the same order', () => {
    expect(withoutIds(PART_TYPES)).toEqual(CATALOG_PART_TYPES);
  });

  it('names every connector', () => {
    for (const part of Object.values(PART_TYPES)) for (const c of part.connectors) expect(c.id).toMatch(/^[A-Za-z]+-\d+$/);
  });

  it('loads the same manifest as catalog.js, ids and order', () => {
    expect(MANIFEST).toEqual(CATALOG_MANIFEST);
  });

  it('sets aside two spare dowels and two spare cam locks, numbered last', () => {
    expect([...SPARES]).toEqual(['dowel-15', 'dowel-16', 'camLock-9', 'camLock-10']);
  });

  it('carries the brand as the pack identity', () => {
    expect(IDENTITY).toMatchObject(BRAND);
  });
});
