import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';

// ajv is the validator CLI's own dependency (tools/validate/package.json) — never the game's.
const require = createRequire(new URL('../tools/validate/package.json', import.meta.url));
const schema = JSON.parse(readFileSync(new URL('../tools/validate/flatpack.schema.json', import.meta.url), 'utf8'));

const connector = (id, type, position = [0, 0, 0], axis = [0, 1, 0]) => ({ id, type, position, axis });
const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

// A board with a hole, a dowel for it, and one step that seats it.
function fixture() {
  return {
    format: 1,
    identity: { product: 'TEST', maker: 'SKRUV', documentCode: 'SK-0' },
    vocabulary: { connectors: ['dowelHole', 'dowelEnd'], fasteners: ['dowel'] },
    parts: {
      board: { partNumber: '10000', box: [0.2, 0.016, 0.2], mass: 1, color: 'partPanel', quantity: 1, connectors: [connector('dowelHole-1', 'dowelHole')] },
      dowel: { partNumber: '10001', box: [0.008, 0.03, 0.008], mass: 0.01, color: 'partDowel', quantity: 1, spares: 1, connectors: [connector('dowelEnd-1', 'dowelEnd')] },
    },
    assembled: [{ id: 'board-1', role: 'board', ...POSE }, { id: 'dowel-1', role: 'hardware', ...POSE }],
    manual: {
      pages: [
        { kind: 'cover' },
        { kind: 'doDont', subject: 'protectFloor' },
        { kind: 'step', number: 1, pose: 'parts', parts: ['board-1'], fasten: [['dowel-1/dowelEnd-1', 'board-1/dowelHole-1']] },
        { kind: 'special', number: 2, pose: 'upright', special: 'tipUpright' },
        { kind: 'back' },
      ],
    },
    packing: {
      boxInner: [0.3, 0.1, 0.3],
      wall: 0.01,
      floor: 0.01,
      lid: { thickness: 0.008, partNumber: '10002', mass: 0.2, color: 'cardboard' },
      placements: [{ id: 'board-1', ...POSE }, { id: 'dowel-1', ...POSE }, { id: 'dowel-2', ...POSE }],
    },
    tuning: {},
  };
}

let validate;
beforeAll(() => {
  const Ajv = require('ajv');
  validate = new Ajv({ allErrors: true }).compile(schema);
});

describe('flatpack.schema.json', () => {
  it('accepts a minimal valid pack', () => {
    expect(validate(fixture()), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    ['a connector with no id', (p) => delete p.parts.board.connectors[0].id],
    ['an unknown connector type', (p) => (p.parts.board.connectors[0].type = 'nail')],
    ['an unknown fastener kind', (p) => p.vocabulary.fasteners.push('glue')],
    ['format 2', (p) => (p.format = 2)],
    ['a three-component quaternion', (p) => (p.assembled[0].rotation = [0, 0, 1])],
    ['a non-positive size', (p) => (p.parts.board.box[1] = 0)],
    ['a malformed connector ref', (p) => (p.manual.pages[2].fasten[0][1] = 'board-1')],
    ['a step page with no number', (p) => delete p.manual.pages[2].number],
    ['a page kind outside the format', (p) => p.manual.pages.push({ kind: 'appendix' })],
    ['a doDont page with no subject', (p) => delete p.manual.pages[1].subject],
    ['a scripted page', (p) => (p.manual.pages[2].script = 'turn()')],
    ['an asset outside assets/', (p) => (p.parts.board.mesh = '../board.glb')],
    ['an unknown top-level section', (p) => (p.scripts = {})],
    ['a five-digit part number broken', (p) => (p.parts.board.partNumber = '1234')],
  ])('rejects %s', (_, mutate) => {
    const pack = fixture();
    mutate(pack);
    expect(validate(pack)).toBe(false);
  });

  it('names exactly the engine vocabulary — no drift between schema and lib', () => {
    expect([...schema.definitions.connectorType.enum].sort()).toEqual(Object.values(CONNECTOR).sort());
    expect([...schema.definitions.fastenerKind.enum].sort()).toEqual(Object.values(KIND).sort());
  });
});
