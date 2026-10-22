# Room save — format 1

The room's save is one JSON document, written as a single line of text through a small storage seam. It holds everything in the room: a world block, and a list of kinded objects. The format, its types, its serialiser and its parser are pure and live in `src/game/roomSave.ts`; the store seam and the saver are in `src/game/roomStore.ts`.

**Status (1.9.9.5):** the game writes the save; nothing reads it yet. Restoring a save into the room is 1.9.9.1, which this format is written for.

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
| `savedAt` | ISO 8601 time the save was written. Filled by the saver, not the snapshot, so 1.9.9.1 may choose whether the sky's clock runs on from it. |
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
4. An `item` is checked field by field; a malformed one **throws**, naming the path (`objects[0].parts.sidePanel-1.rotation: expected 4 finite numbers`). A half-read item is worse than none: 1.9.9.1 then starts the room empty and says so.
5. The parser checks shape, not the pack. Whether `johnny` exists and its ids resolve is the restorer's business.

## The extension rule

A new kind of object (scenery, decor, the room's own parts) is a new `kind` in `objects`: a new union member in `SavedObject`, a new guard in `roomSave.ts`, and a new section on this page. **Never a format bump.** A change to the shape of an *existing* record is a bump to format 2, with a migration in `parse`.

## Deliberately not saved

- Velocities, the held part, a drag in progress, the hold, the inset, the selection, the catalog's open state: transient. The saver writes only at rest points (a release, a seat or unseat, a fasten or unfasten, a repack, a recovery, a pick) and when the page goes to the background, debounced to one write per 500 ms (`SAVE` in `src/constants.ts`). A save taken mid-fall reloads mid-fall.
- Settings (snap rotate, the tune profile): not the world. A `settings` block is one addition when wanted.

## The store seam

`Store` is `read() / write(text) / clear()`. The web fills it with `localStorage` under the key `skruv.room` (`createWebStore`); where `localStorage` throws, an in-memory store stands in. The native shell can fill the same seam with Capacitor Preferences or the Filesystem in a later task; the format does not change for that. A write that fails (quota, private mode) is reported, never fatal. An empty room is saved as no save: the store is cleared.

## Split with 1.9.9.1

This format and the saver (1.9.9.5) write the save. Restoring it (1.9.9.1) builds one world per `item` record, in order, and re-creates each joint's partial progress. If restoring finds a field missing, the format bumps to 2 with a migration in `parse`.
