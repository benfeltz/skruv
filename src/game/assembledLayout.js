// The complete upright JOHNNY, as data: one pose per part instance and one record per
// seated connector pair. Pure — catalog in, plain records out ([x, y, z] positions,
// [x, y, z, w] quaternions) — so Vitest checks the geometry headlessly.
//
// This describes the furniture item, never the player: the display shelf is spawned from
// it and the booklet's pages are drawn from it. Nothing compares a player's build to it.
//
// Frame: origin on the floor under the carcass centre, front facing +z, left side at -x.
// Panels are posed directly or mated hole-to-hole onto a panel already posed; every piece
// of hardware is posed seated in its hole, `FASTENER.sinkDepth` deep. Whether every OTHER
// pair then lines up is exactly what test/assembledLayout.test.js checks.

import { FASTENER } from '../constants.js';
import { capture, connectorInWorld } from './assembly.js';
import { CONNECTOR, MANIFEST, PART_TYPES } from './catalog.js';
import { multiplyQuaternions, rotateVector, rotationBetween } from './snapMath.js';
import { kindOf } from './fasteners.js';

const IDENTITY = [0, 0, 0, 1];
// Half turns: the right side is the left one turned about y; the bottom panel is turned
// about z so its cam recesses face up into the carcass.
const HALF_TURN_Y = [0, 1, 0, 0];
const HALF_TURN_Z = [0, 0, 1, 0];

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const negate = (a) => scale(a, -1);
const conjugate = ([x, y, z, w]) => [-x, -y, -z, w];

/** Connector indices of `type` with connector type `connectorType`. */
const indicesOf = (type, connectorType) =>
  PART_TYPES[type].connectors.flatMap((c, i) => (c.type === connectorType ? [i] : []));

// Manifest ids by type, lowest number first. A built JOHNNY takes them in order, so the
// bag's spares (the highest-numbered dowels and cam locks) and the tools are left over.
function instancesByType() {
  const byType = new Map();
  for (const { id, type } of MANIFEST) {
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(id);
  }
  return byType;
}

/** Pose of `type` placed so its connector `index` sits in world connector `hole`, `sink` deep. */
function seatedPose(type, index, hole, sink, rotation) {
  const local = PART_TYPES[type].connectors[index];
  const turn = rotation ?? rotationBetween(local.axis, negate(hole.axis));
  const target = sub(hole.position, scale(hole.axis, sink));
  return { position: sub(target, rotateVector(turn, local.position)), rotation: turn };
}

/** True when world `point` lies inside the box of a part posed at `pose`. */
export function contains(type, pose, point, tolerance = 1e-9) {
  const local = rotateVector(conjugate(pose.rotation), sub(point, pose.position));
  return local.every((v, i) => Math.abs(v) <= PART_TYPES[type].size[i] / 2 + tolerance);
}

/**
 * The built JOHNNY: `{ parts, joints }`.
 *   parts  — `{ id, type, role, position, rotation }`, one per instance that goes in it;
 *            `role` names the panel's place ('leftSide', 'rightSide', 'bottom', 'fixed',
 *            'top', 'plinth', 'back', 'shelf') or 'hardware'
 *   joints — `{ hardware, hardwareConnector, host, hostConnector, kind, mover, through,
 *            captured }` per seated pair, in the shape `assembly.seat` takes plus what the
 *            fastener needs to go home: the part behind a back fitting (`through`) and the
 *            bolt a cam catches (`captured`)
 */
