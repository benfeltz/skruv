import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('GitHub Pages deploy', () => {
  it("serves from the /skruv/ project path so assets don't 404", () => {
    expect(viteConfig.base).toBe('/skruv/');
  });

  it('deploys dist on pushes to main', () => {
    const workflow = read('.github/workflows/deploy.yml');
    expect(workflow).toMatch(/branches:\s*\[main\]/);
    expect(workflow).toMatch(/path:\s*dist/);
  });
});

describe('pure-logic modules', () => {
  // Kept headless so Vitest covers them — see CLAUDE.md.
  const pureModules = [
    'src/scene/clamp.js',
    'src/scene/cameraLimits.js',
    'src/scene/loop.js',
    'src/physics/stepping.js',
    'src/game/catalog.js',
    'src/game/devLayout.js',
    'src/game/gestureState.js',
    'src/game/dragMath.js',
    'src/game/snapMath.js',
    'src/game/fasteners.js',
    'src/game/assembly.js',
    'src/game/crankMath.js',
    'src/game/decals.js',
  ];

  it.each(pureModules)('%s imports neither Three nor Rapier', (path) => {
    expect(read(path)).not.toMatch(/from\s+['"](three|@dimforge\/rapier)/);
  });

  it.each([
    'src/scene/clamp.js',
    'src/scene/cameraLimits.js',
    'src/physics/stepping.js',
    'src/game/catalog.js',
    'src/game/devLayout.js',
    'src/game/gestureState.js',
    'src/game/dragMath.js',
    'src/game/snapMath.js',
    'src/game/fasteners.js',
    'src/game/assembly.js',
    'src/game/crankMath.js',
    'src/game/decals.js',
  ])(
    '%s touches no DOM globals',
    (path) => {
      expect(read(path)).not.toMatch(/\b(window|document|matchMedia|requestAnimationFrame)\b/);
    },
  );
});

describe('CLAUDE.md', () => {
  it('names the dev, build, test and single-test commands', () => {
    const doc = read('CLAUDE.md');
    for (const command of ['npm run dev', 'npm run build', 'npx vitest run', 'npx vitest run <path>']) {
      expect(doc).toContain(command);
    }
  });
});
