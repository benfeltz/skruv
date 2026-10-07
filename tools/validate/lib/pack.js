// A Flatpack file (format 1) turned into the shapes an engine works with. Pure and
// dependency-free: the game imports it in the browser, the validator CLI in Node.
//
// Connectors are named in the file (`dowelHole-3`) and referenced as
// `<instance>/<connector>`; engines key them by their index in the part's list, so the
// file's order IS the index order. The loader trusts schema-valid input but fails loudly on
// a name that is duplicated or does not resolve — the validator reports those properly.

/**
 * The part types, engine-shaped: `{ type: { size, partNumber, mass, color, connectors } }`,
 * connectors in file order, each keeping its `id`. Throws on a duplicate connector id.
 */
export function shapeParts(parts) {
  return Object.fromEntries(
    Object.entries(parts).map(([type, part]) => {
      const seen = new Set();
      for (const { id } of part.connectors) {
        if (seen.has(id)) throw new Error(`${type}: duplicate connector id ${id}`);
        seen.add(id);
      }
      const shaped = {
        size: part.box,
        partNumber: part.partNumber,
        mass: part.mass,
        color: part.color,
        connectors: part.connectors.map(({ id, type: connectorType, position, axis }) => ({ id, type: connectorType, position, axis })),
      };
      if (part.mesh) shaped.mesh = part.mesh;
      return [type, shaped];
    }),
  );
}

/**
 * One `{ id, type }` per instance in the box, ids `<type>-<n>`, in the file's part order:
 * `quantity` first, then the spares numbered after them.
 */
export function expandManifest(parts) {
  return Object.entries(parts).flatMap(([type, { quantity, spares = 0 }]) =>
    Array.from({ length: quantity + spares }, (_, i) => ({ id: `${type}-${i + 1}`, type, spare: i >= quantity })),
  );
}

/**
 * `resolve("dowel-1/dowelEnd-2") → { part: 'dowel-1', connector: 1 }` against the manifest
 * and part types; throws on a malformed, unknown or dangling reference.
 */
export function createResolver(partTypes, manifest) {
  const typeOf = new Map(manifest.map(({ id, type }) => [id, type]));
  const indexOf = new Map(
    Object.entries(partTypes).map(([type, { connectors }]) => [type, new Map(connectors.map((c, i) => [c.id, i]))]),
  );
  return function resolve(ref) {
    const slash = ref.indexOf('/');
    if (slash < 0) throw new Error(`malformed connector reference ${ref}`);
    const part = ref.slice(0, slash);
    const type = typeOf.get(part);
    if (!type) throw new Error(`${ref}: no instance ${part}`);
    const connector = indexOf.get(type).get(ref.slice(slash + 1));
    if (connector === undefined) throw new Error(`${ref}: ${type} has no connector ${ref.slice(slash + 1)}`);
    return { part, connector };
  };
}

/** The `<instance>/<connector>` name of connector `index` on instance `part`. */
export function refOf(partTypes, typeOf, part, index) {
  return `${part}/${partTypes[typeOf(part)].connectors[index].id}`;
}

/**
 * The whole pack, engine-shaped:
 *   partTypes — `shapeParts`
 *   manifest  — `[{ id, type }]`, spares numbered last within their type
 *   spares    — ids of the spare instances
 *   assembled — `[{ id, type, role, position, rotation }]`
 *   identity, manual, packing, tuning — as in the file
 *   resolve   — `createResolver`
 */
export function loadPack(json) {
  if (json.format !== 1) throw new Error(`unsupported Flatpack format ${json.format}`);
  const partTypes = shapeParts(json.parts);
  const expanded = expandManifest(json.parts);
  const typeOf = new Map(expanded.map(({ id, type }) => [id, type]));
  const assembled = json.assembled.map(({ id, role, position, rotation }) => {
    if (!typeOf.has(id)) throw new Error(`assembled: no instance ${id}`);
    return { id, type: typeOf.get(id), role, position, rotation };
  });
  const manifest = expanded.map(({ id, type }) => ({ id, type }));
  return {
    identity: json.identity,
    partTypes,
    manifest,
    spares: new Set(expanded.filter((p) => p.spare).map((p) => p.id)),
    assembled,
    manual: json.manual,
    packing: json.packing,
    tuning: json.tuning ?? {},
    resolve: createResolver(partTypes, manifest),
  };
}
