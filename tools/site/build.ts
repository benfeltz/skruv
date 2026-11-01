// Builds the whole of skruv.site into _site/: the marketing pages (site/, plain static files)
// at the root, and the game beneath PLAY_BASE. The game's own build (`npm run build`, web/dist
// at base '/') is untouched — the Capacitor shell still loads it from its root.
//
//   npx tsx tools/site/build.ts      (npm run build:site)

import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { playManifest } from './manifest.js';

/** Where the game lives on skruv.site; site/ links to it by this path. */
export const PLAY_BASE = '/play/';

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const out = repo('_site');
const playOut = `${out}${PLAY_BASE}`;

rmSync(out, { recursive: true, force: true });
cpSync(repo('site'), out, { recursive: true });

await build({
  configFile: repo('web/vite.config.ts'),
  base: PLAY_BASE,
  build: { outDir: playOut, emptyOutDir: true },
});

const manifestPath = `${playOut}manifest.webmanifest`;
writeFileSync(manifestPath, playManifest(readFileSync(manifestPath, 'utf8'), PLAY_BASE));
console.log(`site: ${out} (game at ${PLAY_BASE})`);
