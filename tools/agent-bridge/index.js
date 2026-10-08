#!/usr/bin/env node
// Skruv agent bridge: an MCP stdio server proxying the dev stream (DEV_WS in
// src/constants.ts), so an agent can watch a dev session and tune its knobs live. Observe
// everything, write only knobs — it cannot move parts or trigger gestures (1.0.0 R3).
// Plain node + the MCP SDK; no game imports, so the protocol strings below mirror DEV_WS
// (test/conventions.test.js pins them equal).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PROTOCOL = {
  path: '/__skruv-dev',
  kinds: { hello: 'hello', event: 'event', list: 'list', knobs: 'knobs', set: 'set', screenshot: 'screenshot', image: 'image', error: 'error' },
  role: 'agent-bridge',
};

// The dev server's origin; `npm run dev` serves on 5173 unless the port is taken.
const ORIGIN = process.env.SKRUV_DEV_URL ?? 'ws://localhost:5173';
const KEEP_EVENTS = 2000;
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_MS = 2000;

const { kinds } = PROTOCOL;
const events = [];
const pending = new Map();
// The hub hands every game reply to every tool, so ids carry this bridge's own prefix: a
// reply to another tool's request is never taken for one of ours.
const ID_PREFIX = crypto.randomUUID();
let nextId = 1;
let socket = null;

// Logs go to stderr: stdout is the MCP channel.
const log = (...args) => console.error('[agent-bridge]', ...args);

function connect() {
  socket = new WebSocket(`${ORIGIN}${PROTOCOL.path}`);
  socket.addEventListener('open', () => {
    log('connected to', ORIGIN);
    socket.send(JSON.stringify({ kind: kinds.hello, role: PROTOCOL.role }));
  });
  socket.addEventListener('message', ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.kind === kinds.event) {
      events.push(message.event);
      if (events.length > KEEP_EVENTS) events.splice(0, events.length - KEEP_EVENTS);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.kind === kinds.error) waiting.reject(new Error(message.message));
    else waiting.resolve(message);
  });
  socket.addEventListener('close', () => setTimeout(connect, RETRY_MS));
  socket.addEventListener('error', () => {});
}

// One request to the game page; resolves with its answer.
function request(kind, fields = {}) {
  if (socket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`not connected to a dev server at ${ORIGIN} — run \`npm run dev\` and open the game`));
  }
  const id = `${ID_PREFIX}:${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('no game page answered — is the game open in a browser?'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ kind, id, ...fields }));
  });
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (error) => ({ isError: true, content: [{ type: 'text', text: error.message }] });

const server = new McpServer({ name: 'skruv-agent-bridge', version: '0.0.1' });

server.registerTool(
  'list_tunables',
  { description: 'Every live knob: key, current value, default, range, step, unit, group and description.' },
  async () => {
    try {
      return text((await request(kinds.list)).knobs);
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  'get_tunable',
  { description: 'One knob by key (e.g. "joint.angularPlay").', inputSchema: { key: z.string() } },
  async ({ key }) => {
    try {
      const knob = (await request(kinds.list)).knobs.find((k) => k.key === key);
      return knob ? text(knob) : failure(new Error(`unknown knob: ${key}`));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  'set_tunable',
  {
    description: 'Set a knob in the running game; it is clamped into its range and felt on the next frame. Returns the knob as applied.',
    inputSchema: { key: z.string(), value: z.number() },
  },
  async ({ key, value }) => {
    try {
      return text((await request(kinds.set, { key, value })).knobs.find((k) => k.key === key));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  'stream_events',
  {
    description:
      'The latest game events seen since the bridge connected (grab, release, snapCandidate, seat, unseat, fasten, unfasten, reset, recovery, fps, tune, session), oldest first.',
    inputSchema: { limit: z.number().int().positive().max(KEEP_EVENTS).default(50), type: z.string().optional() },
  },
  async ({ limit, type }) => text((type ? events.filter((e) => e.type === type) : events).slice(-limit)),
);

server.registerTool(
  'screenshot',
  { description: 'A PNG of the game canvas as it is now.' },
  async () => {
    try {
      const { dataUrl } = await request(kinds.screenshot);
      return { content: [{ type: 'image', mimeType: 'image/png', data: dataUrl.slice(dataUrl.indexOf(',') + 1) }] };
    } catch (error) {
      return failure(error);
    }
  },
);

connect();
await server.connect(new StdioServerTransport());
