import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('retires the temporary dev floor layout now the flatpack replaces it (1.5)', () => {
    expect(existsSync(new URL('../src/game/devLayout.js', import.meta.url))).toBe(false);
    expect(read('src/main.js')).not.toMatch(/devLayout|DEV_LAYOUT/);
    expect(read('src/main.js')).toMatch(/createPackedWorldLayout\(\)/);
  });

  // The item is data in its Flatpack (1.7): parts, poses, pages, packing — never a mating
  // table (joints are derived from the poses) and never a script (behaviour is the engine's).
  it('keeps the item as data in its pack, mating and scripting out', () => {
    const pack = read('items/johnny/flatpack.json');
    expect(Object.keys(JSON.parse(pack))).toEqual(['$schema', 'format', 'identity', 'vocabulary', 'parts', 'assembled', 'manual', 'packing', 'tuning']);
    expect(pack).not.toMatch(/"(joints|mates|mating|script|scripts)"\s*:/);
    expect(read('src/game/item.js')).toMatch(/deriveJoints\(pack\)/);
  });
});

describe('stable stacks and supports (1.5)', () => {
  const world = read('src/physics/world.js');

  // Bodies born asleep never get their resting contacts, and a packed stack sank 2–3 cm
  // through the box and room floors once anything touched it.
  it('spawns every body awake, to settle and sleep on its own', () => {
    expect(world).not.toMatch(/setSleeping\(/);
  });

  it('simulates no body lighter than PHYSICS.minBodyMass, keeping catalog masses true', () => {
    expect(PHYSICS.minBodyMass).toBeGreaterThan(0);
    expect(world).toMatch(/\.setMass\(Math\.max\(mass, PHYSICS\.minBodyMass\)\)/);
  });
});
