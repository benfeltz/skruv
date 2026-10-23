# Room save — format 1

The room's save is one JSON document, written as a single line of text through a small storage seam. It holds everything in the room: a world block, and a list of kinded objects. The format, its types, its serialiser and its parser are pure and live in `src/game/roomSave.ts`; the store seam and the saver are in `src/game/roomStore.ts`; the plan for reading it back is in `src/game/roomRestore.ts`.

**Status (1.9.9.1):** the game writes the save and restores it at boot.

## The document

This is the test fixture (`test/fixtures/roomSave/format-1.json`), copied verbatim: two items and a scenery entry. A test pins that this page contains it.

```json
{
  "format": 1,
  "savedAt": "2026-10-21T19:12:00.000Z",
  "world": {
    "sky": { "phase": 0.37 },
    "camera": { "position": [2, 1.8, 2.4], "target": [0, 0.6, 0] }
  },
  "objects": [
    {
      "kind": "item",
      "id": "johnny",
      "documentCode": "SK-0000451-1",
      "box": { "position": [0, 0.05, 0], "rotation": [0, 0, 0, 1] },
      "lid": { "position": [0, 0.2, 0], "rotation": [0, 0, 0, 1] },
      "parts": {
        "sidePanel-1": { "position": [0.3, 0.9, 0], "rotation": [0, 0, 0, 1] },
        "dowel-3": { "position": [0.3, 0.9, 0.1], "rotation": [0, 0, 0.7071067811865476, 0.7071067811865476] }
      },
      "joints": [
        {
          "hardware": "dowel-3",
          "hardwareConnector": 0,
          "host": "sidePanel-1",
          "hostConnector": 4,
          "kind": "dowel",
          "mover": "dowel-3",
          "fastener": { "state": "pressed", "progress": 1 },
          "through": null,
          "captured": null
        }
      ],
      "page": 4
    },
    {
      "kind": "item",
      "id": "blank",
      "documentCode": "SK-0000452-1",
      "box": { "position": [1.5, 0.05, 0], "rotation": [0, 0, 0, 1] },
      "lid": { "position": [1.5, 0.2, 0], "rotation": [0, 0, 0, 1] },
      "parts": {
        "leg-1": { "position": [1.5, 0.3, 0], "rotation": [0, 0, 0, 1] }
      },
      "joints": [],
      "page": 0
    },
    { "kind": "scenery", "wall": "back", "state": { "painted": true } }
  ]
}
```

## Fields

| Field | Meaning |
|-------|---------|
| `format` | Always `1`. Anything else is refused (`not a format 1 room save`). |
| `savedAt` | ISO 8601 time the save was written. Filled by the saver, not the snapshot, and read by nothing: the sky resumes at its saved phase, not advanced by the time away. |
| `world.sky.phase` | The sky's phase in `[0, 1)`: 0 midnight, 0.5 noon. |
| `world.camera` | `position` and orbit `target`, metres, as `[x, y, z]`. |
| `objects` | The room: one record per object, in the order the room holds them. Any length, zero included (an empty room). No "current" item. |

### `item` record

| Field | Meaning |
|-------|---------|
| `id`, `documentCode` | Which pack. `documentCode` guards against a pack whose manifest changed taking its old poses. |
| `box`, `lid` | Poses of the box base and its lid. |
| `parts` | Pose by instance id (`<type>-<n>`, like `sidePanel-1`) of every player part. |
| `joints` | Every seated pair: `hardware`/`hardwareConnector`, `host`/`hostConnector`, `kind` (a fastener kind from the pack vocabulary), `mover`, `fastener` (`state` one of `seated`, `pressed`, `screwed`, `locked`; `progress` in `[0, 1]`), `through`, `captured` (part id or `null`). The physics joints are derived from these, never saved. |
| `page` | The manual's page (a non-negative integer). |

A pose is `{ "position": [x, y, z], "rotation": [x, y, z, w] }`: metres and a quaternion, as everywhere in the game. Two `item` records may name the same pack; their part ids are their own, so nothing collides across records, and the restorer builds one world per record.

## What the parser enforces

