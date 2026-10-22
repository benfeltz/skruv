import { describe, expect, it } from 'vitest';
import { ROOM_SAVE_FORMAT, serialize } from '../src/game/roomSave.js';
import { checkItem, planRestore } from '../src/game/roomRestore.js';
import { ITEM_IDS, itemById } from '../src/game/item.js';
import type { ItemRecord, RoomSave, SavedJoint } from '../src/game/roomSave.js';

// The pure restore plan (1.9.9.1): what a stored text becomes, and what a record must satisfy
// against its pack. Records are built from the real manifests, so the checks run on real ids.

const IDENTITY_POSE = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };
const lookup = (id: string) => (ITEM_IDS.includes(id) ? itemById(id) : null);

/** A joint the pack assembles, as a saved record in the given state. */
function jointOf(id: string, kind: string, fastener: SavedJoint['fastener']): SavedJoint {
  const j = itemById(id).assembled.joints.find((c) => c.kind === kind);
  if (!j) throw new Error(`${id} has no ${kind} joint`);
  return { hardware: j.hardware, hardwareConnector: j.hardwareConnector, host: j.host, hostConnector: j.hostConnector, kind: j.kind, mover: j.mover, fastener, through: j.through, captured: j.captured };
}

function recordOf(id: string, joints: SavedJoint[] = []): ItemRecord {
  const item = itemById(id);
  return {
    kind: 'item',
    id,
    documentCode: item.identity.documentCode,
    box: IDENTITY_POSE,
    lid: IDENTITY_POSE,
    parts: Object.fromEntries(item.manifest.map((m) => [m.id, IDENTITY_POSE])),
    joints,
    page: 2,
  };
}

const room = (objects: RoomSave['objects']): RoomSave => ({
  format: ROOM_SAVE_FORMAT,
  savedAt: '2026-10-21T19:12:00.000Z',
  world: { sky: { phase: 0.37 }, camera: { position: [2, 1.8, 2.4], target: [0, 0.6, 0] } },
  objects,
});

const pressedDowel = () => jointOf('johnny', 'dowel', { state: 'pressed', progress: 1 });
const johnnyWith = (edit: (r: ItemRecord) => void) => {
  const r = recordOf('johnny', [pressedDowel()]);
  edit(r);
  return r;
};
const check = (r: ItemRecord) => checkItem(r, itemById('johnny'), 'objects[0]');

describe('checkItem', () => {
  it('passes a record built from the pack', () => {
    expect(() => check(recordOf('johnny', [pressedDowel()]))).not.toThrow();
  });

  it('passes a tool joint', () => {
    // Tools are never assembled into the item, so the pair is found in the manifest: a wrench tip on a hex socket.
    const item = itemById('johnny');
    const endOf = (type: string) => {
      for (const m of item.manifest) {
        const index = item.partTypes[m.type].connectors.findIndex((c) => c.type === type);
        if (index >= 0) return { id: m.id, index };
      }
      throw new Error(`no ${type} in Johnny's manifest`);
    };
    const wrench = endOf('wrenchTip');
    const socket = endOf('hexSocket');
    const tool: SavedJoint = {
      hardware: wrench.id,
      hardwareConnector: wrench.index,
      host: socket.id,
      hostConnector: socket.index,
      kind: 'tool',
      mover: wrench.id,
      fastener: { state: 'seated', progress: 0 },
      through: null,
      captured: null,
    };
    expect(() => check(recordOf('johnny', [tool]))).not.toThrow();
  });

  it.each([
    ['a wrong documentCode', (r: ItemRecord) => void (r.documentCode = 'SK-9999999-1'), 'objects[0].documentCode'],
    ['a manifest id missing from parts', (r: ItemRecord) => void delete r.parts['sidePanel-1'], 'objects[0].parts.sidePanel-1'],
    ['an extra parts key', (r: ItemRecord) => void (r.parts['ghost-1'] = IDENTITY_POSE), 'objects[0].parts.ghost-1'],
    ['a hostConnector past the type', (r: ItemRecord) => void (r.joints[0].hostConnector = 99), 'objects[0].joints[0].hostConnector: expected an index below'],
    ['a hardwareConnector past the type', (r: ItemRecord) => void (r.joints[0].hardwareConnector = 99), 'objects[0].joints[0].hardwareConnector'],
    ['an incompatible pair', (r: ItemRecord) => void (r.joints[0].host = r.joints[0].hardware), 'objects[0].joints[0].hostConnector'],
    ['a kind that is not the hardware end\'s', (r: ItemRecord) => void (r.joints[0].kind = 'bolt'), 'objects[0].joints[0].kind'],
    ['a dowel screwed', (r: ItemRecord) => void (r.joints[0].fastener = { state: 'screwed', progress: 1 }), 'objects[0].joints[0].fastener.state'],
    ['a dowel half pressed', (r: ItemRecord) => void (r.joints[0].fastener = { state: 'pressed', progress: 0.5 }), 'objects[0].joints[0].fastener.progress'],
    ['a mover not in the manifest', (r: ItemRecord) => void (r.joints[0].mover = 'ghost-1'), 'objects[0].joints[0].mover'],
    ['a captured not in the manifest', (r: ItemRecord) => void (r.joints[0].captured = 'ghost-1'), 'objects[0].joints[0].captured'],
    ['a through not in the manifest', (r: ItemRecord) => void (r.joints[0].through = 'ghost-1'), 'objects[0].joints[0].through'],
  ])('refuses %s, naming the path', (_what, edit, path) => {
    expect(() => check(johnnyWith(edit))).toThrow(path);
  });

  it('refuses a bolt pressed', () => {
    const bolt = jointOf('johnny', 'bolt', { state: 'pressed', progress: 1 });
    expect(() => check(recordOf('johnny', [bolt]))).toThrow('objects[0].joints[0].fastener.state');
  });
});

