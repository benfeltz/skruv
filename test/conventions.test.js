import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_WS } from '../src/constants.js';
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
    'src/game/packedLayout.js',
    'src/game/gestureState.js',
    'src/game/dragMath.js',
    'src/game/snapMath.js',
    'src/game/fasteners.js',
    'src/game/assembly.js',
    'src/game/crankMath.js',
    'src/game/decals.js',
    'src/game/pickMath.js',
    'src/game/assembledLayout.js',
    'src/game/buildSteps.js',
    'src/game/events.js',
    'src/game/sessionBuffer.js',
    'src/game/tunables.js',
  ];

  it.each(pureModules)('%s imports neither Three nor Rapier', (path) => {
    expect(read(path)).not.toMatch(/from\s+['"](three|@dimforge\/rapier)/);
  });

  it.each([
    'src/scene/clamp.js',
    'src/scene/cameraLimits.js',
    'src/physics/stepping.js',
    'src/game/catalog.js',
    'src/game/packedLayout.js',
    'src/game/gestureState.js',
    'src/game/dragMath.js',
    'src/game/snapMath.js',
    'src/game/fasteners.js',
    'src/game/assembly.js',
    'src/game/crankMath.js',
    'src/game/decals.js',
    'src/game/pickMath.js',
    'src/game/assembledLayout.js',
    'src/game/buildSteps.js',
    'src/game/events.js',
    'src/game/sessionBuffer.js',
    'src/game/tunables.js',
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

describe('seat flash hands back to the drop glow (1.4.1 review)', () => {
  const router = read('src/scene/gestureRouter.js');
  const fade = router.slice(router.indexOf('function fadeFlashes('), router.indexOf('// --- pull'));

  it('restores the glow, not dark, when a flash ends on the hole still lit', () => {
    expect(fade).toMatch(/if \(decal === glowing\) \{\s*decal\.material\.emissiveIntensity = DROP\.glowIntensity;/);
  });
});

describe('the wall clamp never shrinks the orbit (1.4.1 review)', () => {
  const controls = read('src/scene/cameraControls.js');
  const update = controls.slice(controls.indexOf('update(deltaSeconds) {'), controls.indexOf('enable() {'));

  it('runs every OrbitControls update — per frame and event-fired — from its unclamped pose, clamping after', () => {
    // OrbitControls calls this.update() inside its wheel/pointer handlers; wrapping the
    // instance method covers those too (wrapping only the per-frame call dropped zoom).
    expect(controls).toMatch(/const orbitUpdate = controls\.update\.bind\(controls\);\s*controls\.update = \(deltaSeconds\) => \{\s*unconfine\(\);[\s\S]*?seatOnFloor\(free\.toArray\(\)[^\n]*\n\s*const changed = orbitUpdate\(deltaSeconds\);\s*confine\(\);/);
    expect(controls).toMatch(/function unconfine\(\) \{\s*camera\.position\.copy\(free\);/);
    expect(controls).toMatch(/free\.copy\(camera\.position\);[\s\S]*clampCamera\(free\.toArray\(\)/);
    expect(update).not.toMatch(/unconfine\(\)/);
  });
});

describe('the deployed bundle carries no dev stream (1.6)', () => {
  // A real production build into a scratch dir, then asserted on byte for byte: the plain
  // URL on Pages must never open a socket or carry dev code.
  const root = fileURLToPath(new URL('..', import.meta.url));
  let outDir;
  let files;
  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'skruv-dist-'));
    // As CI builds it: vitest's NODE_ENV=test would build with import.meta.env.DEV true.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && !key.startsWith('VITEST')));
    execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, env });
    files = readdirSync(outDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return { path, text: readFileSync(path, 'utf8') };
      });
  }, 120_000);
  afterAll(() => outDir && rmSync(outDir, { recursive: true, force: true }));

  it.each([
    ['the dev socket path', DEV_WS.path],
    ['the dev client', 'connectDevStream'],
    ['the dev client module', 'wsClient'],
    ['a WebSocket', 'WebSocket'],
    ['the dev console trail', '[skruv]'],
  ])('contains no %s', (_, marker) => {
    expect(files.length).toBeGreaterThan(0);
    for (const { path, text } of files) expect(text.includes(marker), path).toBe(false);
  });

  it('keeps the tuning drawer out of the entry chunk — the plain URL never loads it', () => {
    const html = files.find(({ path }) => path.endsWith('index.html')).text;
    const entry = html.match(/src="[^"]*\/(assets\/index-[^"]+\.js)"/)[1];
    const entryText = files.find(({ path }) => path.endsWith(entry)).text;
    expect(entryText).not.toContain('skruv-tune-panel');
    expect(files.some(({ path, text }) => /tunePanel/.test(path) && text.includes('skruv-tune-panel'))).toBe(true);
  });
});

describe('dev stream wiring (1.6)', () => {
  const main = read('src/main.js');

  it('reaches the client only through a DEV-guarded dynamic import', () => {
    expect(main.match(/dev\/wsClient/g)).toHaveLength(1);
    expect(main).toMatch(/if \(import\.meta\.env\.DEV\) \{\s*import\('\.\/dev\/wsClient\.js'\)/);
    expect(main).not.toMatch(/^import .*dev\//m);
  });

  it('keeps src/dev to the one client file, imported by nothing else', () => {
    const dir = fileURLToPath(new URL('../src/dev', import.meta.url));
    expect(readdirSync(dir)).toEqual(['wsClient.js']);
    const others = readdirSync(fileURLToPath(new URL('../src', import.meta.url)), { recursive: true })
      .filter((path) => path.endsWith('.js') && path !== 'main.js' && !path.startsWith('dev'));
    for (const path of others) expect(read(`src/${path}`), path).not.toMatch(/(import\(|from )['"][^'"]*\/dev\//);
  });

  it('runs the hub on the dev server only', () => {
    const plugin = viteConfig.plugins.flat().find((p) => p?.name === 'skruv-dev-stream');
    expect(plugin.apply).toBe('serve');
  });
});
