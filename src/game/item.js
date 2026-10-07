// JOHNNY, as the game sees it: items/johnny/flatpack.json loaded once at boot through the
// one pack implementation (tools/validate/lib) the validator also runs. Bundled at build
// time, so boot stays synchronous — no fetch. The only module that names the item.

import { loadPack } from '../../tools/validate/lib/pack.js';
import johnny from '../../items/johnny/flatpack.json';

const pack = loadPack(johnny);

/** The box's inside and walls, and the lid that closes it, as the pack packs them. */
export const PACKING = pack.packing;

const { boxInner, wall, lid } = PACKING;

/**
 * Part types by name, engine-shaped (`{ size, partNumber, mass, color, connectors }`,
 * connectors in index order, each keeping its pack `id`) — plus the flatpack's lid: not
 * furniture and never in the manifest, but a part like any other, grabbed, lifted and
 * dropped (src/scene/flatpack.js), sized to close over the box's walls.
 */
export const PART_TYPES = Object.freeze({
  ...pack.partTypes,
  boxLid: {
    size: [boxInner[0] + 2 * wall, lid.thickness, boxInner[2] + 2 * wall],
    partNumber: lid.partNumber,
    mass: lid.mass,
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