describe('planRestore', () => {
  const two = () => room([recordOf('johnny', [pressedDowel()]), recordOf('blank'), { kind: 'scenery', wall: 'back' }]);

  it('is none for no save', () => {
    expect(planRestore(null, { item: lookup, capacity: 1 })).toEqual({ kind: 'none' });
  });

  it('returns a room for a record that fits', () => {
    const result = planRestore(serialize(room([recordOf('johnny', [pressedDowel()])])), { item: lookup, capacity: 1 });
    expect(result.kind).toBe('room');
    if (result.kind === 'room') expect(result.plan.items.map((r) => r.id)).toEqual(['johnny']);
  });

  it('refuses with the parser\'s error', () => {
    const result = planRestore('{"format":1}', { item: lookup, capacity: 1 });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.error.message).toContain('savedAt');
  });

  it('refuses text that is not JSON', () => {
    expect(planRestore('nope', { item: lookup, capacity: 1 }).kind).toBe('refused');
  });

  it('refuses an item this build does not carry', () => {
    const r = recordOf('johnny');
    r.id = 'ghost';
    const result = planRestore(serialize(room([r])), { item: lookup, capacity: 1 });
    expect(result.kind === 'refused' && result.error.message).toContain('objects[0].id');
  });

  it('keeps the first `capacity` items, drops the rest, carries unknown kinds', () => {
    const result = planRestore(serialize(two()), { item: lookup, capacity: 1 });
    if (result.kind !== 'room') throw new Error('expected a room');
    expect(result.plan.items.map((r) => r.id)).toEqual(['johnny']);
    expect(result.plan.dropped.map((r) => r.id)).toEqual(['blank']);
    expect(result.plan.others).toEqual([{ kind: 'scenery', wall: 'back' }]);
    expect(result.plan.world).toEqual(two().world);
  });

  it('restores both with capacity 2', () => {
    const result = planRestore(serialize(two()), { item: lookup, capacity: 2 });
    if (result.kind !== 'room') throw new Error('expected a room');
    expect(result.plan.items.map((r) => r.id)).toEqual(['johnny', 'blank']);
    expect(result.plan.dropped).toEqual([]);
  });

  it('refuses the whole save when a dropped record does not fit', () => {
    const bad = recordOf('blank');
    bad.documentCode = 'SK-0';
    const result = planRestore(serialize(room([recordOf('johnny'), bad])), { item: lookup, capacity: 1 });
    expect(result.kind === 'refused' && result.error.message).toContain('objects[1].documentCode');
  });
});
