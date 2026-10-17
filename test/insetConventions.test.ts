import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.10.0.1's regression risks that live in wiring (src/main.ts, src/scene/itemWorld.ts) and so
// have no module to call in a test: checked at the source, as test/gameFlowConventions.test.ts does.
// The look of the inset and the frame rate with it are device checks.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src/main.ts');
const world = read('src/scene/itemWorld.ts');

describe('the room layer (regression risk)', () => {
  it('lets the main camera see the room’s layer, so the room renders as it did', () => {
    expect(main).toMatch(/camera\.layers\.enable\(LAYER\.room\)/);
  });

  it('lets it see the gizmo’s layer too, or the rings would vanish from the main view', () => {
    expect(main).toMatch(/camera\.layers\.enable\(LAYER\.gizmo\)/);
  });
});

describe('shadow maps once per frame (regression risk)', () => {
  const loop = main.slice(main.indexOf('createLoop('), main.indexOf('}).start()'));

  it('stops the renderer redrawing them on every render call', () => {
    expect(main).toMatch(/renderer\.shadowMap\.autoUpdate = false/);
  });

  it('asks for them once, just before the main render, and only in a frame that renders', () => {
    expect(loop.match(/shadowMap\.needsUpdate = true/g)).toHaveLength(1);
    expect(loop).toMatch(/if \(render\) \{\s+renderer\.shadowMap\.needsUpdate = true;\s+renderer\.render\(scene, camera\);/);
  });
});

describe('one extra render per frame, skipped with the main one (regression risk)', () => {
  const loop = main.slice(main.indexOf('createLoop('), main.indexOf('}).start()'));

  it('draws the inset right after the main render, inside the frame-rate guard’s branch', () => {
    expect(loop).toMatch(/if \(render\) \{[^}]*renderer\.render\(scene, camera\);[^}]*items\.current\?\.render\(renderer, scene\);\s+\}/);
    expect(loop.match(/\.render\(/g)).toHaveLength(2);
  });
});

describe('repack and teardown take the inset with them', () => {
  it('hides the inset on a repack', () => {
    const repack = world.slice(world.indexOf('function repack()'), world.indexOf('function liftablePart()'));
    expect(repack).toMatch(/insetPanel\.reset\(\)/);
  });

  it('disposes the panel with the world and steps it after the router', () => {
    expect(world).toMatch(/undo\.push\(\(\) => insetPanel\.dispose\(\)\)/);
    expect(world).toMatch(/router\.update\(delta\);\s+insetPanel\.update\(\);/);
  });
});
