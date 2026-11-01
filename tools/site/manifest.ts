// The game's web manifest, moved under the path the marketing site serves it at. Pure: JSON
// text in, JSON text out. web/public/manifest.webmanifest names the domain root, which is
// right for the Capacitor shell and the plain `npm run build`; on skruv.site the root is the
// marketing page, so an installed Home Screen copy must start, and stay scoped, at the game.

export function playManifest(text: string, base: string): string {
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error(`base must start and end with /: ${base}`);
  const manifest = JSON.parse(text) as Record<string, unknown>;
  return `${JSON.stringify({ ...manifest, id: base, start_url: base, scope: base }, null, 2)}\n`;
}
