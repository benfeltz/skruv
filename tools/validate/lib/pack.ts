// A Flatpack file (format 1) turned into the shapes an engine works with. Pure and
// dependency-free: the game imports it in the browser, the validator CLI in Node.
//
// Connectors are named in the file (`dowelHole-3`) and referenced as
// `<instance>/<connector>`; engines key them by their index in the part's list, so the
// file's order IS the index order. The loader trusts schema-valid input but fails loudly on
// a name that is duplicated or does not resolve — the validator reports those properly.

import type { Pose, Size, Vec3 } from './geometry.js';
import type { ConnectorType, FastenerKind } from './vocabulary.js';

// The file, as flatpack.schema.json describes it — the schema's TypeScript mirror. A
// schema-valid pack is a `FlatpackFile`; the schema stays the source of truth for the
// patterns (ids, part numbers, asset paths) a type cannot say.

/** An instance id, `<type>-<n>` — `dowel-3`. */
export type InstanceId = string;
/** `<instance>/<connector>` — `dowel-1/dowelEnd-2`. */
export type ConnectorName = string;
/** A fastener end and the hole it seats in. */
export type Pair = [ConnectorName, ConnectorName];
/** An asset path beside the pack — `assets/side.glb`. */
export type AssetPath = string;

export interface Identity {
  product: string;
  maker: string;
  documentCode: string;
  description?: string;
}

export interface Vocabulary {
  connectors: ConnectorType[];
  fasteners: FastenerKind[];
}

/** A connector as the file names it, part-local. */
export interface ConnectorSpec {
  id: string;
  type: ConnectorType;
  position: Vec3;
  axis: Vec3;
}

/** A part type as the file writes it. */
export interface PartSpec {
  partNumber: string;
  box: Size;
  mesh?: AssetPath;
  mass: number;
  color: string;
  quantity: number;
  spares?: number;
  connectors: ConnectorSpec[];
}

/** One instance placed somewhere — an assembled pose or a packing placement. */
export interface InstancePose extends Pose {
  id: InstanceId;
}

/** One instance in the finished item. */
export interface AssembledSpec extends InstancePose {
  role: string;
}

/** How a booklet page draws the item. */
export type DrawingPose = 'parts' | 'lying' | 'faceDown' | 'upright';

interface PageBase {
  art?: AssetPath;
}
export interface PlainPage extends PageBase {
  kind: 'cover' | 'inventory' | 'back';
}
export interface SubjectPage extends PageBase {
  kind: 'warning' | 'doDont';
  subject: string;
}
export interface StepPage extends PageBase {
  kind: 'step';
  number: number;
  pose: DrawingPose;
  parts?: InstanceId[];
  fasten?: Pair[];
  turn?: Pair[];
  tool?: string;
}
export interface SpecialPage extends PageBase {
  kind: 'special';
  number: number;
  pose: DrawingPose;
  special: 'tipUpright';
}
/** A booklet page, by `kind`. */
export type Page = PlainPage | SubjectPage | StepPage | SpecialPage;

/** Any page, every kind's own fields optional — how code that walks all pages reads one. */
export type PageFields = Page & Partial<Omit<StepPage, 'kind'> & Omit<SpecialPage, 'kind'> & Omit<SubjectPage, 'kind'>>;

export interface Manual {
  pages: Page[];
}

export interface Lid {
  thickness: number;
  partNumber: string;
  mass: number;
  color: string;
}

export interface Packing {
  boxInner: Size;
  wall: number;
  floor: number;
  lid: Lid;
  boxArt?: AssetPath;
  placements: InstancePose[];
}

/** Tunables the pack overrides, `<group>.<key>` → value. */
export type Tuning = Record<string, number>;

/** A whole Flatpack file, format 1. */
export interface FlatpackFile {
  $schema?: string;
  format: 1;
  identity: Identity;
  vocabulary: Vocabulary;
  parts: Record<string, PartSpec>;
  assembled: AssembledSpec[];
  manual: Manual;
  packing: Packing;
  tuning?: Tuning;
}

// The engine's shapes, as `loadPack` builds them.

