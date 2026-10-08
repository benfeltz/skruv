// JOHNNY, as the game sees it: items/johnny/flatpack.json loaded once at boot through the
// one pack implementation (tools/validate/lib) the validator also runs. Bundled at build
// time, so boot stays synchronous — no fetch. The only module that names the item.

import { deriveJoints } from '../../tools/validate/lib/joints.js';
import { loadPack } from '../../tools/validate/lib/pack.js';
import type { FlatpackFile, PartType } from '../../tools/validate/lib/pack.js';

// The pack format's types, for the rest of the game: they reach it only through here.
export type { Connector, ConnectorName, DrawingPose, InstanceId, ManifestEntry, PageFields, Resolver } from '../../tools/validate/lib/pack.js';
export type { Joint } from '../../tools/validate/lib/joints.js';
import johnny from '../../items/johnny/flatpack.json';

// A JSON import types its enums and tuples as plain strings and arrays; the file is
// schema-valid by CI's validator, so it is the format's type.
const pack = loadPack(johnny as unknown as FlatpackFile);

/** The box's inside and walls, and the lid that closes it, as the pack packs them. */
export const PACKING = pack.packing;

const { boxInner, wall, floor, lid } = PACKING;

/** A part type as the game holds it: the pack's, or the box base — which has no part number or mass of its own. */
export type GamePartType = Omit<PartType, 'partNumber' | 'mass'> & Partial<Pick<PartType, 'partNumber' | 'mass'>>;

/**
 * Part types by name, engine-shaped (`{ size, partNumber, mass, color, connectors }`,
 * connectors in index order, each keeping its pack `id`) — plus the flatpack's lid and
 * base: not furniture and never in the manifest, but parts like any other, grabbed, lifted
 * and dropped (src/scene/flatpack.ts). The lid is sized to close over the box's walls; the
 * base is the open box itself, bottom and walls, with no part number of its own and its
 * mass a tunable (BOX.mass).
 */
export const PART_TYPES: Readonly<Record<string, GamePartType>> = Object.freeze({
  ...pack.partTypes,
  boxLid: {
    size: [boxInner[0] + 2 * wall, lid.thickness, boxInner[2] + 2 * wall],
    partNumber: lid.partNumber,
    mass: lid.mass,
    color: lid.color,
    connectors: [],
  },
  boxBase: {
    size: [boxInner[0] + 2 * wall, floor + boxInner[1], boxInner[2] + 2 * wall],
    color: lid.color,
    connectors: [],
  },
});

/** One `{ id, type }` per physical part in the box, ids like `dowel-3`, spares numbered last. */
export const MANIFEST = Object.freeze(pack.manifest.map((entry) => Object.freeze(entry)));

/** Ids of the spare instances: in the box, in no step. */
export const SPARES = pack.spares;

/** The product and its maker, on the box and the booklet. */
export const IDENTITY = pack.identity;

/**
 * The complete upright JOHNNY: `{ parts, joints }`, worked out once at boot and shared by
 * the display shelf and the booklet.
 *   parts  — `{ id, type, role, position, rotation }`, one per instance built into it; frame
 *            on the floor under the carcass centre, front +z
 *   joints — derived from those poses (tools/validate/lib/joints.ts): `{ hardware,
 *            hardwareConnector, host, hostConnector, kind, mover, through, captured }`
 */
export const ASSEMBLED = Object.freeze({ parts: pack.assembled, joints: deriveJoints(pack) });

/** The booklet as the pack writes it: `{ pages }`, cover to back (src/game/bookletModel.ts). */
export const MANUAL = pack.manual;

/** `resolveConnector('dowel-1/dowelEnd-2') → { part: 'dowel-1', connector: 1 }`. */
export const resolveConnector = pack.resolve;