1. `format` must be `1`.
2. `world` is required: `sky.phase` a finite number in `[0, 1)`, `camera` two vectors of finite numbers; `savedAt` an ISO string.
3. `objects` is an array of any length. Every `item` is parsed. An object whose `kind` this build does not know is **kept as-is and reported** (`skipped: ['scenery']`), never thrown on and never dropped, so a save written by a newer build survives a round trip through an older one.
4. An `item` is checked field by field; a malformed one **throws**, naming the path (`objects[0].parts.sidePanel-1.rotation: expected 4 finite numbers`). A half-read item is worse than none: the restore then starts the room empty and says so.
5. The parser checks shape, not the pack. Whether `johnny` exists and its ids resolve is the restorer's business.

## The extension rule

A new kind of object (scenery, decor, the room's own parts) is a new `kind` in `objects`: a new union member in `SavedObject`, a new guard in `roomSave.ts`, and a new section on this page. **Never a format bump.** A change to the shape of an *existing* record is a bump to format 2, with a migration in `parse`.

## Deliberately not saved

- Velocities, the held part, a drag in progress, the hold, the inset, the selection, the catalog's open state: transient. The saver writes only at rest points (a release, a seat or unseat, a fasten or unfasten, a repack, a recovery, a page turn, a pick) and when the page goes to the background, debounced to one write per 500 ms (`SAVE` in `src/constants.ts`). A save taken mid-fall reloads mid-fall. A hand turn (the inset's turn ring, a stud circled by hand) has no event of its own: its full turn fires a fasten and is saved, its partway progress rides to the next rest point or the background flush, and a half-turn lost to a crash is a half-turn.
- Settings (snap rotate, the tune profile): not the world. A `settings` block is one addition when wanted.

## The store seam

`Store` is `read() / write(text) / clear()`. The web fills it with `localStorage` under the key `skruv.room` (`createWebStore`); where `localStorage` throws, an in-memory store stands in. The native shell can fill the same seam with Capacitor Preferences or the Filesystem in a later task; the format does not change for that. A write that fails (quota, private mode) is reported, never fatal. A null snapshot (an empty room) writes nothing: the store keeps whatever it had, so a save the restore refused survives until the next pick writes over it. Nothing clears the store yet; a later "new room" action will call `Store.clear()` itself.

## Restoring

At boot, before the first frame, `planRestore` (`src/game/roomRestore.ts`) reads the stored text against the packs, and `src/main.ts` acts on the answer.

- **No save** boots the empty room as ever; the console says `room: no save, starting empty`.
- **Either the whole room restores or none of it.** The text is parsed, then every `item` record is checked against its pack before anything is built: the `id` is an item this build carries, `documentCode` equals the pack's, `parts` holds exactly the manifest's instance ids, and every joint names manifest parts and connector indices that exist, a hardware end whose type fits the host hole, the `kind` of that end, and a state its kind can rest in. A save that fails either step is refused: the room starts empty, the catalog shows a notice (only when a save existed; a first run gets none), the console names the path, and **the stored text is left alone** until the next pick writes a real save over it.
- **One world per `item` record, one record per id.** Every record restores, in the save's order, so the last is the active world. A later record of an id already restored is a duplicate (this build never writes one: a hand edit or a newer build) and is dropped and warned about in the console; the next write holds only what was restored.
- **Kept worlds.** The order of `objects` is the room's order: the kept worlds first, the active world last, with no field for either. A kept world is inert (no gestures, no manual strip, no sweep) until its item is picked again; it stays in the physics world and on screen, can be bumped, and keeps its drawn hardware (a sunk bolt, a rider in a panel), and the restore leaves every world but the last kept. A pick of an item whose world is in the room makes that world active again rather than building a second, so the room holds one manual per item.
- **Unknown kinds are carried**: the objects `parse` skipped are kept and appended to every later save, so a save from a newer build survives a round trip through this one as well as through the parser.
- **Every body is set down at its saved pose**, then the joints are replayed through the fastener machine, never set: each pair is seated, a tap kind pressed, a turned kind driven home and backed off or turned in to its saved progress, bolts before the cams that catch them. The live fastener must land on the saved `state` and `progress`; a record the machine cannot reach refuses the save as a whole. The physics bonds and any loose hardware's hold follow from the restored graph.
- **Tool joints** (a wrench seated on a bolt head) pass the check and are not restored: the router keeps a tool's grip in state the record does not carry, and a tool fastens nothing. The tool rests loose where its pose says. They are still written.
- The manual returns to its `page` (clamped to the pages the world has), the camera to its `position` and `target`, and the sky to its `phase`. `savedAt` is not used.
