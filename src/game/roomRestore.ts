// Reading the room's save back into a plan for the room (1.9.9.1). Pure: the stored text and
// the packs in, what the room will hold out — decided before anything is built, so a save this
// build cannot restore costs the room nothing. Docs: docs/room-save/format-1.md.
//
// `parse` (roomSave.ts) checks the save's shape; `checkItem` here checks it against the
// pack: that the item exists, its manifest is the one the save was written for, and every
// joint is a pair the fastener machine can hold. Either the whole room restores or none of it.

import { STATE } from './fasteners.js';
import { COMPATIBLE, KIND, kindOf } from '../../tools/validate/lib/vocabulary.js';
import { parse } from './roomSave.js';
import type { Item } from './item.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';
import type { FastenerState } from './fasteners.js';
import type { ItemRecord, UnknownObject, WorldState } from './roomSave.js';

/** What the room will hold: the world, the items to rebuild, the unknown objects to carry, the items past capacity. */
export interface RestorePlan {
  world: WorldState;
  items: ItemRecord[];
  others: UnknownObject[];
  dropped: ItemRecord[];
}

export type RestoreResult = { kind: 'none' } | { kind: 'room'; plan: RestorePlan } | { kind: 'refused'; error: Error };

// The states a kind's machine can rest in; tap kinds are the only ones with a 0/1 progress.
const STATES_OF: Readonly<Record<FastenerKind, readonly FastenerState[]>> = Object.freeze({
  [KIND.DOWEL]: [STATE.SEATED, STATE.PRESSED],
  [KIND.PIN]: [STATE.SEATED, STATE.PRESSED],
  [KIND.FITTING]: [STATE.SEATED, STATE.PRESSED],
  [KIND.BOLT]: [STATE.SEATED, STATE.SCREWED],
  [KIND.STUD]: [STATE.SEATED, STATE.SCREWED],
  [KIND.SCREW]: [STATE.SEATED, STATE.SCREWED],
  [KIND.CAM]: [STATE.SEATED, STATE.LOCKED],
  [KIND.TOOL]: [STATE.SEATED],
});
const TAP_KINDS: readonly FastenerKind[] = [KIND.DOWEL, KIND.PIN, KIND.FITTING];

/** Throws `path: expected …` unless `ok`, as `parse` does. */
function expect(ok: boolean, path: string, what: string): asserts ok {
  if (!ok) throw new Error(`${path}: expected ${what}`);
}

/** Throws `objects[i].…: expected …` unless `record` fits `item`: its documentCode, its manifest, and every joint a pair the machine can hold. */
export function checkItem(record: ItemRecord, item: Item, path: string): void {
  expect(record.documentCode === item.identity.documentCode, `${path}.documentCode`, `"${item.identity.documentCode}"`);
  const typeOf = new Map(item.manifest.map((entry) => [entry.id, entry.type]));
  for (const id of typeOf.keys()) expect(id in record.parts, `${path}.parts.${id}`, 'a pose for every part in the manifest');
  for (const id of Object.keys(record.parts)) expect(typeOf.has(id), `${path}.parts.${id}`, 'an id in the manifest');

  const connectorOf = (id: string, index: number, at: string) => {
    const connectors = item.partTypes[typeOf.get(id)!].connectors;
    expect(index < connectors.length, at, `an index below ${connectors.length}`);
    return connectors[index];
  };
  record.joints.forEach((joint, i) => {
    const at = `${path}.joints[${i}]`;
    for (const key of ['hardware', 'host', 'mover'] as const) expect(typeOf.has(joint[key]), `${at}.${key}`, 'an id in the manifest');
    for (const key of ['through', 'captured'] as const) expect(joint[key] === null || typeOf.has(joint[key]), `${at}.${key}`, 'null or an id in the manifest');
    const end = connectorOf(joint.hardware, joint.hardwareConnector, `${at}.hardwareConnector`);
    const hole = connectorOf(joint.host, joint.hostConnector, `${at}.hostConnector`);
    expect(COMPATIBLE[end.type] === hole.type, `${at}.hostConnector`, `a ${COMPATIBLE[end.type] ?? 'fastener end'} to take ${end.type}`);
    expect(joint.kind === kindOf(end.type), `${at}.kind`, `"${kindOf(end.type)}"`);
    expect(STATES_OF[joint.kind].includes(joint.fastener.state), `${at}.fastener.state`, `one of ${STATES_OF[joint.kind].join(', ')}`);
    expect(!TAP_KINDS.includes(joint.kind) || joint.fastener.progress === 0 || joint.fastener.progress === 1, `${at}.fastener.progress`, '0 or 1');
  });
}

/** Reads `text` (null: no save) into what the room will hold; refuses with the parser's or the check's error. */
export function planRestore(text: string | null, deps: { item: (id: string) => Item | null; capacity: number }): RestoreResult {
  if (text === null) return { kind: 'none' };
  try {
    const { save } = parse(text);
    const items: ItemRecord[] = [];
    const others: UnknownObject[] = [];
    save.objects.forEach((object, i) => {
      if (object.kind !== 'item') return void others.push(object as UnknownObject);
      const record = object as ItemRecord;
      const item = deps.item(record.id);
      expect(item !== null, `objects[${i}].id`, 'an item this build carries');
      checkItem(record, item, `objects[${i}]`);
      items.push(record);
    });
    return { kind: 'room', plan: { world: save.world, items: items.slice(0, deps.capacity), others, dropped: items.slice(deps.capacity) } };
  } catch (error) {
    return { kind: 'refused', error: error instanceof Error ? error : new Error(String(error)) };
  }
}
