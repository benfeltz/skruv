# Flatpack validator

Checks a Flatpack item (format 1) — `items/<item>/flatpack.json` — against the contract every
engine honours. Two layers:

1. **Schema** — [`flatpack.schema.json`](flatpack.schema.json), standard JSON Schema (draft-07),
   run with ajv: structure, required fields, vocabulary enums, vector and quaternion
   arities, numeric ranges, `format: 1`. A pack that names it in `$schema` gets editor
   autocomplete and inline errors.
2. **Semantic checks** — [`lib/checks.ts`](lib/checks.ts): the geometry JSON Schema cannot
   express (rules below).

```sh
npm ci --prefix tools/validate          # once: installs ajv for the CLI
npx tsx tools/validate/index.ts items/johnny
```

Prints `ok <file>` or every error as `[rule] path: message`; exits 1 on any error, 2 on bad
usage. Runs on every PR (`.github/workflows/ci.yml`) and before every deploy.

## `lib/` — the one pack implementation

Pure, dependency-free, browser-safe TypeScript modules. Each exports the types of the data it
owns — together, the Flatpack format's TypeScript mirror of the schema. The game imports them (through
`src/game/item.ts`); the CLI imports them and adds only ajv. Nothing in `lib/` imports from
`src/`, Three, Rapier, the DOM or Node (pinned by `test/conventions.test.js`).

| Module | What it holds |
|--------|---------------|
| `vocabulary.ts` | Connector types (`ConnectorType`), which end fits which hole, the fastener machines' names (`FastenerKind`), and `CONTRACT` (sink depths, cam capture radius, mate reach and tolerance) |
| `geometry.ts` | `Vec3`, `Quat`, `Pose`; quaternion and pose maths: `rotateVector`, `connectorInWorld`, `contains`, `placeLayout` |
| `pack.ts` | The file's types (`FlatpackFile` and its parts, pages, packing) and the engine's (`Pack`, `PartType`, `Connector`); `loadPack(json)`: engine-shaped part types (connectors in file order, each keeping its `id`), the manifest with spares numbered last, `resolve("<instance>/<connector>") → { part, connector: index }` |
| `joints.ts` | `Joint`; `deriveJoints(pack)`: joints from the assembled poses — a fastener end its sink depth down a compatible, facing hole; a cam's `captured` bolt; a back fitting's `through` panel |
| `checks.ts` | `CheckError`, `Rule`; `checkPack(json, { assetExists })`: the semantic rules |

Joints are never authored: an item's mating is whatever its assembled poses make coincide.
Behaviour (how a cam turns, how a dowel feels) is the engine's; a pack only names it. There
is no scripting in format 1.

## Rules

| Rule | Holds when |
|------|-----------|
| `unique-ids` | No part type names a connector twice |
| `references` | Every instance, connector reference and tool a pack names exists |
| `vocabulary` | Every connector type and fastener kind in use is declared in `vocabulary` |
| `connector-bounds` | Connectors lie inside their part's box; axes are unit length |
| `assembled-manifest` | Every instance but spares and tools is assembled exactly once; spares and tools never |
| `fastener-seats` | Every fastener end of every assembled piece of hardware seats in a hole |
| `mate-coincidence` | Every seated end sits exactly its sink depth down its hole (`CONTRACT.mateTolerance`), axes opposed |
| `hole-once` | No hole takes two fasteners |
| `cam-capture` | Every cam catches a bolt head within `CONTRACT.captureRadius`, one bolt per cam |
| `fitting-through` | Every back fitting's tip lands inside a panel behind its host |
| `step-coverage` | Step pages fasten every derived joint exactly once and turn every cam exactly once |
| `step-order` | Pages run in number order; each panel is brought in once, no later than its first joint; a cam turns on or after its seat page |
| `counts` | Steps fasten each built-in hardware type's `quantity`; spares are never fastened |
| `packing` | Every instance, spares included, is packed once, inside `boxInner`, through nothing, resting on the floor or on a part |
| `assets` | Every `mesh`, page `art` and `boxArt` exists beside the pack |

## Conformance fixture seeds (R6)

The mutations in `test/validateChecks.test.js` — one per rule, each applied to the shipped
JOHNNY — are the seeds of the conformance fixtures the Godot build must reject for the same
rule:

| Rule | Mutation of `items/johnny` |
|------|---------------------------|
| `unique-ids` | `sidePanel` connector 1 renamed to connector 0's id |
| `references` | step 1's first pair names `dowel-99/dowelEnd-1` |
| `vocabulary` | `pinTip` dropped from `vocabulary.connectors` |
| `connector-bounds` | a `sidePanel` connector moved to x = 0.5 m |
| `assembled-manifest` | spare `dowel-15` built in at `dowel-1`'s pose |
| `fastener-seats` | `shelfPin-1` moved 2 cm off its hole |
| `mate-coincidence` | `dowel-1` moved 1 mm off its seat |
| `hole-once` | `shelfPin-2` posed in `shelfPin-1`'s hole |
| `cam-capture` | `camLockBolt-1` removed from the assembly |
| `fitting-through` | side panels made 26 cm deep, short of the back fittings' tips |
| `step-coverage` | one pair dropped from step 1 |
| `step-order` | the back panel brought in on step 12, after its fittings on step 9 |
| `counts` | a spare dowel (`dowel-15`) fastened in step 1 |
| `packing` | two placements at the same position |
| `assets` | a `sidePanel` mesh that is not beside the pack |

Schema-layer seeds (missing connector id, unknown connector type or fastener kind,
`format: 2`, a three-component quaternion, a scripted page) are in
`test/flatpackSchema.test.js`.
