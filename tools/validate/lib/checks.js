// The Flatpack contract's semantic layer: what JSON Schema cannot say. Each rule is one
// small function over a schema-valid pack, returning `{ rule, path, message }` errors —
// none when the pack holds. Pure: assets are looked up through the caller's
// `assetExists(path)`, so the same checks run in Node and in the browser.
//
// These are 0.0.1's integrity tests, promoted to the contract; the mutated fixtures in
// test/validateChecks.test.js (one per rule) are the conformance seeds for other engines.

import { connectorInWorld, rotateVector } from './geometry.js';
import { deriveJoints, isHardwareType, seatedPoint } from './joints.js';
import { expandManifest, shapeParts } from './pack.js';
import { COMPATIBLE, CONTRACT, isFastenerEnd, KIND, kindOf } from './vocabulary.js';

// Bounds and packing are exact by construction; this only absorbs float noise.
const EPS = 1e-9;
const UNIT_LENGTH_TOLERANCE = 1e-9;

const error = (rule, path, message) => ({ rule, path, message });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a, b) => Math.hypot(...sub(a, b));

/**
 * What every rule reads, built tolerantly: a reference that does not resolve is reported
 * by `references`, never thrown. `joints` is null when the pack is too broken to pose.
 */
function context(pack) {
  const manifest = expandManifest(pack.parts);
  const typeOf = new Map(manifest.map((p) => [p.id, p.type]));
  let partTypes = null;
  try {
    partTypes = shapeParts(pack.parts);
  } catch {
    // Duplicate connector ids: `unique-ids` reports them.
  }
  const indexOf = (type, connectorId) => pack.parts[type]?.connectors.findIndex((c) => c.id === connectorId) ?? -1;
  const resolve = (ref) => {
    const [part, connectorId] = ref.split('/');
    const type = typeOf.get(part);
    const connector = type === undefined ? -1 : indexOf(type, connectorId);
    return connector < 0 ? null : { part, connector };
  };
  const assembled = pack.assembled.filter((a) => typeOf.has(a.id)).map((a) => ({ ...a, type: typeOf.get(a.id) }));
  const isTool = (type) => {
    const ends = pack.parts[type].connectors.filter((c) => isFastenerEnd(c.type));
    return ends.length > 0 && ends.every((c) => kindOf(c.type) === KIND.TOOL);
  };
  const spares = new Set(manifest.filter((p) => p.spare).map((p) => p.id));
  const joints = partTypes ? deriveJoints({ partTypes, assembled }) : null;
  const pages = pack.manual.pages.map((page, index) => ({ page, path: `manual.pages[${index}]` }));
  const steps = pages.filter(({ page }) => page.kind === 'step');
  return { pack, manifest, typeOf, partTypes, resolve, assembled, isTool, spares, joints, pages, steps };
}

const pairKey = (a, b) => `${a.part}#${a.connector}|${b.part}#${b.connector}`;
const jointKey = (j) => pairKey({ part: j.hardware, connector: j.hardwareConnector }, { part: j.host, connector: j.hostConnector });

/** Connector ids are unique on each part type. */
function uniqueIds({ pack }) {
  return Object.entries(pack.parts).flatMap(([type, part]) => {
    const seen = new Set();
    return part.connectors.flatMap(({ id }, i) => {
      if (!seen.has(id)) {
        seen.add(id);
        return [];
      }
      return [error('unique-ids', `parts.${type}.connectors[${i}].id`, `${type} names connector ${id} twice`)];
    });
  });
}

/** Every instance and connector a pack names exists. */
function references({ pack, typeOf, resolve, pages }) {
  const errors = [];
  const instance = (id, path) => {
    if (!typeOf.has(id)) errors.push(error('references', path, `no instance ${id} in the box`));
  };
  pack.assembled.forEach((a, i) => instance(a.id, `assembled[${i}].id`));
  pack.packing.placements.forEach((p, i) => instance(p.id, `packing.placements[${i}].id`));
  for (const { page, path } of pages) {
    (page.parts ?? []).forEach((id, i) => instance(id, `${path}.parts[${i}]`));
    for (const field of ['fasten', 'turn']) {
      (page[field] ?? []).forEach((pair, i) =>
        pair.forEach((ref, k) => {
          if (!resolve(ref)) errors.push(error('references', `${path}.${field}[${i}][${k}]`, `${ref} does not resolve`));
        }),
      );
    }
    if (page.tool !== undefined && !pack.parts[page.tool]) errors.push(error('references', `${path}.tool`, `no part type ${page.tool}`));
  }
  return errors;
}

