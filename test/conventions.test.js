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
    'src/game/pickMath.js',
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
    'src/game/pickMath.js',
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

describe('hit proxies (1.4.1)', () => {
  const router = read('src/scene/gestureRouter.js');
  const proxy = router.slice(router.indexOf('function addHitProxy('));

  it('are invisible and shadowless', () => {
    expect(proxy).toMatch(/proxy\.visible = false;/);
    expect(proxy).toMatch(/proxy\.castShadow = false;/);
    expect(proxy).toMatch(/proxy\.receiveShadow = false;/);
  });

  it('are never registered with physics', () => {
    expect(proxy).not.toMatch(/physics\./);
    expect(read('src/main.js')).not.toMatch(/register\([^)]*proxy/i);
  });

  it('leave the pick decision to the pure preference rule', () => {
    expect(router).toMatch(/preferHit\(/);
    expect(router).toMatch(/from '\.\.\/game\/pickMath\.js'/);
  });
});

describe('seat assist and flash (1.4.1)', () => {
  const router = read('src/scene/gestureRouter.js');
  const assist = router.slice(router.indexOf('function assist('), router.indexOf('}', router.indexOf('function assist(')));

  it('pulls only while a seat is on offer — never in free space', () => {
    expect(assist).toMatch(/if \(!drag\?\.snapped \|\| !drag\.held\) return;/);
    expect(assist).toMatch(/easeToward\([^)]*SNAP\.assistStrength, delta\)/);
  });

  it('plays no audio anywhere (dropped for 0.0.1)', () => {
    for (const path of ['src/main.js', 'src/scene/gestureRouter.js', 'src/scene/sprue.js', 'src/game/partMesh.js']) {
      expect(read(path)).not.toMatch(/\bAudio(Context|Listener)?\b|PositionalAudio|\.play\(/);
    }
  });
});

describe('Shift-lift never skews a crank or a pull (1.4.1 review)', () => {
  const router = read('src/scene/gestureRouter.js');
  const moveDrag = router.slice(router.indexOf('function moveDrag('), router.indexOf('function apply('));

  it('cranks and pulls on the real pointer, not the lift-adjusted one', () => {
    expect(moveDrag).toMatch(/crankTo\(event\)/);
    expect(moveDrag).toMatch(/pullTo\(event, at\)/);
    expect(moveDrag).not.toMatch(/crankTo\(at\)|pullTo\(at\)/);
  });
});

describe('drop guide (1.4.1, Ben)', () => {
  const router = read('src/scene/gestureRouter.js');

  it('renders only — where it lands and which hole lights are the router raycast and decals.js', () => {
    const guide = read('src/scene/dropGuide.js');
    const imports = guide.match(/^import .*$/gm).join('\n');
    expect(imports).not.toMatch(/physics|\/game\//);
    expect(guide).not.toMatch(/\.intersectObjects?\(|physics\./);
    expect(router).toMatch(/socketUnder\(to, freeSocketsFor\(part, host\), DROP\.holeReach\)/);
  });

  it('lights only empty holes that take the dragged part', () => {
    const free = router.slice(router.indexOf('function freeSocketsFor('), router.indexOf('function glow('));
    expect(free).toMatch(/areCompatible\(end, c\.type\)/);
    expect(free).toMatch(/!isTaken\(c\)/);
  });

  it('goes away when the drag ends, however it ends', () => {
    const stop = router.slice(router.indexOf('function stopDrag()'), router.indexOf('}', router.indexOf('function stopDrag()')));
    expect(stop).toMatch(/dropGuide\?\.hide\(\)/);
  });
});
