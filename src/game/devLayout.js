// TEMPORARY — dev-only floor layout so the full manifest is visible under physics.
// PR 5's unbox flow replaces this module; nothing else should come to depend on it.

import { DEV_LAYOUT } from '../constants.js';
import { MANIFEST, PART_TYPES } from './catalog.js';

const QUARTER_TURN = Math.SQRT1_2;
const IDENTITY = [0, 0, 0, 1];
// Quarter turn about z lays local x vertical; about x, local z.
const LAY_X_DOWN = [0, 0, QUARTER_TURN, QUARTER_TURN];
const LAY_Z_DOWN = [QUARTER_TURN, 0, 0, QUARTER_TURN];

/** Rotation laying a part on its largest face, plus the resulting [x, z] footprint and height. */
function layFlat([sx, sy, sz]) {
  const thinnest = Math.min(sx, sy, sz);
  if (sy === thinnest) return { rotation: IDENTITY, footprint: [sx, sz], height: sy };
  if (sx === thinnest) return { rotation: LAY_X_DOWN, footprint: [sy, sz], height: sx };
  return { rotation: LAY_Z_DOWN, footprint: [sx, sy], height: sz };
}

/**
 * One `{ id, type, position, rotation, footprint }` per manifest instance: each part flat
 * on its largest face, packed left-to-right into rows, the whole layout centred on the
 * origin. Positions are body centres just above the floor; rotations are [x, y, z, w].
 */
export function createDevLayout(manifest = MANIFEST) {
  const { rowWidth, gap, dropHeight } = DEV_LAYOUT;
  const placed = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;

  for (const { id, type } of manifest) {
    const { rotation, footprint, height } = layFlat(PART_TYPES[type].size);
    const [w, d] = footprint;
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      z += rowDepth + gap;
      rowDepth = 0;
    }
    placed.push({ id, type, rotation, footprint, center: [x + w / 2, height / 2 + dropHeight, z + d / 2] });
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
  }

  const maxX = Math.max(...placed.map((p) => p.center[0] + p.footprint[0] / 2));
  const maxZ = z + rowDepth;
  return placed.map(({ center: [cx, cy, cz], ...part }) => ({
    ...part,
    position: [cx - maxX / 2, cy, cz - maxZ / 2],
  }));
}
