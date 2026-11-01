import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { playManifest } from '../tools/site/manifest.js';

// The marketing site (site/, served at skruv.site's root) and its seam with the game, which
// tools/site/build.ts puts under /play/.

const PLAY = '/play/';
const siteDir = fileURLToPath(new URL('../site', import.meta.url));
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pages = (readdirSync(siteDir, { recursive: true }) as string[]).filter((path) => path.endsWith('.html'));

describe('marketing site', () => {
  it('has the landing, support and privacy pages', () => {
    expect(pages.sort()).toEqual(['index.html', 'privacy/index.html', 'support/index.html']);
  });

  it.each(pages)('%s: every root-relative link and asset resolves', (page) => {
    const html = read(`site/${page}`);
    const urls = [...html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      if (url.startsWith(PLAY)) {
        // The game's files: its page, and the icons from web/public.
        const rest = url.slice(PLAY.length);
        expect(rest === '' || existsSync(fileURLToPath(new URL(`../web/public/${rest}`, import.meta.url))), url).toBe(true);
        continue;
      }
      const file = url.endsWith('/') ? `${url}index.html` : url;
      expect(existsSync(`${siteDir}${file}`), `${page} → ${url}`).toBe(true);
    }
  });

  it('builds the game under the path the site links to', () => {
    expect(read('tools/site/build.ts')).toContain(`PLAY_BASE = '${PLAY}'`);
  });
});

describe('playManifest', () => {
  const source = read('web/public/manifest.webmanifest');

  it('starts and scopes an installed copy at the game, keeping everything else', () => {
    const moved = JSON.parse(playManifest(source, PLAY));
    expect(moved).toEqual({ ...JSON.parse(source), id: PLAY, start_url: PLAY, scope: PLAY });
  });

  it('refuses a base without its slashes', () => {
    expect(() => playManifest(source, 'play')).toThrow();
  });
});
