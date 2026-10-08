# Skruv agent bridge

An MCP server (stdio) that lets an agent watch and tune a **dev** session of the game —
the 0.0.1 dress rehearsal for 1.0.0's R3. Observe everything, write only knobs.

It proxies the dev stream: the WebSocket hub the Vite dev server runs at `/__skruv-dev`
(protocol: `DEV_WS` in `src/constants.ts`). Nothing here exists in a production build.

| Tool | Does |
|------|------|
| `list_tunables` | every live knob with value, default, range, unit, description |
| `get_tunable` | one knob by key, e.g. `joint.angularPlay` |
| `set_tunable` | set a knob — clamped to its range, felt next frame |
| `stream_events` | the latest bus events (optionally one `type`), oldest first |
| `screenshot` | a PNG of the game canvas |

## Use

```bash
npm install --prefix tools/agent-bridge   # once
npm run dev                               # the game, then open it in a browser
```

Point a client at it — for Claude Code, one line:

```bash
claude mcp add skruv -- node tools/agent-bridge/index.js
```

`SKRUV_DEV_URL` overrides the dev server origin (default `ws://localhost:5173`).
