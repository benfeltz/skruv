import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkPack, RULES } from '../tools/validate/lib/checks.js';
import type { Rule } from '../tools/validate/lib/checks.js';
import type { Vec3, Pose } from '../tools/validate/lib/geometry.js';
import type { FlatpackFile, PageFields, StepPage } from '../tools/validate/lib/pack.js';

const JOHNNY: FlatpackFile = JSON.parse(readFileSync(new URL('../items/johnny/flatpack.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(JOHNNY);
// The steps the mutations below touch all fasten something.
const step = (pack: FlatpackFile, number: number) => (pack.manual.pages as PageFields[]).find((p) => p.number === number) as StepPage & Required<Pick<StepPage, 'fasten'>>;
const posed = (pack: FlatpackFile, id: string) => pack.assembled.find((a) => a.id === id)!;
const nudge = (pose: Pose, axis: number, metres: number) => {
  pose.position[axis] += metres;
};

// One mutation per rule — each a conformance seed: any engine's validator must reject it
// for the same reason (tools/validate/README.md).
const MUTATIONS: [Rule, string, (p: FlatpackFile) => unknown][] = [
  ['unique-ids', 'a connector id used twice on a part', (p) => (p.parts.sidePanel.connectors[1].id = p.parts.sidePanel.connectors[0].id)],
  ['references', 'a step naming an instance not in the box', (p) => (step(p, 1).fasten[0][0] = 'dowel-99/dowelEnd-1')],
  ['vocabulary', 'a connector type the pack does not declare', (p) => (p.vocabulary.connectors = p.vocabulary.connectors.filter((t) => t !== 'pinTip'))],
  ['connector-bounds', 'a connector outside its part', (p) => (p.parts.sidePanel.connectors[0].position[0] = 0.5)],
  ['assembled-manifest', 'a spare built into the item', (p) => p.assembled.push({ ...structuredClone(posed(p, 'dowel-1')), id: 'dowel-15' })],
  ['fastener-seats', 'a shelf pin 2 cm off its hole', (p) => nudge(posed(p, 'shelfPin-1'), 2, 0.02)],
  ['mate-coincidence', 'a dowel 1 mm off its seat', (p) => nudge(posed(p, 'dowel-1'), 2, 0.001)],
  ['hole-once', 'two shelf pins in one hole', (p) => Object.assign(posed(p, 'shelfPin-2'), structuredClone({ position: posed(p, 'shelfPin-1').position, rotation: posed(p, 'shelfPin-1').rotation }))],
  ['cam-capture', 'a cam with no bolt to catch', (p) => (p.assembled = p.assembled.filter((a) => a.id !== 'camLockBolt-1'))],
  ['fitting-through', 'side panels too shallow for the back fittings to reach', (p) => (p.parts.sidePanel.box[2] = 0.26)],
  ['step-coverage', 'a step missing a joint', (p) => step(p, 1).fasten.pop()],
  ['step-order', 'the back panel brought in after its fittings', (p) => {
    delete step(p, 8).parts;
    step(p, 12).parts!.push('backPanel-1');
  }],
  ['counts', 'a spare counted in a step', (p) => (step(p, 1).fasten[0][0] = 'dowel-15/dowelEnd-1')],
  ['packing', 'two parts packed through each other', (p) => (p.packing.placements[1].position = [...p.packing.placements[0].position] as Vec3)],
];

describe('checkPack on JOHNNY', () => {
  it('passes with zero errors', () => {
    expect(checkPack(JOHNNY)).toEqual([]);
  });

  it.each(MUTATIONS)('[%s] rejects %s', (rule, _, mutate) => {
    const pack = copy();
    mutate(pack);
    const errors = checkPack(pack);
    expect(errors.map((e) => e.rule)).toContain(rule);
    for (const e of errors) expect(RULES).toContain(e.rule);
  });

  it('[packing] points at the real placement, even after one with an unknown id', () => {
    const pack = copy();
    pack.packing.placements[3].id = 'dowel-99';
    pack.packing.placements[10].position = [...pack.packing.placements[9].position] as Vec3;
    const overlaps = checkPack(pack).filter((e) => e.rule === 'packing' && /passes through/.test(e.message));
    expect(overlaps.map((e) => e.path)).toEqual(['packing.placements[10]']);
  });

  it('[assets] rejects a mesh that is not beside the pack', () => {
    const pack = copy();
    pack.parts.sidePanel.mesh = 'assets/side.glb';
    expect(checkPack(pack, { assetExists: () => false }).map((e) => e.rule)).toEqual(['assets']);
    expect(checkPack(pack, { assetExists: (path) => path === 'assets/side.glb' })).toEqual([]);
  });

  it('seeds every rule with a mutation', () => {
    expect(new Set([...MUTATIONS.map(([rule]) => rule), 'assets'])).toEqual(new Set(RULES));
  });
});

describe('the validator CLI', () => {
  const cli = fileURLToPath(new URL('../tools/validate/index.ts', import.meta.url));
  const item = fileURLToPath(new URL('../items/johnny', import.meta.url));

  it('passes items/johnny', () => {
    expect(execFileSync(process.execPath, ['--import', 'tsx', cli, item], { encoding: 'utf8' })).toMatch(/^ok /);
  });

  it('reports a path that does not exist and still checks the targets after it', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', cli, `${item}-typo`, item], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^FAIL .*johnny-typo/m);
    expect(run.stderr).toMatch(/\[json\]/);
    expect(run.stderr).not.toMatch(/\n\s+at /);
    expect(run.stdout).toMatch(/^ok .*items\/johnny\/flatpack\.json$/m);
  });
});
