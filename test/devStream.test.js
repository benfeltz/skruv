import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { DEV_WS } from '../src/constants.js';

// The dev stream's hub on a real Vite dev server (vite.config.js): who may connect, and
// what it relays. Headless — no page, the game's end is played by a socket.
let server;
let url;

beforeAll(async () => {
  server = await createServer({
    configFile: new URL('../vite.config.js', import.meta.url).pathname,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  url = `ws://127.0.0.1:${server.httpServer.address().port}${DEV_WS.path}`;
}, 30_000);

afterAll(() => server?.close());

// Resolves 'open', or the HTTP status the upgrade was refused with.
function connect(origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, origin === undefined ? {} : { origin });
    ws.on('open', () => resolve({ status: 'open', ws }));
    ws.on('unexpected-response', (_, response) => resolve({ status: response.statusCode }));
    ws.on('error', () => resolve({ status: 'error' }));
  });
}

const next = (ws) => new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(String(data)))));

describe('dev stream hub', () => {
  it('refuses a page from another site (cross-site WebSocket)', async () => {
    expect((await connect('http://evil.example')).status).toBe(403);
    expect((await connect('null')).status).toBe(403);
  });

  it('admits a page served by this dev server, and a tool that sends no Origin', async () => {
    const host = new URL(url).host;
    const page = await connect(`http://${host}`);
    const tool = await connect(undefined);
    expect(page.status).toBe('open');
    expect(tool.status).toBe('open');
    page.ws.close();
    tool.ws.close();
  });

  it('relays the game to its tools and the tools to the game', async () => {
    const game = (await connect(undefined)).ws;
    const tool = (await connect(undefined)).ws;
    game.send(JSON.stringify({ kind: DEV_WS.kinds.hello, role: DEV_WS.gameRole }));
    tool.send(JSON.stringify({ kind: DEV_WS.kinds.hello, role: 'test' }));
    await new Promise((r) => setTimeout(r, 50));
    const toGame = next(game);
    tool.send(JSON.stringify({ kind: DEV_WS.kinds.list, id: 'x:1' }));
    expect(await toGame).toEqual({ kind: DEV_WS.kinds.list, id: 'x:1' });
    const toTool = next(tool);
    game.send(JSON.stringify({ kind: DEV_WS.kinds.event, event: { type: 'reset' } }));
    expect(await toTool).toEqual({ kind: DEV_WS.kinds.event, event: { type: 'reset' } });
    game.close();
    tool.close();
  });
});
