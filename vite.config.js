import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';
import { DEV_WS } from './src/constants.js';

// The dev stream's hub (protocol: DEV_WS in src/constants.js): a WebSocket endpoint on the
// dev server that relays the game page's messages to every tool connected (a websocat, the
// agent bridge) and the tools' to every game page. Dev server only — `apply: 'serve'`, so a
// build never sees it.
function devStream() {
  return {
    name: 'skruv-dev-stream',
    apply: 'serve',
    configureServer(server) {
      if (!server.httpServer) return;
      const wss = new WebSocketServer({ noServer: true });
      const games = new Set();
      const tools = new Set();
      // Vite's own HMR socket upgrades on its own path; only ours is taken here.
      server.httpServer.on('upgrade', (request, socket, head) => {
        if (new URL(request.url, 'http://localhost').pathname !== DEV_WS.path) return;
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
  // GitHub Pages serves the project at /skruv/ — without this every asset 404s.
  base: '/skruv/',
  plugins: [devStream()],
  test: {
    include: ['test/**/*.test.js'],
  },
});
