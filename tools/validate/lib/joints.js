// Joints derived from the assembled poses — a pack never authors them. A fastener end that
// sits its sink depth down a compatible hole, axis against the hole's, IS a joint; nothing
// else is. Purely geometric: it knows the vocabulary and the contract, never the item.
//
// Joint records are the engine's: `{ hardware, hardwareConnector, host, hostConnector,
// kind, mover, through, captured }`, connectors as indices into the part's list. Order is
// deterministic — assembled order, then connector index.

import { connectorInWorld, contains } from './geometry.js';
import { COMPATIBLE, CONNECTOR, CONTRACT, isFastenerEnd, KIND, kindOf } from './vocabulary.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a, b) => Math.hypot(...sub(a, b));

/** True when instances of this part type carry a fastener end (fasteners and tools). */
export const isHardwareType = (partType) => partType.connectors.some((c) => isFastenerEnd(c.type));

/** Where a fastener end of `kind` sits once home in `hole` (world `{ position, axis }`). */
export const seatedPoint = (hole, kind) => {
  const sink = CONTRACT.sinkDepth[kind] ?? 0;
  return hole.position.map((v, i) => v - hole.axis[i] * sink);
};

/**
 * Every seated pair in the assembled poses. Each fastener end goes in the nearest
 * compatible, facing hole within `CONTRACT.mateReach` of its seated spot. A piece of
 * hardware is pushed in by its first seated end (`mover` is the hardware); any later end
 * has a panel pressed onto it (`mover` is that panel).
 */
export function pairJoints({ partTypes, assembled }) {
  const world = (inst, index) => connectorInWorld(partTypes[inst.type].connectors[index], inst);
  const holes = assembled.flatMap((inst) =>
    partTypes[inst.type].connectors.flatMap((c, index) => (isFastenerEnd(c.type) ? [] : [{ inst, index, type: c.type, at: world(inst, index) }])),
  );
  const joints = [];
  for (const inst of assembled) {
    let first = true;
    partTypes[inst.type].connectors.forEach((c, index) => {
      if (!isFastenerEnd(c.type)) return;
      const kind = kindOf(c.type);
      const end = world(inst, index);
      let best = null;
      let bestDistance = CONTRACT.mateReach;
      for (const hole of holes) {
        if (hole.inst === inst || hole.type !== COMPATIBLE[c.type] || dot(end.axis, hole.at.axis) >= 0) continue;
        const d = distance(end.position, seatedPoint(hole.at, kind));
        if (d <= bestDistance && (!best || d < bestDistance)) {
          best = hole;
          bestDistance = d;
        }
      }
      if (!best) return;
      joints.push({
        hardware: inst.id,
        hardwareConnector: index,
        host: best.inst.id,
        hostConnector: best.index,
        kind,
        mover: first ? inst.id : best.inst.id,
        through: null,
        captured: null,
      });
      first = false;
    });
  }
  return joints;
}

/**
 * Each cam joint's `captured`: the bolt head (of the bolts seated in `joints`) nearest its
 * recess within `CONTRACT.captureRadius` — any bolt, whichever instance — or null. Equal
 * distances go to the later bolt, as the engine's own capture does.
 */
export function captureBolts({ partTypes, assembled }, joints) {
  const byId = new Map(assembled.map((inst) => [inst.id, inst]));
  const world = (id, index) => connectorInWorld(partTypes[byId.get(id).type].connectors[index], byId.get(id));
  const heads = joints
    .filter((j) => j.kind === KIND.BOLT)
    .flatMap((j) => {
      const headIndex = partTypes[byId.get(j.hardware).type].connectors.findIndex((c) => c.type === CONNECTOR.BOLT_HEAD);
      return headIndex < 0 ? [] : [{ id: j.hardware, position: world(j.hardware, headIndex).position }];
    });
  return joints.map((j) => {
    if (j.kind !== KIND.CAM) return j;
    const recess = world(j.host, j.hostConnector).position;
    let captured = null;
    let bestDistance = CONTRACT.captureRadius;
    for (const head of heads) {
      const d = distance(head.position, recess);
      if (d <= bestDistance) {
        captured = head.id;
        bestDistance = d;
      }
    }
    return { ...j, captured };
  });
}

/**
 * Each back fitting joint's `through`: the first panel (not hardware, not the fitting's
 * own host) whose box holds the fitting's tip, or null.
 */
export function passThrough({ partTypes, assembled }, joints) {
  const byId = new Map(assembled.map((inst) => [inst.id, inst]));
  const panels = assembled.filter((inst) => !isHardwareType(partTypes[inst.type]));
  return joints.map((j) => {
    if (j.kind !== KIND.FITTING) return j;
    const fitting = byId.get(j.hardware);
    const tip = connectorInWorld(partTypes[fitting.type].connectors[j.hardwareConnector], fitting).position;
    const behind = panels.find((p) => p.id !== j.host && contains(partTypes[p.type].size, p, tip));
    return { ...j, through: behind?.id ?? null };
  });
}

/** The item's joints, from `{ partTypes, assembled }` (a loaded pack). */
export function deriveJoints(pack) {
  return passThrough(pack, captureBolts(pack, pairJoints(pack)));
}
