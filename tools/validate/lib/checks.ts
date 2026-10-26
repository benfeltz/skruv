// The Flatpack contract's semantic layer: what JSON Schema cannot say. Each rule is one
// small function over a schema-valid pack, returning `{ rule, path, message }` errors —
// none when the pack holds. Pure: assets are looked up through the caller's
// `assetExists(path)`, so the same checks run in Node and in the browser.
//
// These are 0.0.1's integrity tests, promoted to the contract; the mutated fixtures in
// test/validateChecks.test.ts (one per rule) are the conformance seeds for other engines.

import { connectorInWorld, contains, rotateVector } from './geometry.js';
import type { Pose, Size, Vec3 } from './geometry.js';
import { deriveJoints, isHardwareType, seatedPoint, slideTravel } from './joints.js';
import type { Joint } from './joints.js';
import { expandManifest, shapeParts } from './pack.js';
import type { ConnectorName, ConnectorRef, FlatpackFile, InstanceId, PageFields, PartType, StepPage } from './pack.js';
import { COMPATIBLE, CONNECTOR, CONTRACT, isFastenerEnd, KIND, kindOf, passesThrough } from './vocabulary.js';

/** One semantic error: which rule, where in the pack (a JSON path), and what is wrong. */
export interface CheckError {
  rule: Rule;
  path: string;
  message: string;
}

// Bounds and packing are exact by construction; this only absorbs float noise.
const EPS = 1e-9;
const UNIT_LENGTH_TOLERANCE = 1e-9;

const error = (rule: Rule, path: string, message: string): CheckError => ({ rule, path, message });
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a: number[], b: number[]) => Math.hypot(...sub(a, b));

/**
 * What every rule reads, built tolerantly: a reference that does not resolve is reported
 * by `references`, never thrown. `joints` is null when the pack is too broken to pose.
 */
function context(pack: FlatpackFile) {
  const manifest = expandManifest(pack.parts);
  const typeOf = new Map(manifest.map((p) => [p.id, p.type]));
  let partTypes: Record<string, PartType> | null = null;
  try {
    partTypes = shapeParts(pack.parts);
  } catch {
    // Duplicate connector ids: `unique-ids` reports them.
  }
  const indexOf = (type: string, connectorId: string) => pack.parts[type]?.connectors.findIndex((c) => c.id === connectorId) ?? -1;
  const resolve = (ref: ConnectorName): ConnectorRef | null => {
    const [part, connectorId] = ref.split('/');
    const type = typeOf.get(part);
    const connector = type === undefined ? -1 : indexOf(type, connectorId);
    return connector < 0 ? null : { part, connector };
  };
  const assembled = pack.assembled.filter((a) => typeOf.has(a.id)).map((a) => ({ ...a, type: typeOf.get(a.id)! }));
  const isTool = (type: string) => {
    const ends = pack.parts[type].connectors.filter((c) => isFastenerEnd(c.type));
    return ends.length > 0 && ends.every((c) => kindOf(c.type) === KIND.TOOL);
  };
  const spares = new Set(manifest.filter((p) => p.spare).map((p) => p.id));
  const joints = partTypes ? deriveJoints({ partTypes, assembled }) : null;
  const pages = pack.manual.pages.map((page: PageFields, index) => ({ page, path: `manual.pages[${index}]` }));
  const steps = pages.filter((p): p is { page: StepPage; path: string } => p.page.kind === 'step');
  return { pack, manifest, typeOf, partTypes, resolve, assembled, isTool, spares, joints, pages, steps };
}

type Context = ReturnType<typeof context>;

const pairKey = (a: ConnectorRef, b: ConnectorRef) => `${a.part}#${a.connector}|${b.part}#${b.connector}`;
const jointKey = (j: Joint) => pairKey({ part: j.hardware, connector: j.hardwareConnector }, { part: j.host, connector: j.hostConnector });

