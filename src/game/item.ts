// The items, as the game sees them: every pack under items/ loaded once at boot through the
// one pack implementation (tools/validate/lib) the validator also runs. Bundled at build
// time, so boot stays synchronous — no fetch. The only module that names the items.
//
// One item is current at a time. Its pieces are the exports below — `PART_TYPES`,
// `PACKING`, `ASSEMBLED`… — and `setItem(id)` points them all at another item. ES module
// bindings are live, so a reader that looks them up when it runs follows the swap; one
// that copies them into a module-level value at import time keeps the old item forever.
// Read them at call time.

import { deriveJoints } from '../../tools/validate/lib/joints.js';
import { loadPack } from '../../tools/validate/lib/pack.js';
import { isFastenerEnd, kindOf } from '../../tools/validate/lib/vocabulary.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';
import type { FlatpackFile, PartType } from '../../tools/validate/lib/pack.js';

// The pack format's types, for the rest of the game: they reach it only through here.
export type { Connector, ConnectorName, DrawingPose, InstanceId, ManifestEntry, PageFields, Resolver, Variant } from '../../tools/validate/lib/pack.js';
export type { Joint } from '../../tools/validate/lib/joints.js';
import johnny from '../../items/johnny/flatpack.json';
import blank from '../../items/blank/flatpack.json';
import overkall from '../../items/overkall/flatpack.json';

/** A part type as the game holds it: the pack's, or the box base — which has no part number or mass of its own. */
export type GamePartType = Omit<PartType, 'partNumber' | 'mass'> & Partial<Pick<PartType, 'partNumber' | 'mass'>>;

/** One item, every piece the game reads of it — what the exports below serve for the current one. */
export type Item = ReturnType<typeof itemOf>;

// A JSON import types its enums and tuples as plain strings and arrays; the file is
// schema-valid by CI's validator, so it is the format's type.
function itemOf(file: FlatpackFile) {
  const pack = loadPack(file);
  const { boxInner, wall, floor, lid } = pack.packing;
  return Object.freeze({
    /** The box's inside and walls, and the lid that closes it, as the pack packs them. */
    packing: pack.packing,
    /**
     * Part types by name, engine-shaped (`{ size, partNumber, mass, color, connectors }`,
     * connectors in index order, each keeping its pack `id`) — plus the flatpack's lid and
     * base: not furniture and never in the manifest, but parts like any other, grabbed,
     * lifted and dropped (src/scene/flatpack.ts). The lid is sized to close over the box's
     * walls; the base is the open box itself, bottom and walls, with no part number of its
     * own and its mass a tunable (BOX.mass).
     */
    partTypes: Object.freeze<Record<string, GamePartType>>({
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
    }),
    /** One `{ id, type }` per physical part in the box, ids like `dowel-3`, spares numbered last. */
    manifest: Object.freeze(pack.manifest.map((entry) => Object.freeze(entry))),
    /** Ids of the spare instances: in the box, in no step. */
    spares: pack.spares,
    /** The product and its maker, on the box and the booklet. */
    identity: pack.identity,
    /**
     * The complete upright item: `{ parts, joints }`, worked out once at boot and shared by
     * the display shelf, the booklet and the catalog.
     *   parts  — `{ id, type, role, position, rotation }`, one per instance built into it;
     *            frame on the floor under the carcass centre, front +z
     *   joints — derived from those poses (tools/validate/lib/joints.ts): `{ hardware,
     *            hardwareConnector, host, hostConnector, kind, mover, through, captured }`
     */
    assembled: Object.freeze({ parts: pack.assembled, joints: deriveJoints(pack) }),
    /**
     * Every fastener kind this item uses, tools included: read off the fastener ends of the
     * part types it ships, never written down. The game's own pages depend on it — the
     * controls page leaves out rows for gestures the item never asks for.
     */
    kinds: new Set<FastenerKind>(
      Object.values(pack.partTypes).flatMap((part) => part.connectors.filter((c) => isFastenerEnd(c.type)).map((c) => kindOf(c.type)!)),
    ) as ReadonlySet<FastenerKind>,
    /** The booklet as the pack writes it: `{ pages }`, cover to back (src/game/bookletModel.ts). */
    manual: pack.manual,
    /** `resolve('dowel-1/dowelEnd-2') → { part: 'dowel-1', connector: 1 }`. */
    resolve: pack.resolve,
  });
}

// Every item, by id — the folder name under items/ — in catalog page order. Loaded once, here.
const ITEMS: ReadonlyMap<string, Item> = new Map([
  ['johnny', itemOf(johnny as unknown as FlatpackFile)],
  ['blank', itemOf(blank as unknown as FlatpackFile)],
  ['overkall', itemOf(overkall as unknown as FlatpackFile)],
]);

/** Every item the game carries, in registry order — what the catalog lists. */
export const ITEM_IDS: readonly string[] = Object.freeze([...ITEMS.keys()]);

/** Item `id`'s pieces, without making it current — the catalog draws every item this way. */
export function itemById(id: string): Item {
  const item = ITEMS.get(id);
  if (!item) throw new Error(`no item "${id}" (have: ${ITEM_IDS.join(', ')})`);
  return item;
}

/** The current item's id. */
export let ITEM_ID: string;
/** The current item's box inside and walls, and the lid that closes it — `Item['packing']`. */
export let PACKING: Item['packing'];
/** The current item's part types by name, box lid and base included — `Item['partTypes']`. */
export let PART_TYPES: Item['partTypes'];
/** The current item's box contents, one `{ id, type }` per physical part — `Item['manifest']`. */
export let MANIFEST: Item['manifest'];
/** The current item's spare instance ids — `Item['spares']`. */
export let SPARES: Item['spares'];
/** The current item's product and maker — `Item['identity']`. */
export let IDENTITY: Item['identity'];
/** The current item, built: `{ parts, joints }` — `Item['assembled']`. */
export let ASSEMBLED: Item['assembled'];
/** The current item's booklet — `Item['manual']`. */
export let MANUAL: Item['manual'];
/** `resolveConnector('dowel-1/dowelEnd-2') → { part: 'dowel-1', connector: 1 }`, for the current item. */
export let resolveConnector: Item['resolve'];

/** Make item `id` current: every export above now serves it. An unknown id throws and changes nothing. */
export function setItem(id: string) {
  const item = itemById(id);
  ITEM_ID = id;
  ({ packing: PACKING, partTypes: PART_TYPES, manifest: MANIFEST, spares: SPARES, identity: IDENTITY, assembled: ASSEMBLED, manual: MANUAL, resolve: resolveConnector } = item);
}

// JOHNNY until something picks another.
setItem('johnny');