export function createAssembledLayout() {
  const instances = instancesByType();
  const taken = new Map();
  const next = (type) => {
    const n = taken.get(type) ?? 0;
    taken.set(type, n + 1);
    const id = instances.get(type)?.[n];
    if (!id) throw new Error(`the box holds too few ${type}`);
    return id;
  };

  const parts = [];
  const poses = new Map();
  const place = (type, role, pose) => {
    const id = next(type);
    parts.push({ id, type, role, ...pose });
    poses.set(id, { type, ...pose });
    return id;
  };
  const world = (id, index) => {
    const { type, ...pose } = poses.get(id);
    return connectorInWorld(PART_TYPES[type].connectors[index], pose);
  };

  const side = PART_TYPES.sidePanel;
  const [thickness, height] = side.size;
  const innerWidth = PART_TYPES.topBottomPanel.size[0];
  const sideX = innerWidth / 2 + thickness / 2;

  const left = place('sidePanel', 'leftSide', { position: [-sideX, height / 2, 0], rotation: IDENTITY });
  const right = place('sidePanel', 'rightSide', { position: [sideX, height / 2, 0], rotation: HALF_TURN_Y });

  // The side's dowel-hole rows, lowest first: plinth, bottom panel, fixed shelf, top panel.
  const sideDowels = indicesOf('sidePanel', CONNECTOR.DOWEL_HOLE);
  const rows = [...new Set(sideDowels.map((i) => side.connectors[i].position[1]))].sort((a, b) => a - b);
  const rowOf = (i) => rows.indexOf(side.connectors[i].position[1]);

  // A horizontal part mated onto the left side: its hole facing the side at the row's
  // frontmost hole, onto the side's frontmost hole in that row.
  function mateToLeft(type, role, row, rotation) {
    const facing = indicesOf(type, CONNECTOR.DOWEL_HOLE)
      .map((i) => ({ i, at: connectorInWorld(PART_TYPES[type].connectors[i], { position: [0, 0, 0], rotation }) }))
      .filter(({ at }) => at.axis[0] < -0.5)
      .sort((a, b) => b.at.position[2] - a.at.position[2])[0];
    const hole = sideDowels
      .filter((i) => rowOf(i) === row)
      .map((i) => world(left, i))
      .sort((a, b) => b.position[2] - a.position[2])[0];
    return place(type, role, seatedPose(type, facing.i, hole, 0, rotation));
  }

  mateToLeft('plinth', 'plinth', 0, IDENTITY);
  mateToLeft('topBottomPanel', 'bottom', 1, HALF_TURN_Z);
  mateToLeft('fixedShelf', 'fixed', 2, IDENTITY);
  mateToLeft('topBottomPanel', 'top', 3, IDENTITY);

  // Flush with the carcass top, against the sides' back edges.
  const back = PART_TYPES.backPanel.size;
  place('backPanel', 'back', {
    position: [0, height - back[1] / 2, -side.size[2] / 2 - back[2] / 2],
    rotation: IDENTITY,
  });

  const joints = [];
  const panels = () => parts.filter((p) => p.role !== 'hardware');
  // The panel (other than `except`) whose box holds a world point.
  const panelAt = (point, except) => panels().find((p) => p.id !== except && contains(p.type, p, point))?.id ?? null;

  // Hardware of `type`, its connector `index` seated in `host`'s connector `hostIndex`.
  function seatHardware(type, index, host, hostIndex, extra = {}) {
    const local = PART_TYPES[type].connectors[index];
    const kind = kindOf(local.type);
    const pose = seatedPose(type, index, world(host, hostIndex), FASTENER.sinkDepth[kind]);
    const id = place(type, 'hardware', pose);
    const joint = { hardware: id, hardwareConnector: index, host, hostConnector: hostIndex, kind, mover: id, through: null, captured: null, ...extra };
    joints.push(joint);
    return { id, joint };
  }

  // Dowels: one end into each horizontal part's end holes, the other end into whichever
  // side hole that end now sits in (the side was pressed onto them, so the side moved).
  const dowelLow = 0;
  const dowelHigh = 1;
  for (const panel of panels().filter((p) => ['plinth', 'bottom', 'fixed', 'top'].includes(p.role))) {
    for (const hostIndex of indicesOf(panel.type, CONNECTOR.DOWEL_HOLE)) {
      const { id } = seatHardware('dowel', dowelLow, panel.id, hostIndex);
      const end = connectorInWorld(PART_TYPES.dowel.connectors[dowelHigh], parts.at(-1));
      const sideId = end.position[0] < 0 ? left : right;
      // The nearest hole; whether the end really sits in it is the pose-integrity test's call.
      const sideIndex = nearest(sideDowels, (i) => distance(world(sideId, i).position, end.position));
      joints.push({ hardware: id, hardwareConnector: dowelHigh, host: sideId, hostConnector: sideIndex, kind: kindOf(CONNECTOR.DOWEL_END), mover: sideId, through: null, captured: null });
    }
  }

  // Cam bolts screwed into both sides' bolt holes.
  for (const sideId of [left, right]) {
    for (const hostIndex of indicesOf('sidePanel', CONNECTOR.CAM_BOLT_HOLE)) seatHardware('camLockBolt', 0, sideId, hostIndex);
  }

  // A cam in every recess, catching the bolt head within reach (null if none is — the
  // pose-integrity test's call).
  const headIndex = indicesOf('camLockBolt', CONNECTOR.BOLT_HEAD)[0];
  const heads = joints
    .filter((j) => j.kind === kindOf(CONNECTOR.BOLT_THREAD))
    .map((j) => ({ id: j.hardware, position: world(j.hardware, headIndex).position }));
  for (const panel of panels().filter((p) => ['bottom', 'fixed', 'top'].includes(p.role))) {
    for (const hostIndex of indicesOf(panel.type, CONNECTOR.CAM_LOCK_RECESS)) {
      const recess = world(panel.id, hostIndex);
      seatHardware('camLock', 0, panel.id, hostIndex, { captured: capture(recess, heads)?.id ?? null });
    }
  }

  // Shelf pins in every pin hole, both sides.
  for (const sideId of [left, right]) {
    for (const hostIndex of indicesOf('sidePanel', CONNECTOR.SHELF_PIN_HOLE)) seatHardware('shelfPin', 0, sideId, hostIndex);
  }

  // Back fittings pressed through every back-panel hole into the panel behind it.
  const backId = parts.find((p) => p.role === 'back').id;
  for (const hostIndex of indicesOf('backPanel', CONNECTOR.BACK_FITTING_HOLE)) {
    const { id, joint } = seatHardware('backFitting', 0, backId, hostIndex);
    joint.through = panelAt(world(id, 0).position, backId);
  }

  // Adjustable shelves rest on their pins (no joint — they lift straight off), front edge
  // flush with the carcass front.
  const pinTop = PART_TYPES.shelfPin.size[0] / 2;
  const shelf = PART_TYPES.adjustableShelf.size;
  const pinRows = [...new Set(indicesOf('sidePanel', CONNECTOR.SHELF_PIN_HOLE).map((i) => world(left, i).position[1]))].sort((a, b) => a - b);
  for (const y of pinRows) {
    place('adjustableShelf', 'shelf', {
      position: [0, y + pinTop + shelf[1] / 2, side.size[2] / 2 - shelf[2] / 2],
      rotation: IDENTITY,
    });
  }

  return { parts, joints };
}

const distance = (a, b) => Math.hypot(...sub(a, b));
const nearest = (items, cost) => items.reduce((best, item) => (cost(item) < cost(best) ? item : best));

/** A layout's poses carried by a rigid placement `{ position, rotation }` — e.g. against a wall. */
export function placeLayout(parts, { position, rotation }) {
  return parts.map((part) => ({
    ...part,
    position: add(rotateVector(rotation, part.position), position),
    rotation: multiplyQuaternions(rotation, part.rotation),
  }));
}
