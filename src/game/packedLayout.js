// The flatpack as data: where every part lies inside the closed box, and where the box and
// its lid sit in the room. Pure — catalog and constants in, plain poses out — so Vitest
// checks the packing headlessly; src/scene/flatpack.js builds the box and main.js spawns
// the parts at these poses. Replaces the dev floor grid: the game opens on the box.
//
// Stacking, as a real flatpack is packed: panels lie flat on their largest face, heaviest
// first, each layer filled row by row before the next starts on top of it — the sides on
// the bottom, the hardboard back over them, the horizontals and shelves above — and the
// loose hardware and tools on top, spread over the top layer's panels (no bags or
// cardboard spacers yet). Box-local frame: origin on the floor at the box's centre, its
// length along z, height along y.

import { BOX, PACK, RESET } from '../constants.js';
import { MANIFEST, PART_TYPES } from './catalog.js';
import { COMPATIBLE } from '../../tools/validate/lib/vocabulary.js';
import { multiplyQuaternions, placeLayout } from '../../tools/validate/lib/geometry.js';

const QUARTER_TURN = Math.SQRT1_2;
const IDENTITY = [0, 0, 0, 1];
// Quarter turn about z lays local x vertical; about x, local z. Each leaves the part's
// inner face (+x for a side) facing up, holes up.
const LAY_X_DOWN = [0, 0, QUARTER_TURN, QUARTER_TURN];
const LAY_Z_DOWN = [QUARTER_TURN, 0, 0, QUARTER_TURN];
// A further quarter turn about y swaps a footprint's x and z.
const TURN_Y = [0, QUARTER_TURN, 0, QUARTER_TURN];

const isHardware = (type) => PART_TYPES[type].connectors.some((c) => c.type in COMPATIBLE);

/** Rotation laying a part on its largest face, plus the resulting [x, z] footprint and height. */
function layFlat([sx, sy, sz]) {
  const thinnest = Math.min(sx, sy, sz);
  if (sy === thinnest) return { rotation: IDENTITY, footprint: [sx, sz], height: sy };
  if (sx === thinnest) return { rotation: LAY_X_DOWN, footprint: [sy, sz], height: sx };
  return { rotation: LAY_Z_DOWN, footprint: [sx, sy], height: sz };
}

// A panel too long to lie across the box lies along it; one that fits across lies across,
// so the short horizontals stack up the box's length one per row.
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

/**
 * One `{ id, type, position, rotation, footprint, layer }` per manifest instance, in the
 * box-local frame: position is the body centre resting on whatever lies beneath it,
 * footprint its [x, z] extent, layer 0 the box floor upward. Throws if the box is too
 * small for the manifest.
 */
export function createPackedLayout(manifest = MANIFEST, box = BOX, pack = PACK) {
  const [width, height, length] = box.inner;
  const inner = [-width / 2 + pack.gap, -length / 2 + pack.gap, width / 2 - pack.gap, length / 2 - pack.gap];
  const placed = [];
  let base = box.floor;

  // Panels, heaviest first: each layer takes as many as fit, the rest go on top.
  let panels = manifest
    .filter(({ type }) => !isHardware(type))
    .map(({ id, type }) => ({ id, type, ...orient(type, width) }))
    .sort((a, b) => PART_TYPES[b.type].mass - PART_TYPES[a.type].mass);
  const layers = [];
  while (panels.length) {
    const centres = packRows(panels, inner, pack.gap);
    if (centres.length === 0) throw new Error(`${panels[0].id} does not fit in the box`);
    const layer = panels.slice(0, centres.length);
    const thickness = Math.max(...layer.map((p) => p.height));
    for (const [i, p] of layer.entries()) {
      placed.push({ ...p, position: [centres[i][0], base + p.height / 2, centres[i][1]], layer: layers.length });
    }
    layers.push(layer.map((p, i) => ({ ...p, centre: centres[i] })));
    base += thickness;
    panels = panels.slice(centres.length);
  }

  // Hardware and tools on top, spread over the top layer's panels one after another, a
  // fingertip apart.
  let hardware = manifest.filter(({ type }) => isHardware(type)).map(({ id, type }) => ({ id, type, ...layFlat(PART_TYPES[type].size) }));
  for (const panel of layers.at(-1) ?? []) {
    if (!hardware.length) break;
    const [cx, cz] = panel.centre;
    const [w, d] = panel.footprint;
    const centres = packRows(hardware, [cx - w / 2 + pack.hardwareGap / 2, cz - d / 2 + pack.hardwareGap / 2, cx + w / 2, cz + d / 2], pack.hardwareGap);
    for (const [i, p] of hardware.slice(0, centres.length).entries()) {
      placed.push({ ...p, position: [centres[i][0], base + p.height / 2, centres[i][1]], layer: layers.length });
    }
    hardware = hardware.slice(centres.length);
  }
  if (hardware.length) throw new Error(`no room on top for ${hardware[0].id}`);

  const byId = new Map(placed.map((p) => [p.id, p]));
  return manifest.map(({ id }) => {
    const { type, position, rotation, footprint, layer } = byId.get(id);
    return { id, type, position, rotation, footprint, layer };
  });
}

/** Where the box stands in the room: `{ position, rotation }` of its box-local frame. */
export function boxPlacement(box = BOX) {
  const half = box.yaw / 2;
  return { position: box.position, rotation: [0, Math.sin(half), 0, Math.cos(half)] };
}

/** The lid's pose closed on the walls' top edges, in the room. */
export function lidRest(box = BOX) {
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
export function respawnSpots(types, box = BOX, respawn = RESET.respawn) {
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

/** The packed layout carried into the room — what main.js spawns. */
export const createPackedWorldLayout = (manifest = MANIFEST, box = BOX) => placeLayout(createPackedLayout(manifest, box), boxPlacement(box));