/** Connector types and fastener kinds in use are declared in the pack's vocabulary. */
function vocabulary({ pack }) {
  const connectors = new Set(pack.vocabulary.connectors);
  const kinds = new Set(pack.vocabulary.fasteners);
  return Object.entries(pack.parts).flatMap(([type, part]) =>
    part.connectors.flatMap((c, i) => {
      const path = `parts.${type}.connectors[${i}].type`;
      if (!connectors.has(c.type)) return [error('vocabulary', path, `${c.type} is not in vocabulary.connectors`)];
      if (isFastenerEnd(c.type) && !kinds.has(kindOf(c.type))) return [error('vocabulary', path, `${kindOf(c.type)} is not in vocabulary.fasteners`)];
      return [];
    }),
  );
}

/** Connectors sit within their part's box, axes unit length. */
function connectorBounds({ pack }) {
  return Object.entries(pack.parts).flatMap(([type, part]) =>
    part.connectors.flatMap((c, i) => {
      const path = `parts.${type}.connectors[${i}]`;
      const errors = [];
      if (c.position.some((v, k) => Math.abs(v) > part.box[k] / 2 + EPS)) errors.push(error('connector-bounds', `${path}.position`, `${type}/${c.id} lies outside its part`));
      if (Math.abs(Math.hypot(...c.axis) - 1) > UNIT_LENGTH_TOLERANCE) errors.push(error('connector-bounds', `${path}.axis`, `${type}/${c.id} axis is not unit length`));
      return errors;
    }),
  );
}

/** Every instance but the spares and tools is assembled, exactly once; nothing else is. */
function assembledManifest({ pack, manifest, isTool, spares }) {
  const count = new Map();
  for (const { id } of pack.assembled) count.set(id, (count.get(id) ?? 0) + 1);
  return manifest.flatMap(({ id, type }) => {
    const n = count.get(id) ?? 0;
    const expected = spares.has(id) || isTool(type) ? 0 : 1;
    if (n === expected) return [];
    const what = expected ? 'must be assembled exactly once' : spares.has(id) ? 'is a spare and stays in the box' : 'is a tool and stays out of the item';
    return [error('assembled-manifest', 'assembled', `${id} ${what} (placed ${n}×)`)];
  });
}

/** Every fastener end of every assembled piece of hardware seats in a hole. */
function fastenerSeats({ partTypes, assembled, joints }) {
  if (!joints) return [];
  const seated = new Set(joints.map((j) => `${j.hardware}#${j.hardwareConnector}`));
  return assembled.flatMap((inst) =>
    partTypes[inst.type].connectors.flatMap((c, i) =>
      isFastenerEnd(c.type) && !seated.has(`${inst.id}#${i}`)
        ? [error('fastener-seats', `assembled[${inst.id}]`, `${inst.id}/${c.id} seats in no ${COMPATIBLE[c.type]}`)]
        : [],
    ),
  );
}

/** Mated pairs sit exactly home: the end its sink depth down the hole, axes opposed. */
function mateCoincidence({ partTypes, assembled, joints }) {
  if (!joints) return [];
  const byId = new Map(assembled.map((a) => [a.id, a]));
  const world = (id, index) => {
    const inst = byId.get(id);
    const c = partTypes[inst.type].connectors[index];
    return { id: c.id, ...connectorInWorld(c, inst) };
  };
  return joints.flatMap((j) => {
    const end = world(j.hardware, j.hardwareConnector);
    const hole = world(j.host, j.hostConnector);
    const off = distance(end.position, seatedPoint(hole, j.kind));
    const skew = distance(end.axis, hole.axis.map((v) => -v));
    if (off <= CONTRACT.mateTolerance && skew <= CONTRACT.mateTolerance) return [];
    return [error('mate-coincidence', `assembled[${j.hardware}]`, `${j.hardware}/${end.id} sits ${off.toExponential(2)} m off ${j.host}/${hole.id} (axis off ${skew.toExponential(2)})`)];
  });
}

/** No hole takes two fasteners. */
function holeOnce({ joints }) {
  if (!joints) return [];
  const seen = new Set();
  return joints.flatMap((j) => {
    const key = `${j.host}#${j.hostConnector}`;
    if (!seen.has(key)) {
      seen.add(key);
      return [];
    }
    return [error('hole-once', `assembled[${j.hardware}]`, `${j.host} connector ${j.hostConnector} takes a second fastener (${j.hardware})`)];
  });
}

