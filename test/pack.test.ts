import { describe, expect, it } from 'vitest';
import { loadPack as loadFlatpack, refOf } from '../tools/validate/lib/pack.js';
import type { ConnectorSpec, FlatpackFile } from '../tools/validate/lib/pack.js';
import type { Pose, Vec3 } from '../tools/validate/lib/geometry.js';
import type { ConnectorType } from '../tools/validate/lib/vocabulary.js';

// Widened to any format number: the format check below hands it one the file type forbids.
const loadPack = (json: Omit<FlatpackFile, 'format'> & { format: number }) => loadFlatpack(json as FlatpackFile);

const connector = (id: string, type: ConnectorType, position: Vec3 = [0, 0, 0], axis: Vec3 = [0, 1, 0]): ConnectorSpec => ({ id, type, position, axis });
const POSE: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

// Three part types: a board, a dowel with spares, a tool.
function fixture(): FlatpackFile {
  return {
    format: 1,
    identity: { product: 'TEST', maker: 'SKRUV', documentCode: 'SK-0' },
    vocabulary: { connectors: ['dowelHole', 'dowelEnd', 'wrenchTip'], fasteners: ['dowel', 'tool'] },
    parts: {
      board: {
        partNumber: '10000', box: [0.2, 0.016, 0.2], mass: 1, color: 'partPanel', quantity: 2,
        connectors: [connector('dowelHole-1', 'dowelHole'), connector('dowelHole-2', 'dowelHole', [0.1, 0, 0], [1, 0, 0])],
      },
      dowel: {
        partNumber: '10001', box: [0.008, 0.03, 0.008], mass: 0.01, color: 'partDowel', quantity: 2, spares: 1,
        connectors: [connector('dowelEnd-1', 'dowelEnd'), connector('dowelEnd-2', 'dowelEnd', [0, -0.015, 0], [0, -1, 0])],
      },
      wrench: { partNumber: '10002', box: [0.07, 0.004, 0.025], mass: 0.015, color: 'partWrench', quantity: 1, connectors: [connector('wrenchTip-1', 'wrenchTip')] },
    },
    assembled: [{ id: 'board-1', role: 'left', ...POSE }, { id: 'dowel-2', role: 'hardware', ...POSE }],
    manual: { pages: [{ kind: 'cover' }] },
    packing: { boxInner: [0.3, 0.1, 0.3], wall: 0.01, floor: 0.01, lid: { thickness: 0.008, partNumber: '10003', mass: 0.2, color: 'cardboard' }, placements: [] },
  };
}

describe('loadPack', () => {
  const pack = loadPack(fixture());

  it('shapes part types as the engine has them, connectors in file order with their ids', () => {
    expect(pack.partTypes.board).toEqual({
      size: [0.2, 0.016, 0.2],
      partNumber: '10000',
      mass: 1,
      color: 'partPanel',
      connectors: fixture().parts.board.connectors,
    });
    expect(pack.partTypes.board.connectors.map((c) => c.id)).toEqual(['dowelHole-1', 'dowelHole-2']);
  });

  it('expands the manifest in part order, spares numbered last', () => {
    expect(pack.manifest).toEqual([
      { id: 'board-1', type: 'board' },
      { id: 'board-2', type: 'board' },
      { id: 'dowel-1', type: 'dowel' },
      { id: 'dowel-2', type: 'dowel' },
      { id: 'dowel-3', type: 'dowel' },
      { id: 'wrench-1', type: 'wrench' },
    ]);
    expect([...pack.spares]).toEqual(['dowel-3']);
  });

  it('types the assembled instances and keeps their roles', () => {
    expect(pack.assembled[1]).toEqual({ id: 'dowel-2', type: 'dowel', role: 'hardware', ...POSE });
  });

  it('defaults tuning to empty', () => {
    expect(pack.tuning).toEqual({});
  });

  it('resolves a connector name to today\'s index, and back', () => {
    expect(pack.resolve('dowel-3/dowelEnd-2')).toEqual({ part: 'dowel-3', connector: 1 });
    expect(pack.resolve('board-2/dowelHole-1')).toEqual({ part: 'board-2', connector: 0 });
    const typeOf = (id: string) => pack.manifest.find((p) => p.id === id)!.type;
    expect(refOf(pack.partTypes, typeOf, 'dowel-3', 1)).toBe('dowel-3/dowelEnd-2');
  });

  it.each([
    ['an unknown instance', 'board-3/dowelHole-1'],
    ['an unknown connector', 'board-1/dowelHole-9'],
    ['a malformed reference', 'board-1'],
  ])('throws on %s', (_, ref) => {
    expect(() => pack.resolve(ref)).toThrow();
  });

  it('throws on a duplicate connector id', () => {
    const json = fixture();
    json.parts.board.connectors[1].id = 'dowelHole-1';
    expect(() => loadPack(json)).toThrow(/duplicate connector id dowelHole-1/);
  });

  it('throws on an assembled instance not in the box', () => {
    const json = fixture();
    json.assembled.push({ id: 'dowel-9', role: 'hardware', ...POSE });
    expect(() => loadPack(json)).toThrow(/dowel-9/);
  });

  it('refuses any format but 1', () => {
    expect(() => loadPack({ ...fixture(), format: 2 })).toThrow(/format 2/);
  });
});
