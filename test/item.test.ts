import { describe, expect, it } from 'vitest';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { ASSEMBLED, IDENTITY, MANIFEST, MANUAL, PACKING, PART_TYPES, resolveConnector, SPARES } from '../src/game/item.js';

describe('src/game/item.ts', () => {
  it('names every connector, in index order', () => {
    for (const part of Object.values(PART_TYPES)) for (const c of part.connectors) expect(c.id).toMatch(/^[A-Za-z]+-\d+$/);
    expect(resolveConnector('sidePanel-2/dowelHole-3')).toEqual({ part: 'sidePanel-2', connector: PART_TYPES.sidePanel.connectors.findIndex((c) => c.id === 'dowelHole-3') });
  });

  it('expands the manifest with the spares numbered last', () => {
    expect(MANIFEST.filter((p) => p.type === 'dowel').map((p) => p.id).slice(-2)).toEqual([...SPARES].slice(0, 2));
    expect(Object.isFrozen(MANIFEST)).toBe(true);
  });

  it('sizes the lid to close over the box walls, from the pack', () => {
    const { boxInner, wall, lid } = PACKING;
    expect(PART_TYPES.boxLid).toEqual({
      size: [boxInner[0] + 2 * wall, lid.thickness, boxInner[2] + 2 * wall],
      partNumber: lid.partNumber,
      mass: lid.mass,
      color: lid.color,
      connectors: [],
    });
  });

  it('works out the joints once, from the pack\'s poses', () => {
    expect(ASSEMBLED.joints).toEqual(deriveJoints({ partTypes: PART_TYPES, assembled: ASSEMBLED.parts }));
    expect(ASSEMBLED.parts.every((p) => PART_TYPES[p.type])).toBe(true);
  });

  it('carries the identity and the manual as the pack writes them', () => {
    expect(IDENTITY.product).toBe('JOHNNY');
    expect(MANUAL.pages[0]).toEqual({ kind: 'cover' });
  });
});
