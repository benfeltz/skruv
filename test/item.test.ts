import { describe, expect, it } from 'vitest';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import * as door from '../src/game/item.js';
import { ASSEMBLED, IDENTITY, ITEM_IDS, itemById, MANIFEST, MANUAL, PACKING, PART_TYPES, resolveConnector, setItem, SPARES } from '../src/game/item.js';

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

// The door serves one current item out of a registry of every pack. Each piece of the
// current item is an export; setItem rebinds them all. A piece setItem forgot would keep
// serving the old item after a swap, with no error — so this checks every one by name.
describe('src/game/item.ts — the current item', () => {
  const served = () => ({
    packing: door.PACKING,
    partTypes: door.PART_TYPES,
    manifest: door.MANIFEST,
    spares: door.SPARES,
    identity: door.IDENTITY,
    assembled: door.ASSEMBLED,
    manual: door.MANUAL,
    resolve: door.resolveConnector,
  });

  it('serves JOHNNY by default', () => {
    expect(door.ITEM_ID).toBe('johnny');
    expect(ITEM_IDS).toContain('johnny');
    // Every piece but its kinds, which the booklet reads off the item it draws (itemById).
    const pieces = Object.entries(itemById('johnny')).filter(([key]) => key !== 'kinds');
    expect(served()).toEqual(Object.fromEntries(pieces));
  });

  it('serves every piece of the item setItem names, as live bindings', () => {
    for (const id of ITEM_IDS) {
      setItem(id);
      expect(door.ITEM_ID).toBe(id);
      const item = itemById(id);
      // Every piece the item has is served, and each is the item's own object — bar its kinds,
      // which only the booklet reads, off the item it draws (itemById).
      expect(Object.keys(served()).sort()).toEqual(Object.keys(item).filter((key) => key !== 'kinds').sort());
      for (const [key, value] of Object.entries(served())) expect(value, key).toBe(item[key as keyof typeof item]);
    }
    setItem('johnny');
  });

  it('throws on an unknown id and keeps the current item', () => {
    const before = served();
    expect(() => setItem('nope')).toThrow(/no item "nope"/);
    expect(() => itemById('nope')).toThrow(/no item "nope"/);
    expect(door.ITEM_ID).toBe('johnny');
    for (const [key, value] of Object.entries(served())) expect(value, key).toBe(before[key as keyof typeof before]);
  });
});

describe('src/game/item.ts — the fastener kinds (1.9.2)', () => {
  it("lists each item's kinds, read off its part types", () => {
    expect([...itemById('johnny').kinds].sort()).toEqual(['bolt', 'cam', 'dowel', 'fitting', 'pin', 'tool']);
    expect([...itemById('blank').kinds].sort()).toEqual(['stud', 'tool']);
    expect([...itemById('overkall').kinds].sort()).toEqual(['bolt', 'cam', 'dowel', 'fitting', 'screw', 'tool']);
  });
});
