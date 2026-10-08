import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createBooklet } from '../src/game/bookletModel.js';
import { ASSEMBLED, MANIFEST, MANUAL, PACKING, PART_TYPES, resolveConnector, SPARES } from '../src/game/item.js';

// 1.7 acceptance, headless: the validator gates what CI says it gates, the pack keeps the
// connector order the engine indexes by, spares stay out of the build but in the box, and
// nothing of the retired data modules survives. Gameplay parity on a phone is manual
// (Test Plan.md).

const root = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const cli = fileURLToPath(new URL('tools/validate/index.ts', root));
const JOHNNY = JSON.parse(read('items/johnny/flatpack.json'));

describe('the validator CLI on broken packs', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'skruv-flatpack-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const packAt = (name, mutate) => {
    const pack = structuredClone(JOHNNY);
    mutate(pack);
    const folder = join(scratch, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'flatpack.json'), JSON.stringify(pack));
    return folder;
  };
  const run = (...targets) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...targets], { encoding: 'utf8' });

  it('fails a schema-invalid pack on the schema layer, before any geometry', () => {
    const result = run(packAt('format2', (p) => (p.format = 2)));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[schema\]/);
    expect(result.stderr).not.toMatch(/\[mate-coincidence\]/);
  });

  it('fails a dowel 1 mm off its seat on the coincidence rule', () => {
    const result = run(packAt('offset', (p) => (p.assembled.find((a) => a.id === 'dowel-1').position[2] += 0.001)));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[mate-coincidence\] .*dowel-1/);
  });

  it('looks a referenced mesh up beside the pack on disk', () => {
    const folder = packAt('mesh', (p) => (p.parts.dowel.mesh = 'assets/dowel.glb'));
    expect(run(folder).stderr).toMatch(/\[assets\] parts\.dowel\.mesh: assets\/dowel\.glb is missing/);
    mkdirSync(join(folder, 'assets'));
    writeFileSync(join(folder, 'assets', 'dowel.glb'), '');
    expect(run(folder).status).toBe(0);
  });

  it('exits 2 with usage when given nothing to check', () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/);
  });
});

describe('CI runs the validator', () => {
  const ci = read('.github/workflows/ci.yml');
  const deploy = read('.github/workflows/deploy.yml');
  const order = (workflow, ...steps) => steps.map((step) => workflow.indexOf(step));

  it('on every pull request, before the tests and the build', () => {
    expect(ci).toMatch(/on:\s*\n\s*pull_request:/);
    const [install, validate, tests, build] = order(ci, 'npm ci --prefix tools/validate', 'npx tsx tools/validate/index.ts items/johnny', 'npx vitest run', 'npm run build');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(validate);
    expect(validate).toBeLessThan(tests);
    expect(tests).toBeLessThan(build);
  });

  it('before every deploy, ahead of the tests', () => {
    const [install, validate, tests] = order(deploy, 'npm ci --prefix tools/validate', 'npx tsx tools/validate/index.ts items/johnny', 'npx vitest run');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(validate);
    expect(validate).toBeLessThan(tests);
  });
});

describe('connector names map onto the engine\'s indices', () => {
  it('names each connector <type>-<n>, n counting that type in index order', () => {
    for (const [type, part] of Object.entries(PART_TYPES)) {
      const seen = new Map();
      part.connectors.forEach((c, index) => {
        const n = (seen.get(c.type) ?? 0) + 1;
        seen.set(c.type, n);
        expect(c.id, `${type}[${index}]`).toBe(`${c.type}-${n}`);
        expect(resolveConnector(`${MANIFEST.find((p) => p.type === type)?.id ?? `${type}-1`}/${c.id}`).connector).toBe(index);
      });
    }
  });

  // The side's plinth holes were appended last (1.5) so every earlier index — decals,
  // telemetry, pinned tests — stayed put.
  it('keeps the side panel\'s plinth holes at indices 14 and 15', () => {
    expect(resolveConnector('sidePanel-1/dowelHole-7').connector).toBe(14);
    expect(resolveConnector('sidePanel-1/dowelHole-8').connector).toBe(15);
    expect(PART_TYPES.sidePanel.connectors).toHaveLength(16);
  });
});

describe('spares', () => {
  const stepRefs = MANUAL.pages.flatMap((p) => [...(p.fasten ?? []), ...(p.turn ?? [])].flat());

  it('are packed in the box, never built in, never on a step page', () => {
    const packed = new Set(PACKING.placements.map((p) => p.id));
    for (const id of SPARES) {
      expect(packed.has(id), id).toBe(true);
      expect(ASSEMBLED.parts.some((p) => p.id === id), id).toBe(false);
      expect(stepRefs.some((ref) => ref.startsWith(`${id}/`)), id).toBe(false);
    }
  });

  it('are left out of the step bubbles but listed in the inventory, as before', () => {
    const booklet = createBooklet(MANUAL.pages, { layout: ASSEMBLED, manifest: MANIFEST, partTypes: PART_TYPES, resolve: resolveConnector });
    const bubbles = {};
    for (const page of booklet.filter((p) => p.kind === 'step')) for (const { type, count } of page.hardware) bubbles[type] = (bubbles[type] ?? 0) + count;
    expect(bubbles).toMatchObject({ dowel: 14, camLock: 8 });
    const inventory = Object.fromEntries(booklet.find((p) => p.kind === 'inventory').items.map((i) => [i.type, i.count]));
    expect(inventory).toMatchObject({ dowel: 16, camLock: 10 });
  });
});

describe('no survivors of the retired data modules', () => {
  it.each(['src/game/catalog.ts', 'src/game/assembledLayout.ts', 'src/game/buildSteps.ts', 'src/game/packedLayout.ts', 'scripts/extractJohnny.js'])(
    '%s is gone',
    (path) => {
      expect(existsSync(new URL(path, root))).toBe(false);
    },
  );

  it('keeps the brand and the box\'s inside out of the constants: they are the pack\'s', async () => {
    const constants = await import('../src/constants.js');
    expect(constants).not.toHaveProperty('BRAND');
    expect(constants).not.toHaveProperty('PACK');
    // Where it stands, and (1.7.1) how heavy and grippy the draggable box feels — tunables, not pack data.
    expect(Object.keys(constants.BOX).sort()).toEqual(['friction', 'mass', 'position', 'yaw']);
  });
});
