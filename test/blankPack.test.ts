import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { deriveJoints } from '../tools/validate/lib/joints.js';
import { loadPack } from '../tools/validate/lib/pack.js';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';
import { COLORS } from '../src/constants.js';
import { createBooklet, gamePagesFor } from '../src/game/bookletModel.js';
import { itemById } from '../src/game/item.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';

// BLANK's own facts, on the shipped pack (1.9.2): a box top, four box legs, four
// double-ended studs and an allen key. The generic integrity rules are the validator's and run
// here too (packing rests and fits among them).

const FILE: FlatpackFile = JSON.parse(readFileSync(new URL('../items/blank/flatpack.json', import.meta.url), 'utf8'));
const pack = loadPack(FILE);
const joints = deriveJoints(pack);
const count = (type: string) => pack.manifest.filter((p) => p.type === type).length;

describe('the BLANK pack', () => {
  it('passes the validator, packing included', () => {
    expect(checkPack(FILE)).toEqual([]);
  });

  it('boxes ten instances: a top, four legs, four studs and the key — no spares', () => {
    expect(pack.manifest).toHaveLength(10);
    expect([count('top'), count('leg'), count('doubleEndedStud'), count('allenWrench')]).toEqual([1, 4, 4, 1]);
    expect(pack.spares.size).toBe(0);
  });

  it('names the product BLANK by SKRUV, and nobody else', () => {
    expect(pack.identity).toMatchObject({ product: 'BLANK', maker: 'SKRUV' });
    expect(JSON.stringify(FILE)).not.toMatch(/IKEA|LACK/i);
  });

  it('derives eight stud joints: each stud driven into the top, each leg pressed onto a stud', () => {
    expect(joints).toHaveLength(8);
    expect(joints.every((j) => j.kind === KIND.STUD)).toBe(true);
    const intoTop = joints.filter((j) => j.host === 'top-1');
    const intoLeg = joints.filter((j) => j.host.startsWith('leg-'));
    expect([intoTop.length, intoLeg.length]).toEqual([4, 4]);
    for (const j of intoTop) expect(j.mover).toBe(j.hardware);
    for (const j of intoLeg) expect(j.mover).toBe(j.host);
  });

  it('gives every stud a hex socket at each end, on the end itself, and keeps legs and top plain boxes', () => {
    const stud = pack.partTypes.doubleEndedStud.connectors;
    expect(stud.map((c) => c.type)).toEqual([CONNECTOR.STUD_END, CONNECTOR.STUD_END, CONNECTOR.BOLT_HEAD, CONNECTOR.BOLT_HEAD]);
    expect(stud[2].position).toEqual(stud[0].position);
    expect(stud[3].position).toEqual(stud[1].position);
    for (const part of Object.values(FILE.parts)) expect(part.mesh).toBeUndefined();
  });

  it('uses only colours the game defines', () => {
    for (const part of Object.values(pack.partTypes)) expect(COLORS).toHaveProperty(part.color);
  });

  it('draws its two build steps upside down, then tips the table upright', () => {
    const poses = FILE.manual.pages.flatMap((p) => (p.kind === 'step' || p.kind === 'special' ? [p.pose] : []));
    expect(poses).toEqual(['upsideDown', 'upsideDown', 'upright']);
  });
});

describe("BLANK's booklet", () => {
  const item = itemById('blank');
  const pages = createBooklet(item.manual.pages, {
    layout: item.assembled,
    manifest: item.manifest,
    partTypes: item.partTypes,
    resolve: item.resolve,
    gamePages: gamePagesFor('touch', item.kinds),
  });

  it('runs cover to back with the controls page second to last, listing the item\'s kinds', () => {
    expect(pages[0].kind).toBe('cover');
    expect(pages.at(-1)!.kind).toBe('backCover');
    expect(pages.at(-2)).toMatchObject({ kind: 'controls', scheme: 'touch', kinds: expect.arrayContaining([KIND.STUD, KIND.TOOL]) });
  });

  it('gives step 1 the key and four studs into the top, step 2 four legs by hand', () => {
    const steps = pages.flatMap((p) => (p.kind === 'step' ? [p] : []));
    expect(steps.map((s) => [s.number, s.pose, s.tool, s.joints.length, s.parts.length])).toEqual([
      [1, 'upsideDown', 'allenWrench', 4, 1],
      [2, 'upsideDown', null, 4, 4],
      // The tip-upright page: no fastening, the table turned over.
      [3, 'upright', null, 0, 0],
    ]);
  });
});
