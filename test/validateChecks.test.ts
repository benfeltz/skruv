import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkPack, RULES } from '../tools/validate/lib/checks.js';
import type { Rule } from '../tools/validate/lib/checks.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import type { Quat, Vec3, Pose } from '../tools/validate/lib/geometry.js';
import { CONTRACT } from '../tools/validate/lib/vocabulary.js';
import type { ConnectorSpec, FlatpackFile, PageFields, StepPage } from '../tools/validate/lib/pack.js';

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
  ['pilot-hole', 'a pilot hole no screw tip reaches', (p) => {
    p.vocabulary.connectors.push('screwPilot');
    p.parts.sidePanel.connectors.push({ id: 'screwPilot-1', type: 'screwPilot', position: [0.008, 0, 0], axis: [1, 0, 0] });
  }],
  ['slides', 'an open pose on a part no rail runs in', (p) => (posed(p, 'sidePanel-1').open = { position: [...posed(p, 'sidePanel-1').position] as Vec3, rotation: [...posed(p, 'sidePanel-1').rotation] as Quat })],
  ['step-coverage', 'a step missing a joint', (p) => step(p, 1).fasten.pop()],
  ['step-order', 'the back panel brought in after its fittings', (p) => {
    delete step(p, 8).parts;
    step(p, 12).parts!.push('backPanel-1');
  }],
  ['assemblies', 'a page building an assembly nobody installs', (p) => (step(p, 1).assembly = 'shelf')],
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

  // JOHNNY with its back fittings made wood screws: each screw sunk its own depth through the
  // back panel's screw hole, its thread on into the side panel behind.
  const screwed = () => {
    const pack = copy();
    const sink = CONTRACT.sinkDepth.screw! - CONTRACT.sinkDepth.fitting!;
    pack.vocabulary.connectors = pack.vocabulary.connectors.map((t) => (t === 'backFittingTip' ? 'screwThread' : t === 'backFittingHole' ? 'screwHole' : t));
    pack.vocabulary.fasteners = pack.vocabulary.fasteners.map((k) => (k === 'fitting' ? 'screw' : k));
    pack.parts.backFitting.connectors[0].type = 'screwThread';
    for (const hole of pack.parts.backPanel.connectors) if (hole.type === 'backFittingHole') hole.type = 'screwHole';
    for (const screw of pack.assembled.filter((a) => a.id.startsWith('backFitting-'))) {
      const deeper = rotateVector(screw.rotation, pack.parts.backFitting.connectors[0].axis);
      screw.position = screw.position.map((v, i) => v + deeper[i] * sink) as Vec3;
    }
    return pack;
  };

  it('[fitting-through] holds a screw to the panel behind its hole, and rejects one passing into none', () => {
    expect(checkPack(screwed()).map((e) => e.rule)).not.toContain('fitting-through');
    const pack = screwed();
    pack.parts.sidePanel.box[2] = 0.23;
    expect(checkPack(pack).filter((e) => e.rule === 'fitting-through').map((e) => e.message)).toContain('backFitting-1 passes into no panel');
  });

  it('[assemblies] holds a tagged page to its own parts, an install after its pages, and an install to a built assembly', () => {
    const messages = (mutate: (p: FlatpackFile) => unknown) => {
      const pack = copy();
      mutate(pack);
      return checkPack(pack).filter((e) => e.rule === 'assemblies').map((e) => e.message);
    };
    const page = (p: FlatpackFile, number: number) => (p.manual.pages as PageFields[]).find((q) => q.number === number) as StepPage;
    // Step 2 tagged on its own: the assembly is never installed.
    expect(messages((p) => (step(p, 2).assembly = 'a'))).toContain('a is installed 0 times, not 1');
    // Step 1 tagged: a later untagged page before the install still fastens into its parts.
    expect(messages((p) => {
      step(p, 1).assembly = 'a';
      page(p, 12).install = 'a';
    }).some((m) => /belongs to a, installed on page 12/.test(m))).toBe(true);
    // A tagged page that fastens into a part it did not bring in.
    expect(messages((p) => {
      delete page(p, 1).parts;
      page(p, 1).assembly = 'a';
      page(p, 12).install = 'a';
    }).some((m) => /is not part of a/.test(m))).toBe(true);
    expect(messages((p) => {
      step(p, 12).assembly = 'a';
      page(p, 3).install = 'a';
    })).toContain('a is installed on page 3 before its last page 12');
    expect(messages((p) => (step(p, 12).install = 'ghost'))).toContain('no page builds ghost');
  });

  it('seeds every rule with a mutation', () => {
    expect(new Set([...MUTATIONS.map(([rule]) => rule), 'assets'])).toEqual(new Set(RULES));
  });
});

