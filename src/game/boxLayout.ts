// The flatpack in the room: where the box and its lid sit, where every packed part lies,
// and where a recovered part is set down again. Pure — the pack's packing and the room's
// constants in, plain poses out — so Vitest checks it headlessly; src/scene/flatpack.js
// builds the box and main.js spawns the parts at these poses. The packed placements
// themselves are the pack's (items/johnny `packing.placements`), in the box-local frame:
// origin on the floor at the box's centre, its length along z, height along y.
//
// The box is a part the player can drag (1.7.1), so every pose here hangs off a box pose
// `{ position, rotation }` of that frame — by default where the room stands it at boot
// (`boxPlacement()`), or wherever it sits now (`boxPoseOf` its body's pose).

import { multiplyQuaternions, placeLayout, rotateVector } from '../../tools/validate/lib/geometry.js';
import type { Pose, Quat, Size, Vec3 } from '../../tools/validate/lib/geometry.js';
import { BOX, GESTURE, RESET, ROOM } from '../constants.js';
import { clampToRoom, rotatedHalfExtents } from './dragMath.js';
import { MANIFEST, PACKING, PART_TYPES } from './item.js';

/** A part laid flat: its rotation, [x, z] footprint and height. */
interface Lay {
  rotation: Quat;
  footprint: [number, number];
  height: number;
}

/** One slab of the box base, sized and offset in the base body's frame. */
export interface Slab {
  size: Vec3;
  offset: Vec3;
}

/** Where and how recovered parts are set down — RESET.respawn. */
type Respawn = typeof RESET.respawn;

/** A packed part in the room. */
export interface PackedPart extends Pose {
  id: string;
  type: string;
}

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
const IDENTITY: Quat = [0, 0, 0, 1];
// Quarter turn about z lays local x vertical; about x, local z. Each leaves the part's
// inner face (+x for a side) facing up, holes up.
const LAY_X_DOWN: Quat = [0, 0, QUARTER_TURN, QUARTER_TURN];
const LAY_Z_DOWN: Quat = [QUARTER_TURN, 0, 0, QUARTER_TURN];
// A further quarter turn about y swaps a footprint's x and z.
const TURN_Y: Quat = [0, QUARTER_TURN, 0, QUARTER_TURN];

/** Rotation laying a part on its largest face, plus the resulting [x, z] footprint and height. */
function layFlat([sx, sy, sz]: Size): Lay {
  const thinnest = Math.min(sx, sy, sz);
  if (sy === thinnest) return { rotation: IDENTITY, footprint: [sx, sz], height: sy };
  if (sx === thinnest) return { rotation: LAY_X_DOWN, footprint: [sy, sz], height: sx };
  return { rotation: LAY_Z_DOWN, footprint: [sx, sy], height: sz };
}

// A panel too long to lie across the box lies along it; one that fits across lies across.
function orient(type: string, width: number): Lay {
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
function packRows(items: Pick<Lay, 'footprint'>[], [minX, minZ, maxX, maxZ]: number[], gap: number) {
  const centres: [number, number][] = [];
  let row: [number, number][] = [];
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
    const centre: [number, number] = [x + w / 2, z + d / 2];
    centres.push(centre);
    row.push(centre);
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
  }
  closeRow();
  return centres;
}

/** Where the box stands in the room: `{ position, rotation }` of its box-local frame. */
export function boxPlacement(box: Pick<typeof PACKED_BOX, 'position' | 'yaw'> = PACKED_BOX): Pose {
  const half = box.yaw / 2;
  return { position: box.position, rotation: [0, Math.sin(half), 0, Math.cos(half)] };
}

/**
 * The box base as one body: its five cardboard slabs (bottom, two sides, two ends) as
 * `{ size, offset }` in the body's frame, which sits at the middle of the box's height —
 * the centre the router and the gizmo assume every part turns about.
 */
export function boxSlabs(box: Pick<typeof PACKED_BOX, 'inner' | 'wall' | 'floor'> = PACKED_BOX): Slab[] {
  const [width, height, length] = box.inner;
  const { wall, floor } = box;
  const outerW = width + 2 * wall;
  const centre = (floor + height) / 2;
  const slabs: { size: Vec3; at: Vec3 }[] = [
    { size: [outerW, floor, length + 2 * wall], at: [0, floor / 2, 0] },
    { size: [wall, height, length], at: [-(width + wall) / 2, floor + height / 2, 0] },
    { size: [wall, height, length], at: [(width + wall) / 2, floor + height / 2, 0] },
    { size: [outerW, height, wall], at: [0, floor + height / 2, -(length + wall) / 2] },
    { size: [outerW, height, wall], at: [0, floor + height / 2, (length + wall) / 2] },
  ];
  return slabs.map(({ size, at: [x, y, z] }) => ({ size, offset: [x, y - centre, z] }));
}

// The box base body's centre, in the box-local frame: halfway up the box.
const BASE_CENTRE: Vec3 = [0, (PACKED_BOX.floor + PACKED_BOX.inner[1]) / 2, 0];