/** Connector ids are unique on each part type. */
function uniqueIds({ pack }: Context) {
  return Object.entries(pack.parts).flatMap(([type, part]) => {
    const seen = new Set<string>();
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
function references({ pack, typeOf, resolve, pages }: Context) {
  const errors: CheckError[] = [];
  const instance = (id: InstanceId, path: string) => {
    if (!typeOf.has(id)) errors.push(error('references', path, `no instance ${id} in the box`));
  };
  pack.assembled.forEach((a, i) => instance(a.id, `assembled[${i}].id`));
  pack.packing.placements.forEach((p, i) => instance(p.id, `packing.placements[${i}].id`));
  for (const { page, path } of pages) {
    (page.parts ?? []).forEach((id, i) => instance(id, `${path}.parts[${i}]`));
    for (const field of ['fasten', 'turn'] as const) {
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
function vocabulary({ pack }: Context) {
  const connectors = new Set(pack.vocabulary.connectors);
  const kinds = new Set(pack.vocabulary.fasteners);
  return Object.entries(pack.parts).flatMap(([type, part]) =>
    part.connectors.flatMap((c, i) => {
      const path = `parts.${type}.connectors[${i}].type`;
      if (!connectors.has(c.type)) return [error('vocabulary', path, `${c.type} is not in vocabulary.connectors`)];
      if (isFastenerEnd(c.type) && !kinds.has(kindOf(c.type)!)) return [error('vocabulary', path, `${kindOf(c.type)} is not in vocabulary.fasteners`)];
      return [];
    }),
  );
}

/** Connectors sit within their part's box, axes unit length. */
function connectorBounds({ pack }: Context) {
  return Object.entries(pack.parts).flatMap(([type, part]) =>
    part.connectors.flatMap((c, i) => {
      const path = `parts.${type}.connectors[${i}]`;
      const errors: CheckError[] = [];
      if (c.position.some((v, k) => Math.abs(v) > part.box[k] / 2 + EPS)) errors.push(error('connector-bounds', `${path}.position`, `${type}/${c.id} lies outside its part`));
      if (Math.abs(Math.hypot(...c.axis) - 1) > UNIT_LENGTH_TOLERANCE) errors.push(error('connector-bounds', `${path}.axis`, `${type}/${c.id} axis is not unit length`));
      return errors;
    }),
  );
}

/** Every instance but the spares and tools is assembled, exactly once; nothing else is. */
function assembledManifest({ pack, manifest, isTool, spares }: Context) {
  const count = new Map<InstanceId, number>();
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
function fastenerSeats({ partTypes, assembled, joints }: Context) {
  if (!joints) return [];
  const seated = new Set(joints.map((j) => `${j.hardware}#${j.hardwareConnector}`));
  // `joints` is only ever set when `partTypes` is.
  return assembled.flatMap((inst) =>
    partTypes![inst.type].connectors.flatMap((c, i) =>
      isFastenerEnd(c.type) && !seated.has(`${inst.id}#${i}`)
        ? [error('fastener-seats', `assembled[${inst.id}]`, `${inst.id}/${c.id} seats in no ${COMPATIBLE[c.type]}`)]
        : [],
    ),
  );
}

/** Mated pairs sit exactly home: the end its sink depth down the hole, axes opposed. */
function mateCoincidence({ partTypes, assembled, joints }: Context) {
  if (!joints) return [];
  const byId = new Map(assembled.map((a) => [a.id, a]));
  const world = (id: InstanceId, index: number) => {
    const inst = byId.get(id)!;
    // `joints` is only ever set when `partTypes` is.
    const c = partTypes![inst.type].connectors[index];
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
function holeOnce({ joints }: Context) {
  if (!joints) return [];
  const seen = new Set<string>();
  return joints.flatMap((j) => {
    const key = `${j.host}#${j.hostConnector}`;
    if (!seen.has(key)) {
      seen.add(key);
      return [];
    }
    return [error('hole-once', `assembled[${j.hardware}]`, `${j.host} connector ${j.hostConnector} takes a second fastener (${j.hardware})`)];
  });
}

/** Every cam catches its own bolt head; every back fitting and screw passes into a panel. */
function camAndFitting({ joints }: Context) {
  if (!joints) return [];
  const caught = new Set<InstanceId>();
  return joints.flatMap((j) => {
    if (j.kind === KIND.CAM) {
      if (!j.captured) return [error('cam-capture', `assembled[${j.hardware}]`, `${j.hardware} has no bolt head within ${CONTRACT.captureRadius} m`)];
      if (caught.has(j.captured)) return [error('cam-capture', `assembled[${j.hardware}]`, `${j.hardware} catches ${j.captured}, already caught`)];
      caught.add(j.captured);
    }
    if (passesThrough(j.kind) && !j.through) return [error('fitting-through', `assembled[${j.hardware}]`, `${j.hardware} passes into no panel`)];
    return [];
  });
}

/**
 * Every screw's tip lands in a pilot hole of the part behind its hole, and every pilot hole
 * of an assembled part is filled by a tip: down the hole's axis, within `pilotRadius` of it
 * and no deeper than `pilotDepth`. A screw whose tip misses its pilot is the error a
 * mis-sized or mis-placed hole makes; a pilot no tip reaches is one left over.
 */
function pilotHoles({ partTypes, assembled, joints }: Context) {
  if (!joints) return [];
  const byId = new Map(assembled.map((a) => [a.id, a]));
  // `joints` is only ever set when `partTypes` is.
  const connectorsOf = (inst: { type: string }) => partTypes![inst.type].connectors;
  const pilots = assembled.flatMap((inst) =>
    connectorsOf(inst).flatMap((c, index) => (c.type === CONNECTOR.SCREW_PILOT ? [{ id: inst.id, name: c.id, key: `${inst.id}#${index}`, ...connectorInWorld(c, inst) }] : [])),
  );
  const lands = (tip: Vec3, pilot: (typeof pilots)[number]) => {
    const d = sub(tip, pilot.position);
    const depth = -d.reduce((sum, v, i) => sum + v * pilot.axis[i], 0);
    const off = Math.hypot(...d.map((v, i) => v + pilot.axis[i] * depth));
    return depth > 0 && depth <= CONTRACT.pilotDepth && off <= CONTRACT.pilotRadius;
  };
  const filled = new Set<string>();
  const errors: CheckError[] = [];
  for (const j of joints) {
    // A screw that passes into nothing is `fitting-through`'s.
    if (j.kind !== KIND.SCREW || !j.through) continue;
    const screw = byId.get(j.hardware)!;
    const tip = connectorInWorld(connectorsOf(screw)[j.hardwareConnector], screw).position;
    const pilot = pilots.find((p) => p.id === j.through && lands(tip, p));
    if (pilot) filled.add(pilot.key);
    else errors.push(error('pilot-hole', `assembled[${j.hardware}]`, `${j.hardware} tip lands in no screwPilot of ${j.through}`));
  }
  for (const p of pilots) {
    if (!filled.has(p.key)) errors.push(error('pilot-hole', `assembled[${p.id}]`, `${p.id}/${p.name} takes no screw tip`));
  }
  return errors;
}

// What `slides` reads: the instances by id, and the slide joints among the derived ones.
const slideFacts = ({ assembled, joints }: Context) => ({
  byId: new Map(assembled.map((a) => [a.id, a])),
  slides: (joints ?? []).filter((j) => j.kind === KIND.SLIDE),
});
type SlideFacts = ReturnType<typeof slideFacts>;
const dotOf = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** An open pose belongs to a part some rail runs in. */
function openOnlyOnSlideHosts({ assembled }: Context, { slides }: SlideFacts) {
  const hosts = new Set(slides.map((j) => j.host));
  return assembled.filter((a) => a.open && !hosts.has(a.id)).map((a) => error('slides', `assembled[${a.id}].open`, `${a.id} has an open pose but no rail runs in it`));
}

/** Every part a rail runs in has an open pose. */
function everySlideHostOpens(_: Context, { byId, slides }: SlideFacts) {
  return slides.filter((j) => !byId.get(j.host)!.open).map((j) => error('slides', `assembled[${j.host}]`, `${j.host} runs on ${j.hardware} but has no open pose`));
}

/** A slide is a pure translation: the open rotation is the closed one. */
function pureTranslation({ assembled }: Context) {
  return assembled
    .filter((a) => a.open && a.open.rotation.some((v, i) => Math.abs(v - a.rotation[i]) > CONTRACT.mateTolerance))
    .map((a) => error('slides', `assembled[${a.id}].open.rotation`, `${a.id} opens with a turn; a slide only translates`));
}

/** The travel is not nothing, and lies across the groove's axis. */
function travelAcrossTheMate({ partTypes }: Context, { byId, slides }: SlideFacts) {
  return slides.flatMap((j) => {
    const host = byId.get(j.host)!;
    const travel = slideTravel(host);
    if (!travel) return [];
    const length = Math.hypot(...travel);
    if (length <= CONTRACT.mateTolerance) return [error('slides', `assembled[${j.host}].open`, `${j.host} opens to where it is closed`)];
    const axis = connectorInWorld(partTypes![host.type].connectors[j.hostConnector], host).axis;
    if (Math.abs(dotOf(travel, axis)) / length > CONTRACT.mateTolerance) return [error('slides', `assembled[${j.host}].open`, `${j.host} opens along its groove, not across it`)];
    return [];
  });
}

/** At open, each groove's point still lies inside its runner's box. */
function staysOnTheRunner({ partTypes }: Context, { byId, slides }: SlideFacts) {
  return slides.flatMap((j) => {
    const host = byId.get(j.host)!;
    const travel = slideTravel(host);
    if (!travel) return [];
    const runner = byId.get(j.hardware)!;
    const groove = connectorInWorld(partTypes![host.type].connectors[j.hostConnector], host).position;
    const atOpen = groove.map((v, i) => v + travel[i]) as Vec3;
    if (contains(partTypes![runner.type].size, runner, atOpen, CONTRACT.mateTolerance)) return [];
    return [error('slides', `assembled[${j.host}].open`, `${j.host} leaves ${j.hardware} when open`)];
  });
}

/** Parts linked by anything but a slide move together, so their open travels agree. */
function oneTravelPerUnit({ assembled, joints }: Context, { slides }: SlideFacts) {
  const root = new Map(assembled.map((a) => [a.id, a.id]));
  const find = (id: InstanceId): InstanceId => (root.get(id) === id ? id : find(root.get(id)!));
  for (const j of (joints ?? []).filter((k) => !slides.includes(k))) {
    for (const other of [j.host, j.through, j.captured]) if (other) root.set(find(other), find(j.hardware));
  }
  const first = new Map<InstanceId, { id: InstanceId; travel: Vec3 }>();
  return assembled.flatMap((a) => {
    const travel = slideTravel(a);
    if (!travel) return [];
    const unit = find(a.id);
    const anchor = first.get(unit);
    if (!anchor) {
      first.set(unit, { id: a.id, travel });
      return [];
    }
    if (distance(travel, anchor.travel) <= CONTRACT.mateTolerance) return [];
    return [error('slides', `assembled[${a.id}].open`, `${a.id} opens differently from ${anchor.id}, which it is joined to`)];
  });
}

/**
 * A part that slides (a drawer side on its runners) is posed twice: `open` is allowed only on
 * the host of a slide joint and every such host has one; the open pose is a pure translation,
 * non-zero and across the mate axis; at open each groove still lies inside its runner's box;
 * and parts joined by anything but a slide share one travel.
 */
function slides(ctx: Context) {
  if (!ctx.joints) return [];
  const facts = slideFacts(ctx);
  return [
    ...openOnlyOnSlideHosts(ctx, facts),
    ...everySlideHostOpens(ctx, facts),
    ...pureTranslation(ctx),
    ...travelAcrossTheMate(ctx, facts),
    ...staysOnTheRunner(ctx, facts),
    ...oneTravelPerUnit(ctx, facts),
  ];
}

/** Step pages fasten every derived joint exactly once, and turn every cam exactly once. */
function stepCoverage({ joints, resolve, steps }: Context) {
  if (!joints) return [];
  const errors: CheckError[] = [];
  const derived = new Map(joints.map((j) => [jointKey(j), j]));
  const fastened = new Map<string, number>();
  const turned = new Map<string, number>();
  for (const { page, path } of steps) {
    for (const [field, tally] of [['fasten', fastened], ['turn', turned]] as const) {
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
function stepOrder({ partTypes, assembled, resolve, pages, steps }: Context) {
  const errors: CheckError[] = [];
  const numbered = pages.filter(({ page }) => page.number !== undefined);
  numbered.forEach(({ page, path }, i) => {
    if (page.number !== i + 1) errors.push(error('step-order', `${path}.number`, `page number ${page.number} should be ${i + 1}`));
  });
  if (!partTypes) return errors;
  const introduced = new Map<InstanceId, number>();
  for (const { page, path } of steps) {
    for (const id of page.parts ?? []) {
      if (introduced.has(id)) errors.push(error('step-order', `${path}.parts`, `${id} is brought in twice`));
      else introduced.set(id, page.number);
    }
  }
  for (const inst of assembled) {
    if (!isHardwareType(partTypes[inst.type]) && !introduced.has(inst.id)) errors.push(error('step-order', 'manual.pages', `${inst.id} is never brought in`));
  }
  const seatedOn = new Map<InstanceId, number>();
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
      if (a && (seated === undefined || seated! > page.number)) errors.push(error('step-order', `${path}.turn[${i}]`, `${a.part} turns on page ${page.number} before it is seated`));
    });
  }
  return errors;
}

/**
 * Each sub-assembly's members, derived from the pages that build it: the parts those pages
 * bring in and the hardware they fasten. Never listed in the pack.
 */
function membersOf(steps: Context['steps'], resolve: Context['resolve']) {
  const members = new Map<string, Set<InstanceId>>();
  for (const { page } of steps) {
    if (page.assembly === undefined) continue;
    const set = members.get(page.assembly) ?? new Set<InstanceId>();
    for (const id of page.parts ?? []) set.add(id);
    for (const [end] of page.fasten ?? []) {
      const a = resolve(end);
      if (a) set.add(a.part);
    }
    members.set(page.assembly, set);
  }
  return members;
}

/** A tagged page fastens only its own assembly's parts. */
function taggedFasten({ resolve, steps }: Context, members: Map<string, Set<InstanceId>>) {
  const errors: CheckError[] = [];
  for (const { page, path } of steps) {
    const own = page.assembly === undefined ? undefined : members.get(page.assembly);
    (page.fasten ?? []).forEach(([end, hole], i) => {
      for (const ref of [resolve(end), resolve(hole)]) {
        if (ref && own && !own.has(ref.part)) errors.push(error('assemblies', `${path}.fasten[${i}]`, `${ref.part} is not part of ${page.assembly}`));
      }
    });
  }
  return errors;
}

/** Each built assembly is installed once, after its last page; each install names a built one. */
function installs({ steps }: Context, members: Map<string, Set<InstanceId>>) {
  const errors: CheckError[] = [];
  for (const name of members.keys()) {
    const installed = steps.filter(({ page }) => page.install === name);
    if (installed.length !== 1) {
      errors.push(error('assemblies', 'manual.pages', `${name} is installed ${installed.length} times, not 1`));
      continue;
    }
    const last = Math.max(...steps.filter(({ page }) => page.assembly === name).map(({ page }) => page.number));
    const { page, path } = installed[0];
    if (page.number <= last) errors.push(error('assemblies', `${path}.install`, `${name} is installed on page ${page.number} before its last page ${last}`));
  }
  for (const { page, path } of steps) {
    if (page.install !== undefined && !members.has(page.install)) errors.push(error('assemblies', `${path}.install`, `no page builds ${page.install}`));
  }
  return errors;
}

/** No untagged page numbered before the install fastens into an assembly. */
function earlyFasten({ resolve, steps }: Context, members: Map<string, Set<InstanceId>>) {
  const errors: CheckError[] = [];
  for (const [name, own] of members) {
    const at = steps.find(({ page }) => page.install === name)?.page.number;
    if (at === undefined) continue;
    for (const { page, path } of steps) {
      if (page.assembly !== undefined || page.number >= at) continue;
      (page.fasten ?? []).forEach(([end, hole], i) => {
        for (const ref of [resolve(end), resolve(hole)]) {
          if (ref && own.has(ref.part)) errors.push(error('assemblies', `${path}.fasten[${i}]`, `${ref.part} belongs to ${name}, installed on page ${at}`));
        }
      });
    }
  }
  return errors;
}

/** The four sub-assembly checks of the format's section 5. */
function assemblies(ctx: Context) {
  const members = membersOf(ctx.steps, ctx.resolve);
  return [...taggedFasten(ctx, members), ...installs(ctx, members), ...earlyFasten(ctx, members)];
}

/** Steps seat each built-in hardware type's quantity, spares never. */
function counts({ pack, typeOf, spares, resolve, steps, isTool }: Context) {
  const errors: CheckError[] = [];
  const seated = new Map<string, Set<InstanceId>>();
  for (const { page, path } of steps) {
    (page.fasten ?? []).forEach(([end], i) => {
      const a = resolve(end);
      if (!a) return;
      if (spares.has(a.part)) errors.push(error('counts', `${path}.fasten[${i}]`, `${a.part} is a spare and is never fastened in a step`));
      const type = typeOf.get(a.part)!;
      if (!seated.has(type)) seated.set(type, new Set());
      seated.get(type)!.add(a.part);
    });
  }
  for (const [type, part] of Object.entries(pack.parts)) {
    if (isTool(type) || !part.connectors.some((c) => isFastenerEnd(c.type))) continue;
    const n = seated.get(type)?.size ?? 0;
    if (n !== part.quantity) errors.push(error('counts', `parts.${type}.quantity`, `steps fasten ${n} ${type}, the quantity is ${part.quantity}`));
  }
  return errors;
}

interface Extents {
  min: number[];
  max: number[];
}

/** Box-local axis-aligned extents of a part posed by quarter turns. */
function aabb(size: Size, { position, rotation }: Pose): Extents {
  const half = size.map((d) => d / 2);
  const extents = [0, 1, 2].map((axis) =>
    [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(rotation, [0, 1, 2].map((k) => (k === i ? half[i] : 0)) as Vec3)[axis]), 0),
  );
  return { min: position.map((v, i) => v - extents[i]), max: position.map((v, i) => v + extents[i]) };
}

/**
 * Packing places every instance, spares included, once each, inside the box, with no two
 * passing through each other and each resting on the floor or on something beneath it.
 */
function packing({ pack, manifest, typeOf }: Context) {
  const errors: CheckError[] = [];
  const { boxInner: [width, height, length], floor, placements } = pack.packing;
  const count = new Map<InstanceId, number>();
  for (const { id } of placements) count.set(id, (count.get(id) ?? 0) + 1);
  for (const { id } of manifest) {
    if (count.get(id) !== 1) errors.push(error('packing', 'packing.placements', `${id} is packed ${count.get(id) ?? 0}×, not once`));
  }
  // Paths index `placements` itself, so an unknown id (reported by `references`) never
  // shifts the ones after it.
  const boxes = placements
    .map((p, i) => ({ p, path: `packing.placements[${i}]` }))
    .filter(({ p }) => typeOf.has(p.id))
    .map(({ p, path }) => ({ id: p.id, path, ...aabb(pack.parts[typeOf.get(p.id)!].box, p) }));
  for (const b of boxes) {
    const outside =
      b.min[0] < -width / 2 - EPS || b.max[0] > width / 2 + EPS || b.min[2] < -length / 2 - EPS || b.max[2] > length / 2 + EPS || b.min[1] < floor - EPS || b.max[1] > floor + height + EPS;
    if (outside) errors.push(error('packing', b.path, `${b.id} does not fit inside the box`));
  }
  const overlap = (a: Extents, b: Extents, axis: number) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
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
function assets({ pack }: Context, assetExists: (path: string) => boolean) {
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
  'pilot-hole',
  'slides',
  'step-coverage',
  'step-order',
  'assemblies',
  'counts',
  'packing',
  'assets',
] as const);

/** A rule's name, as errors report it. */
export type Rule = (typeof RULES)[number];

/**
 * Every semantic error in a schema-valid pack. `assetExists(path)` answers for paths
 * relative to the pack's folder; by default nothing is looked up.
 */
export function checkPack(pack: FlatpackFile, { assetExists = () => true }: { assetExists?: (path: string) => boolean } = {}): CheckError[] {
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
    ...pilotHoles(ctx),
    ...slides(ctx),
    ...stepCoverage(ctx),
    ...stepOrder(ctx),
    ...assemblies(ctx),
    ...counts(ctx),
    ...packing(ctx),
    ...assets(ctx, assetExists),
  ];
}