/** Every cam catches its own bolt head; every back fitting passes into a panel. */
function camAndFitting({ joints }) {
  if (!joints) return [];
  const caught = new Set();
  return joints.flatMap((j) => {
    if (j.kind === KIND.CAM) {
      if (!j.captured) return [error('cam-capture', `assembled[${j.hardware}]`, `${j.hardware} has no bolt head within ${CONTRACT.captureRadius} m`)];
      if (caught.has(j.captured)) return [error('cam-capture', `assembled[${j.hardware}]`, `${j.hardware} catches ${j.captured}, already caught`)];
      caught.add(j.captured);
    }
    if (j.kind === KIND.FITTING && !j.through) return [error('fitting-through', `assembled[${j.hardware}]`, `${j.hardware} passes into no panel`)];
    return [];
  });
}

/** Step pages fasten every derived joint exactly once, and turn every cam exactly once. */
function stepCoverage({ joints, resolve, steps }) {
  if (!joints) return [];
  const errors = [];
  const derived = new Map(joints.map((j) => [jointKey(j), j]));
  const fastened = new Map();
  const turned = new Map();
  for (const { page, path } of steps) {
    for (const [field, tally] of [['fasten', fastened], ['turn', turned]]) {
      (page[field] ?? []).forEach(([end, hole], i) => {
        const a = resolve(end);
        const b = resolve(hole);
        if (!a || !b) return;
        const joint = derived.get(pairKey(a, b));
        if (!joint) errors.push(error('step-coverage', `${path}.${field}[${i}]`, `${end} → ${hole} is no joint of the assembled item`));
        else if (field === 'turn' && joint.kind !== KIND.CAM) errors.push(error('step-coverage', `${path}.${field}[${i}]`, `${end} is not a cam; only cams turn`));
        else tally.set(jointKey(joint), (tally.get(jointKey(joint)) ?? 0) + 1);
      });
    }
  }
  for (const j of joints) {
    const n = fastened.get(jointKey(j)) ?? 0;
    if (n !== 1) errors.push(error('step-coverage', 'manual.pages', `${j.hardware} → ${j.host} is fastened on ${n} step pages, not 1`));
    if (j.kind === KIND.CAM && (turned.get(jointKey(j)) ?? 0) !== 1) errors.push(error('step-coverage', 'manual.pages', `${j.hardware} is turned on ${turned.get(jointKey(j)) ?? 0} step pages, not 1`));
  }
  return errors;
}

/**
 * Pages run in number order; every panel is brought in on one page, no later than the
 * first joint into it; a cam turns on or after the page that seats it.
 */
function stepOrder({ partTypes, assembled, resolve, pages, steps }) {
  const errors = [];
  const numbered = pages.filter(({ page }) => page.number !== undefined);
  numbered.forEach(({ page, path }, i) => {
    if (page.number !== i + 1) errors.push(error('step-order', `${path}.number`, `page number ${page.number} should be ${i + 1}`));
  });
  if (!partTypes) return errors;
  const introduced = new Map();
  for (const { page, path } of steps) {
    for (const id of page.parts ?? []) {
      if (introduced.has(id)) errors.push(error('step-order', `${path}.parts`, `${id} is brought in twice`));
      else introduced.set(id, page.number);
    }
  }
  for (const inst of assembled) {
    if (!isHardwareType(partTypes[inst.type]) && !introduced.has(inst.id)) errors.push(error('step-order', 'manual.pages', `${inst.id} is never brought in`));
  }
  const seatedOn = new Map();
  for (const { page, path } of steps) {
    (page.fasten ?? []).forEach(([end, hole], i) => {
      const a = resolve(end);
      const b = resolve(hole);
      if (!a || !b) return;
      if (!seatedOn.has(a.part)) seatedOn.set(a.part, page.number);
      const at = introduced.get(b.part);
      if (at !== undefined && at > page.number) {
        errors.push(error('step-order', `${path}.fasten[${i}]`, `${b.part} takes a fastener on page ${page.number} before it is brought in on page ${at}`));
      }
    });
  }
  for (const { page, path } of steps) {
    (page.turn ?? []).forEach(([end], i) => {
      const a = resolve(end);
      const seated = a && seatedOn.get(a.part);
      if (a && (seated === undefined || seated > page.number)) errors.push(error('step-order', `${path}.turn[${i}]`, `${a.part} turns on page ${page.number} before it is seated`));
    });
  }
  return errors;
}

/** Steps seat each built-in hardware type's quantity, spares never. */
function counts({ pack, typeOf, spares, resolve, steps, isTool }) {
  const errors = [];
  const seated = new Map();
  for (const { page, path } of steps) {
    (page.fasten ?? []).forEach(([end], i) => {
      const a = resolve(end);
      if (!a) return;
      if (spares.has(a.part)) errors.push(error('counts', `${path}.fasten[${i}]`, `${a.part} is a spare and is never fastened in a step`));
      const type = typeOf.get(a.part);
      if (!seated.has(type)) seated.set(type, new Set());
      seated.get(type).add(a.part);
    });
  }
  for (const [type, part] of Object.entries(pack.parts)) {
    if (isTool(type) || !part.connectors.some((c) => isFastenerEnd(c.type))) continue;
    const n = seated.get(type)?.size ?? 0;
    if (n !== part.quantity) errors.push(error('counts', `parts.${type}.quantity`, `steps fasten ${n} ${type}, the quantity is ${part.quantity}`));
  }
  return errors;
}

