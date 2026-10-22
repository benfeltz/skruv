import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM_SAVE_FORMAT, parse, serialize } from '../src/game/roomSave.js';
import type { ItemRecord, RoomSave } from '../src/game/roomSave.js';

// The room's save format (1.9.9.5), pure: types, text, and the rules the parser enforces.

const pose = (x = 0) => ({ position: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] });

const johnny = (): ItemRecord => ({
  kind: 'item',
  id: 'johnny',
  documentCode: 'SK-0000451-1',
  box: pose(),
  lid: pose(1),
  parts: { 'sidePanel-1': pose(2), 'dowel-3': pose(3) },
  joints: [
    {
      hardware: 'dowel-3',
      hardwareConnector: 0,
      host: 'sidePanel-1',
      hostConnector: 4,
      kind: 'dowel',
      mover: 'dowel-3',
      fastener: { state: 'pressed', progress: 1 },
      through: null,
      captured: null,
    },
  ],
  page: 4,
});

const blank = (): ItemRecord => ({ kind: 'item', id: 'blank', documentCode: 'SK-0000452-1', box: pose(5), lid: pose(6), parts: { 'leg-1': pose(7) }, joints: [], page: 0 });

const room = (objects: RoomSave['objects']): RoomSave => ({
  format: ROOM_SAVE_FORMAT,
  savedAt: '2026-10-21T19:12:00.000Z',
  world: { sky: { phase: 0.37 }, camera: { position: [2, 1.8, 2.4], target: [0, 0.6, 0] } },
  objects,
});

/** A document with one field of the first item replaced. */
const withItem = (patch: Record<string, unknown>) => JSON.stringify(room([{ ...johnny(), ...patch }]));

describe('round trip', () => {
  it('a room of several objects comes back equal, in order, the unknown kind reported', () => {
    const scenery = { kind: 'scenery', wall: 'back' };
    const save = room([johnny(), blank(), scenery]);
    const { save: back, skipped } = parse(serialize(save));
    expect(back).toEqual(save);
    expect(back.objects.map((o) => o.kind)).toEqual(['item', 'item', 'scenery']);
    expect(skipped).toEqual(['scenery']);
  });

  it('an empty room parses; a single item parses', () => {
    expect(parse(serialize(room([]))).save.objects).toEqual([]);
    expect(parse(serialize(room([johnny()]))).save.objects).toEqual([johnny()]);
  });

  it('has no notion of a current or first item: the same items reversed parse reversed', () => {
    const three = [johnny(), blank(), { ...johnny(), id: 'overkall' }];
    expect(parse(serialize(room(three))).save.objects).toEqual(three);
    expect(parse(serialize(room([...three].reverse()))).save.objects).toEqual([...three].reverse());
  });

  it('two items of one pack with overlapping part ids parse: ids are per record', () => {
    const { save } = parse(serialize(room([johnny(), johnny()])));
    expect(save.objects).toHaveLength(2);
  });
});

describe('the rules', () => {
  it('refuses another format', () => {
    expect(() => parse(JSON.stringify({ ...room([]), format: 2 }))).toThrow('not a format 1 room save');
  });

  it('refuses a malformed world, naming the path', () => {
    const noWorld: Record<string, unknown> = { ...room([]) };
    delete noWorld.world;
    expect(() => parse(JSON.stringify(noWorld))).toThrow(/world/);
    for (const phase of [1, NaN, -0.1]) {
      const bad = room([]);
      bad.world.sky.phase = phase;
      expect(() => parse(serialize(bad))).toThrow(/world\.sky\.phase/);
    }
    const bad = room([]);
    (bad.world.camera.target as number[]) = [0, 0, 0.5, 1];
    expect(() => parse(serialize(bad))).toThrow(/world\.camera\.target/);
  });

  it('keeps an unknown kind as-is and reports it', () => {
    const scenery = { kind: 'scenery', wall: 'back' };
    const { save, skipped } = parse(serialize(room([scenery])));
    expect(save.objects).toEqual([scenery]);
    expect(skipped).toEqual(['scenery']);
  });

  it.each([
    ['a bad fastener state', { joints: [{ ...johnny().joints[0], fastener: { state: 'glued', progress: 1 } }] }, /objects\[0\]\.joints\[0\]\.fastener\.state/],
    ['a progress of 1.5', { joints: [{ ...johnny().joints[0], fastener: { state: 'pressed', progress: 1.5 } }] }, /fastener\.progress/],
    ['a bad joint kind', { joints: [{ ...johnny().joints[0], kind: 'glue' }] }, /joints\[0\]\.kind/],
    ['a page of -1', { page: -1 }, /objects\[0\]\.page/],
    ['a part id Side1', { parts: { Side1: pose() } }, /objects\[0\]\.parts\.Side1/],
    ['a short rotation', { box: { position: [0, 0, 0], rotation: [0, 0, 1] } }, /objects\[0\]\.box\.rotation/],
  ])('throws on an item with %s, naming the path', (_, patch, path) => {
    expect(() => parse(withItem(patch))).toThrow(path);
  });
});

describe('the fixture', () => {
  const text = readFileSync('test/fixtures/roomSave/format-1.json', 'utf8');

  it('parses with the scenery reported, Johnny first and Blank second', () => {
    const { save, skipped } = parse(text);
    expect(skipped).toEqual(['scenery']);
    const [first, second] = save.objects as ItemRecord[];
    expect(first.documentCode).toBe('SK-0000451-1');
    expect(first.joints[0].kind).toBe('dowel');
    expect(first.joints[0].host).toMatch(/^side/);
    expect(second.id).toBe('blank');
  });

  it('round-trips through serialize', () => {
    const { save } = parse(text);
    expect(parse(serialize(save)).save).toEqual(save);
  });
});