/** A connector, engine-shaped: keyed by its index in the part's list, keeping its `id`. */
export interface Connector {
  id: string;
  type: ConnectorType;
  position: Vec3;
  axis: Vec3;
}

/** A part type, engine-shaped. */
export interface PartType {
  size: Size;
  partNumber: string;
  mass: number;
  color: string;
  connectors: Connector[];
  mesh?: AssetPath;
}

/** One instance in the box. */
export interface ManifestEntry {
  id: InstanceId;
  type: string;
}

/** A manifest entry that knows whether it is a spare. */
export interface ExpandedEntry extends ManifestEntry {
  spare: boolean;
}

/** One instance in the finished item, with its type. */
export interface AssembledPart extends AssembledSpec {
  type: string;
}

/** A connector by instance and index — what a `ConnectorName` resolves to. */
export interface ConnectorRef {
  part: InstanceId;
  connector: number;
}

export type Resolver = (ref: ConnectorName) => ConnectorRef;

/** A loaded pack — see `loadPack`. */
export interface Pack {
  identity: Identity;
  partTypes: Record<string, PartType>;
  manifest: ManifestEntry[];
  spares: Set<InstanceId>;
  assembled: AssembledPart[];
  manual: Manual;
  packing: Packing;
  tuning: Tuning;
  resolve: Resolver;
}

/**
 * The part types, engine-shaped: `{ type: { size, partNumber, mass, color, connectors } }`,
 * connectors in file order, each keeping its `id`. Throws on a duplicate connector id.
 */
export function shapeParts(parts: Record<string, PartSpec>): Record<string, PartType> {
  return Object.fromEntries(
    Object.entries(parts).map(([type, part]) => {
      const seen = new Set<string>();
      for (const { id } of part.connectors) {
        if (seen.has(id)) throw new Error(`${type}: duplicate connector id ${id}`);
        seen.add(id);
      }
      const shaped: PartType = {
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
export function expandManifest(parts: Record<string, PartSpec>): ExpandedEntry[] {
  return Object.entries(parts).flatMap(([type, { quantity, spares = 0 }]) =>
    Array.from({ length: quantity + spares }, (_, i) => ({ id: `${type}-${i + 1}`, type, spare: i >= quantity })),
  );
}

/**
 * `resolve("dowel-1/dowelEnd-2") → { part: 'dowel-1', connector: 1 }` against the manifest
 * and part types; throws on a malformed, unknown or dangling reference.
 */
export function createResolver(partTypes: Record<string, PartType>, manifest: ManifestEntry[]): Resolver {
  const typeOf = new Map(manifest.map(({ id, type }) => [id, type]));
  const indexOf = new Map(
    Object.entries(partTypes).map(([type, { connectors }]) => [type, new Map(connectors.map((c, i) => [c.id, i]))]),
  );
  return function resolve(ref: ConnectorName): ConnectorRef {
    const slash = ref.indexOf('/');
    if (slash < 0) throw new Error(`malformed connector reference ${ref}`);
    const part = ref.slice(0, slash);
    const type = typeOf.get(part);
    if (!type) throw new Error(`${ref}: no instance ${part}`);
    const connector = indexOf.get(type)!.get(ref.slice(slash + 1));
    if (connector === undefined) throw new Error(`${ref}: ${type} has no connector ${ref.slice(slash + 1)}`);
    return { part, connector };
  };
}

/** The `<instance>/<connector>` name of connector `index` on instance `part`. */
export function refOf(partTypes: Record<string, PartType>, typeOf: (part: InstanceId) => string, part: InstanceId, index: number): ConnectorName {
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
export function loadPack(json: FlatpackFile): Pack {
  if (json.format !== 1) throw new Error(`unsupported Flatpack format ${json.format}`);
  const partTypes = shapeParts(json.parts);
  const expanded = expandManifest(json.parts);
  const typeOf = new Map(expanded.map(({ id, type }) => [id, type]));
  const assembled = json.assembled.map(({ id, role, position, rotation }) => {
    if (!typeOf.has(id)) throw new Error(`assembled: no instance ${id}`);
    return { id, type: typeOf.get(id)!, role, position, rotation };
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
