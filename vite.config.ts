/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { DEV_WS } from './src/constants.js';

// The upgrade's Host must name this machine, as Vite requires of its own HMR socket — else
// a site whose DNS rebinds to 127.0.0.1 sends a Host (and Origin) of its own and passes the
// Origin check below. An IP literal (a phone on the LAN), localhost and *.localhost always
// pass; any other name only if server.allowedHosts lets it in.
function allowedHost(host: string | undefined, allowedHosts: string[] | true | undefined) {
  let hostname;
  try {
    ({ hostname } = new URL(`http://${host}`));
  } catch {
    return false;
  }
  if (allowedHosts === true) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  return (allowedHosts ?? []).some((allowed) =>
    allowed.startsWith('.') ? hostname === allowed.slice(1) || hostname.endsWith(allowed) : hostname === allowed,
  );
}

// A browser always sends Origin on a WebSocket upgrade, and CORS never applies to one: only
// a page served by this dev server may connect. Tools (websocat, the agent bridge) send none.
function allowedOrigin({ origin, host }: { origin?: string; host?: string }) {
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// The dev stream's hub (protocol: DEV_WS in src/constants.ts): a WebSocket endpoint on the
// dev server that relays the game page's messages to every tool connected (a websocat, the
// agent bridge) and the tools' to every game page. Dev server only — `apply: 'serve'`, so a
// build never sees it. Another site open in the same browser is refused (allowedHost,
// allowedOrigin).
function devStream(): Plugin {
  return {
    name: 'skruv-dev-stream',
    apply: 'serve',
    configureServer(server) {
      if (!server.httpServer) return;
      const wss = new WebSocketServer({ noServer: true });
      const games = new Set<WebSocket>();
      const tools = new Set<WebSocket>();
      // Vite's own HMR socket upgrades on its own path; only ours is taken here.
      server.httpServer.on('upgrade', (request, socket, head) => {
        if (new URL(request.url!, 'http://localhost').pathname !== DEV_WS.path) return;
        if (!allowedHost(request.headers.host, server.config.server.allowedHosts) || !allowedOrigin(request.headers)) {
          socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
      });
      wss.on('connection', (ws) => {
        // A tool until it says it is the game.
        tools.add(ws);
        ws.on('message', (data) => {
          const text = String(data);
          let message;
          try {
            message = JSON.parse(text);
          } catch {
            return;
          }
          if (message.kind === DEV_WS.kinds.hello) {
            if (message.role === DEV_WS.gameRole) {
              tools.delete(ws);
              games.add(ws);
            }
            return;
          }
          for (const peer of games.has(ws) ? tools : games) if (peer.readyState === peer.OPEN) peer.send(text);
        });
        ws.on('close', () => {
          games.delete(ws);
          tools.delete(ws);
        });
      });
    },
  };
}

export default defineConfig({
  // Served at the domain root (custom domain skruv.site) — a non-root base 404s every asset.
  base: '/',
  plugins: [devStream()],
  test: {
    include: ['test/**/*.test.js'],
  },
});