describe('slides on a plate on two rails', () => {
  const IDENTITY: Quat = [0, 0, 0, 1];
  const TURNED: Quat = [0, 1, 0, 0];
  const connector = (id: string, type: ConnectorSpec['type'], position: Vec3, axis: Vec3): ConnectorSpec => ({ id, type, position, axis });
  // A plate with a groove on each x face; a runner against each face, its rail end seated in the groove.
  // A second plate stands on the first on a dowel, to be joined to it.
  function rails(): FlatpackFile {
    return {
      format: 1,
      identity: { product: 'TEST', maker: 'SKRUV', documentCode: 'SK-0', category: 'Drawer', variants: [{ name: 'White', color: 'partPanel', article: '999.000.01' }] },
      vocabulary: { connectors: ['railGroove', 'railEnd', 'dowelHole', 'dowelEnd'], fasteners: ['slide', 'dowel'] },
      parts: {
        plate: {
          partNumber: '10000', box: [0.02, 0.1, 0.3], mass: 1, color: 'partPanel', quantity: 2,
          connectors: [
            connector('railGroove-1', 'railGroove', [-0.01, 0, 0.05], [-1, 0, 0]),
            connector('railGroove-2', 'railGroove', [0.01, 0, -0.05], [1, 0, 0]),
            connector('dowelHole-1', 'dowelHole', [0, 0.05, 0.1], [0, 1, 0]),
            connector('dowelHole-2', 'dowelHole', [0, -0.05, 0.1], [0, -1, 0]),
          ],
        },
        runner: { partNumber: '10001', box: [0.012, 0.02, 0.3], mass: 0.1, color: 'partPanel', quantity: 2, connectors: [connector('railEnd-1', 'railEnd', [0.006, 0, 0.05], [1, 0, 0])] },
        dowel: {
          partNumber: '10002', box: [0.008, 0.03, 0.008], mass: 0.01, color: 'partDowel', quantity: 1,
          connectors: [connector('dowelEnd-1', 'dowelEnd', [0, -0.015, 0], [0, -1, 0]), connector('dowelEnd-2', 'dowelEnd', [0, 0.015, 0], [0, 1, 0])],
        },
      },
      assembled: [
        { id: 'plate-1', role: 'drawerSide', position: [0.016, 0, 0], rotation: IDENTITY, open: { position: [0.016, 0, 0.1], rotation: IDENTITY } },
        { id: 'runner-1', role: 'runner', position: [0, 0, 0], rotation: IDENTITY },
        { id: 'runner-2', role: 'runner', position: [0.032, 0, 0], rotation: TURNED },
      ],
      manual: { pages: [{ kind: 'cover' }] },
      packing: { boxInner: [0.3, 0.1, 0.3], wall: 0.01, floor: 0.01, lid: { thickness: 0.008, partNumber: '10003', mass: 0.2, color: 'cardboard' }, placements: [] },
    };
  }
  const messages = (mutate: (p: FlatpackFile) => unknown) => {
    const pack = rails();
    mutate(pack);
    return checkPack(pack).filter((e) => e.rule === 'slides').map((e) => e.message);
  };
  const plate = (p: FlatpackFile) => posed(p, 'plate-1');

  it('passes a plate that opens along its rails', () => {
    expect(messages(() => undefined)).toEqual([]);
  });

  it('wants an open pose on a part a rail runs in', () => {
    expect(messages((p) => delete plate(p).open)).toContain('plate-1 runs on runner-1 but has no open pose');
  });

  it('wants the open pose to be a pure translation', () => {
    expect(messages((p) => (plate(p).open!.rotation = TURNED))).toContain('plate-1 opens with a turn; a slide only translates');
  });

  it('wants a travel, across the groove', () => {
    expect(messages((p) => (plate(p).open!.position = [...plate(p).position] as Vec3))).toContain('plate-1 opens to where it is closed');
    expect(messages((p) => (plate(p).open!.position = [0.116, 0, 0]))).toContain('plate-1 opens along its groove, not across it');
  });

  it('keeps the groove on the runner when open', () => {
    expect(messages((p) => (plate(p).open!.position = [0.016, 0, 0.5]))).toContain('plate-1 leaves runner-1 when open');
  });

  it('makes parts joined by a dowel open alike', () => {
    const joined = (open: Vec3) => (p: FlatpackFile) => {
      p.assembled.push(
        { id: 'plate-2', role: 'drawerSide', position: [0.016, 0.1, 0], rotation: IDENTITY, open: { position: open, rotation: IDENTITY } },
        { id: 'dowel-1', role: 'hardware', position: [0.016, 0.05, 0.1], rotation: IDENTITY },
      );
    };
    expect(messages(joined([0.016, 0.1, 0.1])).filter((m) => m.includes('differently'))).toEqual([]);
    expect(messages(joined([0.016, 0.1, 0.05]))).toContain('plate-2 opens differently from plate-1, which it is joined to');
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
