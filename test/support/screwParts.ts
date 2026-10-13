import type * as ItemModule from '../../src/game/item.js';
import type { GamePartType } from '../../src/game/item.js';

// Wood-screw part types for engine specs. No shipped pack carries a screw yet, so a spec
// lays these over the current item's PART_TYPES with
//   vi.mock('../src/game/item.js', async (original) => (await import('./support/screwParts.js')).withScrews(await original()));
// A thin rail with a screw hole on its top face, and a wood screw: thread end down, its
// drive slot on the head end up.
export const SCREW_PARTS = Object.freeze({
  rail: {
    size: [0.1, 0.01, 0.02],
    color: 'partPanel',
    connectors: [{ id: 'screwHole-1', type: 'screwHole', position: [0, 0.005, 0], axis: [0, 1, 0] }],
  },
  woodScrew: {
    size: [0.004, 0.03, 0.004],
    color: 'partMetal',
    connectors: [
      { id: 'screwThread-1', type: 'screwThread', position: [0, -0.015, 0], axis: [0, -1, 0] },
      { id: 'driveSlot-1', type: 'driveSlot', position: [0, 0.015, 0], axis: [0, 1, 0] },
    ],
  },
} satisfies Record<string, GamePartType>);

export const SCREW_THREAD = 0;
export const SCREW_SLOT = 1;
export const RAIL_HOLE = 0;

/**
 * `item` with SCREW_PARTS added to its PART_TYPES — live: a `setItem` on the real module
 * still swaps every export, the screw parts riding on whichever item is current.
 */
export function withScrews(item: typeof ItemModule): typeof ItemModule {
  let from: (typeof ItemModule)['PART_TYPES'] | null = null;
  let merged = item.PART_TYPES;
  return new Proxy(item, {
    get(target, key, receiver) {
      if (key !== 'PART_TYPES') return Reflect.get(target, key, receiver);
      if (target.PART_TYPES !== from) {
        from = target.PART_TYPES;
        merged = Object.freeze({ ...from, ...SCREW_PARTS });
      }
      return merged;
    },
  });
}
