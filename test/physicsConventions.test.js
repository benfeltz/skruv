import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHYSICS, RENDER } from '../src/constants.js';
import * as constants from '../src/constants.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

function sourceFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : [path];
  });
}

const RAPIER_IMPORT = /from\s+['"]@dimforge\/rapier/;

describe('Rapier boundary', () => {
  it('depends on the compat build, which embeds its WASM and needs no Vite plugin', () => {
    const { dependencies } = JSON.parse(read('package.json'));
    expect(dependencies).toHaveProperty('@dimforge/rapier3d-compat');
    expect(dependencies).not.toHaveProperty('@dimforge/rapier3d');
  });

  it('is imported by src/physics/world.js and nothing else', () => {
    const importers = sourceFiles('src')
      .filter((path) => RAPIER_IMPORT.test(read(path)))
      .map((path) => relative(root, join(root, path)));
    expect(importers).toEqual(['src/physics/world.js']);
  });

  it('imports only the compat package', () => {
    expect(read('src/physics/world.js')).toMatch(/from\s+['"]@dimforge\/rapier3d-compat['"]/);
  });
});

describe('physics timing', () => {
  // A frame clamped to RENDER.maxFrameDelta must be fully simulated, or a slow phone
  // would run physics in slow motion rather than catching up.
  it('lets the step cap cover the longest clamped frame', () => {
    expect(PHYSICS.maxStepsPerFrame * PHYSICS.timestep).toBeGreaterThanOrEqual(
      RENDER.maxFrameDelta - 1e-9,
    );
  });

  it('keeps parts from bouncing', () => {
    expect(PHYSICS.restitution).toBe(0);
  });
});

describe('placeholders and headers', () => {
  it('retires the test box once parts spawn', () => {
    expect(constants).not.toHaveProperty('TEST_BOX');
    expect(read('src/scene/room.js')).not.toMatch(/createTestBox/);
    expect(read('src/main.js')).not.toMatch(/createTestBox/);
  });

  it('marks devLayout.js as temporary until the unbox flow', () => {
    expect(read('src/game/devLayout.js').split('\n')[0]).toMatch(/TEMPORARY/);
    expect(read('src/game/devLayout.js')).toMatch(/PR 5/);
  });

  it('documents catalog.js as data, not tunables, and keeps mating out', () => {
    const catalog = read('src/game/catalog.js');
    expect(catalog).toMatch(/as DATA/);
    expect(catalog).toMatch(/not behaviour tunables/);
    expect(catalog).not.toMatch(/\bMATING\b|\bmates\s*:/);
  });
});
