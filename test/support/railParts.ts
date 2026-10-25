import type * as ItemModule from '../../src/game/item.js';
import type { GamePartType } from '../../src/game/item.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

// Drawer-on-rails part types for engine specs. No shipped pack carries a slide yet, so a spec
// lays these over the current item's PART_TYPES with
//   vi.mock('../src/game/item.js', async (original) => (await import('./support/railParts.js')).withRails(await original()));
// Geometry follows the plate-on-two-rails pack in test/validateChecks.test.ts: a plate (a drawer
// side) with a groove on each x face and a dowel hole top and bottom, a runner with one rail
// end, and a dowel.
export const RAIL_PARTS = Object.freeze({
  plate: {
    size: [0.02, 0.1, 0.3],
    color: 'partPanel',
    connectors: [
      { id: 'railGroove-1', type: 'railGroove', position: [-0.01, 0, 0.05], axis: [-1, 0, 0] },
      { id: 'railGroove-2', type: 'railGroove', position: [0.01, 0, -0.05], axis: [1, 0, 0] },
      { id: 'dowelHole-1', type: 'dowelHole', position: [0, 0.05, 0.1], axis: [0, 1, 0] },
      { id: 'dowelHole-2', type: 'dowelHole', position: [0, -0.05, 0.1], axis: [0, -1, 0] },
    ],
  },
  runner: {
    size: [0.012, 0.02, 0.3],
    color: 'partPanel',
    connectors: [{ id: 'railEnd-1', type: 'railEnd', position: [0.006, 0, 0.05], axis: [1, 0, 0] }],
  },
  dowel: {
    size: [0.008, 0.03, 0.008],
    color: 'partDowel',
    connectors: [
      { id: 'dowelEnd-1', type: 'dowelEnd', position: [0, -0.015, 0], axis: [0, -1, 0] },
      { id: 'dowelEnd-2', type: 'dowelEnd', position: [0, 0.015, 0], axis: [0, 1, 0] },
    ],
  },
} satisfies Record<string, GamePartType>);

export const PLATE_GROOVE_L = 0;
export const PLATE_GROOVE_R = 1;
export const PLATE_DOWEL_TOP = 2;
export const PLATE_DOWEL_BOTTOM = 3;
export const RUNNER_END = 0;
export const DOWEL_BOTTOM = 0;
export const DOWEL_TOP = 1;

/** The plate's travel from closed to open, along its z. */
export const RAIL_TRAVEL = 0.1;

const IDENTITY: Quat = [0, 0, 0, 1];
const HALF_TURN_Y: Quat = [0, 1, 0, 0];

/**
 * The closed layout of `plate-1` between `runner-1` (unturned) and `runner-2` (turned half a
 * turn about y, its rail end facing -x): the layout test/joints.test.ts derives two slide
 * joints from, the plate the mover. `open` is the plate's open position, when given.
 */
export function railsLayout(open?: Vec3) {
  const plate: { id: string; position: Vec3; rotation: Quat; open?: { position: Vec3; rotation: Quat } } = {
    id: 'plate-1',
    position: [0.016, 0, 0],
    rotation: IDENTITY,
  };
  if (open) plate.open = { position: open, rotation: IDENTITY };
  return [plate, { id: 'runner-1', position: [0, 0, 0] as Vec3, rotation: IDENTITY }, { id: 'runner-2', position: [0.032, 0, 0] as Vec3, rotation: HALF_TURN_Y }];
}

/**
 * `item` with RAIL_PARTS added to its PART_TYPES — live, as withScrews: a `setItem` on the real
 * module still swaps every export, the rail parts riding on whichever item is current.
 */
export function withRails(item: typeof ItemModule): typeof ItemModule {
  let from: (typeof ItemModule)['PART_TYPES'] | null = null;
  let merged = item.PART_TYPES;
  return new Proxy(item, {
    get(target, key, receiver) {
      if (key !== 'PART_TYPES') return Reflect.get(target, key, receiver);
      if (target.PART_TYPES !== from) {
        from = target.PART_TYPES;
        merged = Object.freeze({ ...from, ...RAIL_PARTS });
      }
      return merged;
    },
  });
}
