import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// 1.8 acceptance, headless: the tree is strict TypeScript with no way back to unchecked JS,
// the type and lint gates run in CI and deploy, the lint config is the recommended sets and
// bites, and the pre-commit hook is lint-staged only. The device spot-check is manual
// (Test Plan.md).

const root = new URL('..', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const filesUnder = (dir: string) =>
  (readdirSync(fileURLToPath(new URL(dir, root)), { recursive: true }) as string[]).filter((path) => !path.split('/').includes('node_modules'));

describe('the tree is TypeScript', () => {
  it.each(['src', 'test', 'tools/validate'])('%s holds no .js file', (dir) => {
    expect(filesUnder(dir).filter((path) => path.endsWith('.js'))).toEqual([]);
  });

  it('checks strictly, resolves like Vite and emits nothing — and nothing else loosens it', () => {
    const { config } = ts.parseConfigFileTextToJson('tsconfig.json', read('tsconfig.json'));
    expect(Object.keys(config.compilerOptions).sort()).toEqual(['lib', 'moduleResolution', 'noEmit', 'strict', 'target']);
    expect(config.compilerOptions).toMatchObject({ strict: true, moduleResolution: 'bundler', noEmit: true });
    expect(config.include).toEqual(['src', 'test', 'tools/validate', 'vite.config.ts']);
  });
});

describe('CI and deploy run the type and lint gates', () => {
  const steps = (workflow: string) => [...read(`.github/workflows/${workflow}`).matchAll(/^\s+- run: (.+)$/gm)].map(([, step]) => step);

  it.each(['ci.yml', 'deploy.yml'])('%s typechecks and lints after installing, before the validator and the tests', (workflow) => {
    const run = steps(workflow);
    const at = (step: string) => run.indexOf(step);
    expect(at('npm run typecheck')).toBeGreaterThan(at('npm ci --prefix tools/validate'));
    expect(at('npm run lint')).toBeGreaterThan(at('npm ci --prefix tools/validate'));
    expect(at('npm run typecheck')).toBeLessThan(at('npx tsx tools/validate/index.ts items/johnny'));
    expect(at('npm run lint')).toBeLessThan(at('npx vitest run'));
  });

  it('names the gates as package scripts', () => {
    const { scripts } = JSON.parse(read('package.json'));
    expect(scripts).toMatchObject({ typecheck: 'tsc --noEmit', lint: 'eslint .', prepare: 'husky' });
  });
});

describe('lint', () => {
  const eslint = new ESLint({ cwd: fileURLToPath(root) });

  it('is the recommended sets only: the config switches rules off, never on', () => {
    expect(read('eslint.config.js')).not.toMatch(/['"](error|warn)['"]|\b[12]\s*[,\]}]/);
    expect(read('package.json')).not.toMatch(/prettier/i);
  });

  it('catches an explicit any in game code', async () => {
    const [result] = await eslint.lintText('export const loose: any = 1;\n', { filePath: 'src/probe.ts' });
    expect(result.messages.map((m) => m.ruleId)).toEqual(['@typescript-eslint/no-explicit-any']);
  });

  it('passes clean game code', async () => {
    const [result] = await eslint.lintText('export const tight: number = 1;\n', { filePath: 'src/probe.ts' });
    expect(result.messages).toEqual([]);
  });

  it('is never silenced inline', () => {
    const sources = [...filesUnder('src').map((p) => `src/${p}`), ...filesUnder('test').map((p) => `test/${p}`), ...filesUnder('tools/validate').map((p) => `tools/validate/${p}`)];
    // This file names the markers in order to look for them.
    for (const path of sources.filter((p) => p.endsWith('.ts') && p !== 'test/typescriptMigration.test.ts')) {
      expect(read(path), path).not.toMatch(/eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck/);
    }
  });
});

describe('the pre-commit hook', () => {
  it('runs lint-staged, and lint-staged runs only eslint --fix on staged TypeScript', () => {
    expect(read('.husky/pre-commit').trim()).toBe('npx lint-staged');
    expect(JSON.parse(read('package.json'))['lint-staged']).toEqual({ '*.ts': 'eslint --fix' });
  });
});

describe('CLAUDE.md', () => {
  const guide = read('CLAUDE.md');

  it('names the TypeScript commands and paths, never the retired .js ones', () => {
    expect(guide).toMatch(/\| Typecheck \| `npm run typecheck`/);
    expect(guide).toMatch(/\| Lint \| `npm run lint`/);
    expect(guide).toMatch(/npx tsx tools\/validate\/index\.ts items\/johnny/);
    expect(guide).not.toMatch(/node tools\/validate\/index\.js|(src|test)\/[\w/]+\.js\b|vite\.config\.js|Lint \| none yet/);
  });
});
