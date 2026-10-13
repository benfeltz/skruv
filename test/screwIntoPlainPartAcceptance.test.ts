import { describe, expect, it, vi } from 'vitest';
import { connectorInWorld } from '../tools/validate/lib/geometry.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { FASTENER, GESTURE } from '../src/constants.js';
import { STATE } from '../src/game/fasteners.js';
import { PART_TYPES } from '../src/game/item.js';
import { FRAME, makePart, mount } from './support/routerBench.js';
import { RAIL_HOLE, SCREW_SLOT, SCREW_THREAD } from './support/screwParts.js';
import type { Pose, Vec3 } from '../tools/validate/lib/geometry.js';

vi.mock('../src/game/item.js', async (original) => (await import('./support/screwParts.js')).withScrews(await original()));

// A screw's tip ends in any part that is not hardware — also one with no connectors at all,
// the way a drawer bottom or a knob has none. The router asks the validator's rule
// (tools/validate/lib/vocabulary.ts `canPassInto`), so a screw driven into a plain block
// records it as `through`, exactly as `deriveJoints` does for the shipped pack.

const ORIGIN: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const TAP_FRAMES = Math.ceil(GESTURE.tapMaxMs / 1000 / FRAME);
const DRIVE_FRAMES = Math.ceil(FASTENER.driveSeconds / FRAME) + 5;

function bench() {
  const blockTop = PART_TYPES.block.size[1];
  const railAt: Vec3 = [0, blockTop + PART_TYPES.rail.size[1] / 2, 0];
  const hole = connectorInWorld(PART_TYPES.rail.connectors[RAIL_HOLE], { position: railAt, rotation: [0, 0, 0, 1] }).position;
  const screwHalf = PART_TYPES.woodScrew.size[1] / 2;
  const head: Vec3 = [hole[0], hole[1] + 2 * screwHalf, hole[2]];
  const driver = makePart('screwdriver-1', 'screwdriver', [head[0] + 0.03, head[1] + 0.05, head[2]]);
  const m = mount([
    makePart('block-1', 'block', [0, blockTop / 2, 0]),
    makePart('rail-1', 'rail', railAt),
    makePart('woodScrew-1', 'woodScrew', [hole[0], hole[1] + screwHalf, hole[2]]),
    driver,
  ]);
  const screw = m.assembly.seat({ partA: 'woodScrew-1', connectorA: SCREW_THREAD, partB: 'rail-1', connectorB: RAIL_HOLE, mover: 'woodScrew-1' });
  m.assembly.seat({ partA: 'screwdriver-1', connectorA: 0, partB: 'woodScrew-1', connectorB: SCREW_SLOT, mover: 'screwdriver-1' });
  const holdDriver = () => {
    const at = m.screen(driver.mesh.position);
    m.canvas.fire('pointerdown', at);
    m.hold(TAP_FRAMES + DRIVE_FRAMES);
    m.canvas.fire('pointerup', at);
  };
  return { ...m, screw, holdDriver, state: () => m.assembly.get(screw.id)! };
}

describe('a screw driven into a part with no connectors', () => {
  it('has no connectors on the block, so the panel predicate alone would never see it', () => {
    expect(PART_TYPES.block.connectors).toEqual([]);
  });

  it('records the block as the part behind, once home', () => {
    const b = bench();
    expect(b.screw.kind).toBe(KIND.SCREW);
    b.holdDriver();
    expect(b.state()).toMatchObject({ through: 'block-1', fastener: { state: STATE.SCREWED, progress: 1 } });
  });

  it('bonds the rail and the block rigidly, and lets go when the block is taken away', () => {
    const b = bench();
    b.holdDriver();
    expect(b.assembly.bonds(() => ORIGIN).filter((x) => x.key.startsWith('bridge:'))).toMatchObject([{ a: 'rail-1', b: 'block-1', mode: 'rigid' }]);
    expect(b.assembly.letGoOf(['block-1'])).toEqual([b.screw.id]);
    expect(b.state()).toMatchObject({ through: null, fastener: { state: STATE.SEATED } });
  });
});