/** Box-local axis-aligned extents of a part posed by quarter turns. */
function aabb(size, { position, rotation }) {
  const half = size.map((d) => d / 2);
  const extents = [0, 1, 2].map((axis) =>
    [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)))[axis]), 0),
  );
  return { min: position.map((v, i) => v - extents[i]), max: position.map((v, i) => v + extents[i]) };
}

/**
 * Packing places every instance, spares included, once each, inside the box, with no two
 * passing through each other and each resting on the floor or on something beneath it.
 */
function packing({ pack, manifest, typeOf }) {
  const errors = [];
  const { boxInner: [width, height, length], floor, placements } = pack.packing;
  const count = new Map();
  for (const { id } of placements) count.set(id, (count.get(id) ?? 0) + 1);
  for (const { id } of manifest) {
    if (count.get(id) !== 1) errors.push(error('packing', 'packing.placements', `${id} is packed ${count.get(id) ?? 0}×, not once`));
  }
  // Paths index `placements` itself, so an unknown id (reported by `references`) never
  // shifts the ones after it.
  const boxes = placements
    .map((p, i) => ({ p, path: `packing.placements[${i}]` }))
    .filter(({ p }) => typeOf.has(p.id))
    .map(({ p, path }) => ({ id: p.id, path, ...aabb(pack.parts[typeOf.get(p.id)].box, p) }));
  for (const b of boxes) {
    const outside =
      b.min[0] < -width / 2 - EPS || b.max[0] > width / 2 + EPS || b.min[2] < -length / 2 - EPS || b.max[2] > length / 2 + EPS || b.min[1] < floor - EPS || b.max[1] > floor + height + EPS;
    if (outside) errors.push(error('packing', b.path, `${b.id} does not fit inside the box`));
  }
  const overlap = (a, b, axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) {
      if ([0, 1, 2].every((axis) => overlap(boxes[i], boxes[k], axis) > EPS)) errors.push(error('packing', boxes[k].path, `${boxes[k].id} passes through ${boxes[i].id}`));
    }
  }
  for (const b of boxes) {
    const onFloor = Math.abs(b.min[1] - floor) <= EPS;
    const onPart = boxes.some((q) => q !== b && Math.abs(q.max[1] - b.min[1]) <= EPS && overlap(q, b, 0) > EPS && overlap(q, b, 2) > EPS);
    if (!onFloor && !onPart) errors.push(error('packing', b.path, `${b.id} rests on nothing`));
  }
  return errors;
}

/** Every referenced asset exists beside the pack. */
function assets({ pack }, assetExists) {
  const refs = [
    ...Object.entries(pack.parts).flatMap(([type, part]) => (part.mesh ? [[`parts.${type}.mesh`, part.mesh]] : [])),
    ...pack.manual.pages.flatMap((page, i) => (page.art ? [[`manual.pages[${i}].art`, page.art]] : [])),
    ...(pack.packing.boxArt ? [['packing.boxArt', pack.packing.boxArt]] : []),
  ];
  return refs.flatMap(([path, asset]) => (assetExists(asset) ? [] : [error('assets', path, `${asset} is missing`)]));
}

/** The rules, in report order. */
export const RULES = Object.freeze([
  'unique-ids',
  'references',
  'vocabulary',
  'connector-bounds',
  'assembled-manifest',
  'fastener-seats',
  'mate-coincidence',
  'hole-once',
  'cam-capture',
  'fitting-through',
  'step-coverage',
  'step-order',
  'counts',
  'packing',
  'assets',
]);

/**
 * Every semantic error in a schema-valid pack. `assetExists(path)` answers for paths
 * relative to the pack's folder; by default nothing is looked up.
 */
export function checkPack(pack, { assetExists = () => true } = {}) {
  const ctx = context(pack);
  return [
    ...uniqueIds(ctx),
    ...references(ctx),
    ...vocabulary(ctx),
    ...connectorBounds(ctx),
    ...assembledManifest(ctx),
    ...fastenerSeats(ctx),
    ...mateCoincidence(ctx),
    ...holeOnce(ctx),
    ...camAndFitting(ctx),
    ...stepCoverage(ctx),
    ...stepOrder(ctx),
    ...counts(ctx),
    ...packing(ctx),
    ...assets(ctx, assetExists),
  ];
}
