// The flatpack in the room: where the box and its lid sit, where every packed part lies,
// and where a recovered part is set down again. Pure — the pack's packing and the room's
// constants in, plain poses out — so Vitest checks it headlessly; src/scene/flatpack.js
// builds the box and main.js spawns the parts at these poses. The packed placements
// themselves are the pack's (items/johnny `packing.placements`), in the box-local frame:
// origin on the floor at the box's centre, its length along z, height along y.

import { multiplyQuaternions, placeLayout } from '../../tools/validate/lib/geometry.js';
import { BOX, RESET } from '../constants.js';
import { MANIFEST, PACKING, PART_TYPES } from './item.js';

/**
 * The box as packed and placed: the pack's inside, walls and lid (`inner`, `wall`,
 * `floor`, `lidThickness`), stood where the room puts it (`position`, `yaw`).
 */
export const PACKED_BOX = Object.freeze({
  ...BOX,
  inner: PACKING.boxInner,
  wall: PACKING.wall,
  floor: PACKING.floor,
  lidThickness: PACKING.lid.thickness,
});

const QUARTER_TURN = Math.SQRT1_2;
const IDENTITY = [0, 0, 0, 1];
// Quarter turn about z lays local x vertical; about x, local z. Each leaves the part's
// inner face (+x for a side) facing up, holes up.
const LAY_X_DOWN = [0, 0, QUARTER_TURN, QUARTER_TURN];
const LAY_Z_DOWN = [QUARTER_TURN, 0, 0, QUARTER_TURN];
// A further quarter turn about y swaps a footprint's x and z.
const TURN_Y = [0, QUARTER_TURN, 0, QUARTER_TURN];

/** Rotation laying a part on its largest face, plus the resulting [x, z] footprint and height. */
function layFlat([sx, sy, sz]) {
  const thinnest = Math.min(sx, sy, sz);
  if (sy === thinnest) return { rotation: IDENTITY, footprint: [sx, sz], height: sy };
  if (sx === thinnest) return { rotation: LAY_X_DOWN, footprint: [sy, sz], height: sx };
  return { rotation: LAY_Z_DOWN, footprint: [sx, sy], height: sz };
}

// A panel too long to lie across the box lies along it; one that fits across lies across.
function orient(type, width) {
  const flat = layFlat(PART_TYPES[type].size);
  const [fx, fz] = flat.footprint;
  const along = Math.max(fx, fz) > width;
  const turned = along ? fz < fx : fz > fx;
  if (!turned) return flat;
  return { ...flat, rotation: multiplyQuaternions(TURN_Y, flat.rotation), footprint: [fz, fx] };
}

/**
 * Shelf-packs `items` (`{ footprint: [x, z] }`) into a rectangle `[minX, minZ, maxX, maxZ]`
 * row by row with `gap` between neighbours, each row centred across; returns the [x, z]
 * centres of those that fit, in order, and stops at the first that does not.
 */
function packRows(items, [minX, minZ, maxX, maxZ], gap) {
  const centres = [];
  let row = [];
  let x = minX;
  let z = minZ;
  let rowDepth = 0;
  // Slides the finished row across so its slack is shared by both sides.
  const closeRow = () => {
    const slack = (maxX - (x - gap)) / 2;
    for (const centre of row) centre[0] += slack;
    row = [];
  };
  for (const { footprint: [w, d] } of items) {
    if (x > minX && x + w > maxX) {
      closeRow();
      x = minX;
      z += rowDepth + gap;
      rowDepth = 0;
    }
    if (x + w > maxX + 1e-9 || z + d > maxZ + 1e-9) break;
    const centre = [x + w / 2, z + d / 2];
    centres.push(centre);
    row.push(centre);
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
  }
  closeRow();
  return centres;
}

/** Where the box stands in the room: `{ position, rotation }` of its box-local frame. */
export function boxPlacement(box = PACKED_BOX) {
  const half = box.yaw / 2;
  return { position: box.position, rotation: [0, Math.sin(half), 0, Math.cos(half)] };
}

/** The lid's pose closed on the walls' top edges, in the room. */
export function lidRest(box = PACKED_BOX) {
  const local = { position: [0, box.floor + box.inner[1] + box.lidThickness / 2, 0], rotation: IDENTITY };
  const [pose] = placeLayout([local], boxPlacement(box));
  return { position: pose.position, rotation: pose.rotation };
}

/**
 * Where recovered parts of `types` are set down, one `{ position, rotation }` each: laid
 * flat as they pack, side by side in a patch beside the box's long side (as long as the
 * box, plus the patch's clearance at each end), every one's
 * underside `respawn.height` above the floor so it drops into place. Those that don't fit
 * go in again a layer higher, so no two in one batch ever overlap.
 */
export function respawnSpots(types, box = PACKED_BOX, respawn = RESET.respawn) {
  const [width, , length] = box.inner;
  const near = width / 2 + box.wall + respawn.offset;
  // Along the box, overhanging each end by the same clearance, so even the lid fits.
  const along = length / 2 + box.wall + respawn.offset;
  const patch = [near, -along, near + respawn.depth, along];
  const items = types.map((type, i) => ({ i, ...orient(type, width) }));
  const local = [];
  let pending = items;
  for (let layer = 0; pending.length; layer++) {
    const centres = packRows(pending, patch, respawn.gap);
    if (centres.length === 0) throw new Error('a recovered part is too big for the patch beside the box');
    const lift = respawn.height + layer * respawn.layerHeight;
    centres.forEach(([x, z], k) => {
      const { i, height, rotation } = pending[k];
      local[i] = { position: [x, lift + height / 2, z], rotation };
    });
    pending = pending.slice(centres.length);
  }
  return placeLayout(local, boxPlacement(box)).map(({ position, rotation }) => ({ position, rotation }));
}

/**
 * Every part in the box as the pack packs it, carried into the room — what main.js spawns:
 * `{ id, type, position, rotation }` per manifest instance, spares included.
 */
export function createPackedWorldLayout(box = PACKED_BOX) {
  const typeOf = new Map(MANIFEST.map(({ id, type }) => [id, type]));
  const local = PACKING.placements.map(({ id, position, rotation }) => ({ id, type: typeOf.get(id), position, rotation }));
  return placeLayout(local, boxPlacement(box));
}
