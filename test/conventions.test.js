import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLORS, DEV_WS } from '../src/constants.js';
import viteConfig from '../vite.config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('GitHub Pages deploy', () => {
  it("serves from the domain root (custom domain skruv.site) so assets don't 404", () => {
    expect(viteConfig.base).toBe('/');
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
    'src/scene/clamp.ts',
    'src/scene/cameraLimits.ts',
    'src/scene/loop.ts',
    'src/physics/stepping.ts',
    'src/game/item.ts',
    'src/game/boxLayout.ts',
    'src/game/gestureState.ts',
    'src/game/dragMath.ts',
    'src/game/snapMath.ts',
    'src/game/fasteners.ts',
    'src/game/assembly.ts',
    'src/game/crankMath.ts',
    'src/game/decals.ts',
    'src/game/pickMath.ts',
    'src/game/bookletModel.ts',
    'src/game/events.ts',
    'src/game/sessionBuffer.ts',
    'src/game/tunables.ts',
    'src/scene/fpsGuard.ts',
  ];

  it.each(pureModules)('%s imports neither Three nor Rapier', (path) => {
    expect(read(path)).not.toMatch(/from\s+['"](three|@dimforge\/rapier)/);
  });

  it.each([
    'src/scene/clamp.ts',
    'src/scene/cameraLimits.ts',
    'src/physics/stepping.ts',
    'src/game/item.ts',
    'src/game/boxLayout.ts',
    'src/game/gestureState.ts',
    'src/game/dragMath.ts',
    'src/game/snapMath.ts',
    'src/game/fasteners.ts',
    'src/game/assembly.ts',
    'src/game/crankMath.ts',
    'src/game/decals.ts',
    'src/game/pickMath.ts',
    'src/game/bookletModel.ts',
    'src/game/events.ts',
    'src/game/sessionBuffer.ts',
    'src/game/tunables.ts',
    'src/scene/fpsGuard.ts',
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
  const router = read('src/scene/gestureRouter.ts');
  const proxy = router.slice(router.indexOf('function addHitProxy('));

  it('are invisible and shadowless', () => {
    expect(proxy).toMatch(/proxy\.visible = false;/);
    expect(proxy).toMatch(/proxy\.castShadow = false;/);
    expect(proxy).toMatch(/proxy\.receiveShadow = false;/);
  });

  it('are never registered with physics', () => {
    expect(proxy).not.toMatch(/physics\./);
    expect(read('src/main.ts')).not.toMatch(/register\([^)]*proxy/i);
  });

  it('leave the pick decision to the pure preference rule', () => {
    expect(router).toMatch(/preferHit\(/);
    expect(router).toMatch(/from '\.\.\/game\/pickMath\.js'/);
  });
});

describe('seat assist and flash (1.4.1)', () => {
  const router = read('src/scene/gestureRouter.ts');
  const assist = router.slice(router.indexOf('function assist('), router.indexOf('}', router.indexOf('function assist(')));

  it('pulls only while a seat is on offer — never in free space', () => {
    expect(assist).toMatch(/if \(!drag\?\.snapped \|\| !drag\.held\) return;/);
    expect(assist).toMatch(/easeToward\([^)]*SNAP\.assistStrength, delta\)/);
  });

  it('plays no audio anywhere (dropped for 0.0.1)', () => {
    for (const path of ['src/main.ts', 'src/scene/gestureRouter.ts', 'src/scene/sprue.ts', 'src/game/partMesh.ts']) {
      expect(read(path)).not.toMatch(/\bAudio(Context|Listener)?\b|PositionalAudio|\.play\(/);
    }
  });
});

describe('Shift-lift never skews a crank or a pull (1.4.1 review)', () => {
  const router = read('src/scene/gestureRouter.ts');
  const moveDrag = router.slice(router.indexOf('function moveDrag('), router.indexOf('function apply('));

  it('cranks and pulls on the real pointer, not the lift-adjusted one', () => {
    expect(moveDrag).toMatch(/crankTo\(event\)/);
    expect(moveDrag).toMatch(/pullTo\(event, at\)/);
    expect(moveDrag).not.toMatch(/crankTo\(at\)|pullTo\(at\)/);
  });
});

describe('drop guide (1.4.1, Ben)', () => {
  const router = read('src/scene/gestureRouter.ts');

  it('renders only — where it lands and which hole lights are the router raycast and decals.js', () => {
    const guide = read('src/scene/dropGuide.ts');
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
  const router = read('src/scene/gestureRouter.ts');
  const fade = router.slice(router.indexOf('function fadeFlashes('), router.indexOf('// --- pull'));

  it('restores the glow, not dark, when a flash ends on the hole still lit', () => {
    expect(fade).toMatch(/if \(decal === glowing\) \{\s*decal\.material\.emissiveIntensity = DROP\.glowIntensity;/);
  });
});

describe('the wall clamp never shrinks the orbit (1.4.1 review)', () => {
  const controls = read('src/scene/cameraControls.ts');
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

  it('links the manifest and touch icon under the Pages base', () => {
    const html = files.find(({ path }) => path.endsWith('index.html')).text;
    expect(html).toContain(`<link rel="manifest" href="${viteConfig.base}manifest.webmanifest"`);
    expect(html).toContain(`<link rel="apple-touch-icon" href="${viteConfig.base}icon-180.png"`);
    for (const name of ['manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png']) {
      expect(files.some(({ path }) => path.endsWith(`/${name}`)), name).toBe(true);
    }
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
  const main = read('src/main.ts');

  it('reaches the client only through a DEV-guarded dynamic import', () => {
    expect(main.match(/dev\/wsClient/g)).toHaveLength(1);
    expect(main).toMatch(/if \(import\.meta\.env\.DEV\) \{\s*import\('\.\/dev\/wsClient\.js'\)/);
    expect(main).not.toMatch(/^import .*dev\//m);
  });

  it('keeps src/dev to the one client file, imported by nothing else', () => {
    const dir = fileURLToPath(new URL('../src/dev', import.meta.url));
    expect(readdirSync(dir)).toEqual(['wsClient.ts']);
    const others = readdirSync(fileURLToPath(new URL('../src', import.meta.url)), { recursive: true })
      .filter((path) => path.endsWith('.ts') && path !== 'main.ts' && !path.startsWith('dev'));
    for (const path of others) expect(read(`src/${path}`), path).not.toMatch(/(import\(|from )['"][^'"]*\/dev\//);
  });

  it('runs the hub on the dev server only', () => {
    const plugin = viteConfig.plugins.flat().find((p) => p?.name === 'skruv-dev-stream');
    expect(plugin.apply).toBe('serve');
  });
});

describe('agent bridge (1.6)', () => {
  const bridge = read('tools/agent-bridge/index.js');

  it('mirrors the DEV_WS protocol strings exactly', () => {
    expect(bridge).toContain(`path: '${DEV_WS.path}'`);
    for (const [name, value] of Object.entries(DEV_WS.kinds)) expect(bridge).toContain(`${name}: '${value}'`);
  });

  // The hub hands every game reply to every tool; ids from 1 in two bridges collide.
  it('numbers its requests under a per-bridge prefix (1.6 review)', () => {
    expect(bridge).toMatch(/const ID_PREFIX = crypto\.randomUUID\(\);/);
    expect(bridge).toMatch(/const id = `\$\{ID_PREFIX\}:\$\{nextId\+\+\}`;/);
  });

  it('imports no game code — it only speaks the protocol', () => {
    expect(bridge).not.toMatch(/from ['"][^'"]*src\//);
  });
});

describe('Flatpack pack code (1.7)', () => {
  const lib = fileURLToPath(new URL('../tools/validate/lib', import.meta.url));
  const modules = readdirSync(lib).filter((name) => name.endsWith('.ts'));

  it('is loaded by the game in exactly one place, src/game/item.ts', () => {
    const sources = readdirSync(fileURLToPath(new URL('../src', import.meta.url)), { recursive: true }).filter((p) => p.endsWith('.ts'));
    const naming = sources.filter((p) => /from ['"][^'"]*\/items\//.test(read(`src/${p}`)));
    expect(naming).toEqual(['game/item.ts']);
    for (const path of sources) expect(read(`src/${path}`), path).not.toMatch(/from ['"][^'"]*tools\/validate\/(index\.js|flatpack\.schema\.json)|from ['"]ajv/);
  });

  // One implementation, imported by the game in the browser and by the validator CLI.
  it.each(modules)('lib/%s imports nothing — no game code, Three, Rapier or Node', (name) => {
    const text = read(`tools/validate/lib/${name}`);
    const sources = [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const source of sources) expect(source, name).toMatch(/^\.\/[\w.]+\.js$/);
    expect(text).not.toMatch(/\b(window|document|process|require)\b/);
  });
});

describe('PWA install (1.6)', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const png = (name) => {
    const bytes = readFileSync(new URL(`../public/${name}`, import.meta.url));
    return { signature: bytes.subarray(1, 4).toString(), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };

  // Off the base, the installed app opens on a 404 (the site serves at the domain root).
  it('starts and scopes the installed app at the Pages base', () => {
    expect(manifest.start_url).toBe(viteConfig.base);
    expect(manifest.scope).toBe(viteConfig.base);
    expect(manifest.id).toBe(viteConfig.base);
  });

  it('launches standalone in the room colour', () => {
    expect(manifest.display).toBe('standalone');
    const background = `#${COLORS.background.toString(16).padStart(6, '0')}`;
    expect(manifest.background_color).toBe(background);
    expect(manifest.theme_color).toBe(background);
    expect(read('index.html')).toContain(`<meta name="theme-color" content="${background}" />`);
  });

  it('ships icons the size they claim, relative to the manifest', () => {
    for (const { src, sizes } of manifest.icons) {
      expect(src).not.toMatch(/^\//);
      const [w, h] = sizes.split('x').map(Number);
      expect(png(src)).toEqual({ signature: 'PNG', width: w, height: h });
    }
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(png('icon-180.png')).toEqual({ signature: 'PNG', width: 180, height: 180 });
  });

  it('registers no service worker (manifest-only)', () => {
    const sources = readdirSync(fileURLToPath(new URL('../src', import.meta.url)), { recursive: true }).filter((p) => p.endsWith('.ts'));
    for (const path of [...sources.map((p) => `src/${p}`), 'index.html']) expect(read(path), path).not.toMatch(/serviceWorker/);
  });
});

describe('telemetry pairs every grab with a release of its mode (1.6 review)', () => {
  const router = read('src/scene/gestureRouter.ts');
  const pull = router.slice(router.indexOf('function pullTo('), router.indexOf('// --- crank'));

  it('reports a pull that frees its part as a pull released and a move grabbed', () => {
    expect(pull).toMatch(/events\?\.emit\(releaseEvent\(part\.id, 'pull'\)\);\s*beginMove\(part, grab, pointer, 'move'\);\s*events\?\.emit\(grabEvent\(part\.id, 'move'\)\);/);
  });
});

describe('the fps guard measures true frame time (1.6 review)', () => {
  it('is fed the loop raw delta, never the clamped game step', () => {
    expect(read('src/main.ts')).toMatch(/createLoop\(\(delta, rawDelta\) => \{[\s\S]*fps\.frame\(rawDelta\)/);
  });
});

describe('tuning drawer downloads survive Safari (1.6 review)', () => {
  it('revokes a download URL only after TUNE.downloadRevokeMs', () => {
    expect(read('src/ui/tunePanel.ts')).toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL\(url\), TUNE\.downloadRevokeMs\)/);
  });
});