/** The box base's body pose for a box standing at `pose`. */
export function baseRest(pose: Pose = boxPlacement()): Pose {
  const [rest] = placeLayout([{ position: BASE_CENTRE, rotation: IDENTITY }], pose);
  return { position: rest.position, rotation: rest.rotation };
}

/**
 * The box pose to lay out against for a box base body at `{ position, rotation }`: the box
 * stood upright on the floor where the body is, turned by the body's yaw alone, and held
 * inside the walls. A box left tilted (propped on a panel) or half through a wall still
 * gives a level frame in the room, so nothing is packed or respawned under the floor or
 * through a wall. For an upright box in the room it is exactly `baseRest`'s inverse.
 */
export function boxPoseOf({ position, rotation: [, qy, , qw] }: Pose): Pose {
  // The twist about vertical: the yaw part of the rotation (swing-twist decomposition).
  const norm = Math.hypot(qy, qw);
  const yaw: Quat = norm > 1e-9 ? [0, qy / norm, 0, qw / norm] : IDENTITY;
  const [hx, , hz] = rotatedHalfExtents(PART_TYPES.boxBase.size.map((d) => d / 2), yaw);
  const centre = rotateVector(yaw, BASE_CENTRE);
  const [x, , z] = clampToRoom(position.map((v, i) => v - centre[i]), [hx, hz], ROOM, GESTURE.wallMargin);
  return { position: [x, 0, z], rotation: yaw };
}

/** The lid's pose closed on the walls' top edges of a box at `pose`. */
export function lidRest(pose: Pose = boxPlacement()): Pose {
  const local: Pose = { position: [0, PACKED_BOX.floor + PACKED_BOX.inner[1] + PACKED_BOX.lidThickness / 2, 0], rotation: IDENTITY };
  const [rest] = placeLayout([local], pose);
  return { position: rest.position, rotation: rest.rotation };
}

/**
 * Where recovered parts of `types` are set down beside a box at `pose`, one `{ position,
 * rotation }` each: laid flat as they pack, side by side in a patch beside the box's long
 * side (as long as the box, plus the patch's clearance at each end), every one's
 * underside `respawn.height` above the floor so it drops into place. Those that don't fit
 * go in again a layer higher, so no two in one batch ever overlap. A box dragged against a
 * wall gets the patch on its other long side; one wedged in a corner, where neither side
 * fits inside the room, gets the patch beside where the box stood at boot.
 */
export function respawnSpots(types: string[], pose: Pose = boxPlacement(), respawn: Respawn = RESET.respawn): Pose[] {
  for (const side of [1, -1]) {
    const spots = spotsBeside(types, pose, side, respawn);
    if (spots.every((spot, i) => insideRoom(types[i], spot))) return spots;
  }
  return spotsBeside(types, boxPlacement(), 1, respawn);
}

// A part at `spot` lies wholly inside the room's walls.
function insideRoom(type: string, { position: [x, , z], rotation }: Pose) {
  const [hx, , hz] = rotatedHalfExtents(PART_TYPES[type].size.map((d) => d / 2), rotation);
  return Math.abs(x) + hx < ROOM.width / 2 && Math.abs(z) + hz < ROOM.depth / 2;
}

// The respawn patch on the box's +x (`side` 1) or −x (−1) long side.
function spotsBeside(types: string[], pose: Pose, side: number, respawn: Respawn): Pose[] {
  const box = PACKED_BOX;
  const [width, , length] = box.inner;
  const near = width / 2 + box.wall + respawn.offset;
  // Along the box, overhanging each end by the same clearance, so even the lid fits.
  const along = length / 2 + box.wall + respawn.offset;
  const patch = [near, -along, near + respawn.depth, along];
  const items = types.map((type, i) => ({ i, ...orient(type, width) }));
  const local: Pose[] = [];
  let pending = items;
  for (let layer = 0; pending.length; layer++) {
    const centres = packRows(pending, patch, respawn.gap);
    if (centres.length === 0) throw new Error('a recovered part is too big for the patch beside the box');
    const lift = respawn.height + layer * respawn.layerHeight;
    centres.forEach(([x, z], k) => {
      const { i, height, rotation } = pending[k];
      local[i] = { position: [side * x, lift + height / 2, z], rotation };
    });
    pending = pending.slice(centres.length);
  }
  return placeLayout(local, pose).map(({ position, rotation }) => ({ position, rotation }));
}

/**
 * Every part in a box at `pose` as the pack packs it, carried into the room — what main.js
 * spawns and repacks to: `{ id, type, position, rotation }` per manifest instance, spares
 * included.
 */
export function createPackedWorldLayout(pose: Pose = boxPlacement()): PackedPart[] {
  const typeOf = new Map(MANIFEST.map(({ id, type }) => [id, type]));
  const local = PACKING.placements.map(({ id, position, rotation }) => ({ id, type: typeOf.get(id)!, position, rotation }));
  return placeLayout(local, pose);
}
