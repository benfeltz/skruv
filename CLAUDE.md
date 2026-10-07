# Skruv

Mobile-first, browser-playable 3D flatpack-assembly game. Three.js + plain DOM/CSS, built with Vite, tested with Vitest. Design doc and task plans live in the Obsidian vault (`notes/skruv/0.0.1/`).

## Commands

| Purpose | Command |
|---------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Full test suite | `npx vitest run` (same as `npm test`) |
| Single test file | `npx vitest run <path>` — e.g. `npx vitest run test/clamp.test.js` |
| Validate an item | `node tools/validate/index.js items/johnny` (once: `npm ci --prefix tools/validate`) |
| Lint | none yet — conventions below carry code health |

CI: every PR runs the validator, the tests and the build (`.github/workflows/ci.yml`). Deploy: every merge to `main` validates, tests and publishes to GitHub Pages via `.github/workflows/deploy.yml`. The site is served at the domain root (custom domain skruv.site): `vite.config.js` sets `base: '/'`; a non-root base 404s every asset.

## Layout

```
items/
  johnny/flatpack.json  the item: parts, assembled poses, booklet pages, packing (Flatpack format 1)
tools/
  validate/      Flatpack schema + validator CLI (adds ajv); lib/ is the one pack implementation
  agent-bridge/  MCP bridge to a dev session
src/
  main.js        bootstrap wiring only
  constants.js   every tunable (sizes, colors, camera limits, DPR cap, timing)
  scene/         Three.js renderer, room, render loop, camera controls
  physics/       Rapier world + bodies (PR 2)
  game/          rules, state, assembly logic; item.js is the only door to items/
  ui/            DOM/CSS overlays
test/            Vitest specs, *.test.js
```

## Rules

- **Pure logic never imports Three, Rapier, or the DOM.** Math, clamps, state machines and rules live in their own modules so Vitest covers them headlessly. If a function you want to test needs Three, split it.
- **Item data lives in its pack, never in code.** JOHNNY's parts, poses, pages and packing are `items/johnny/flatpack.json`; `src/game/item.js` is the only module that imports it. Joints are derived from the assembled poses, never written down; the file lists connectors in index order, and engine code keys them by index.
- **One pack implementation.** Loading, name resolution, joint derivation and the geometry checks live in `tools/validate/lib/` — pure, zero dependencies, browser-safe, imported by both the game and the validator CLI. Never a second loader; only the CLI adds ajv. A pack edit must pass `node tools/validate/index.js items/johnny`.
- **Tunables live in `src/constants.js`.** No magic numbers in modules — name the value there and import it.
- **Setup and per-frame work are separate modules.** Build objects once; the loop only updates.
- **Interaction seams are explicit.** `src/scene/cameraControls.js` exposes `enable()`/`disable()`; the gesture router drives camera vs. part manipulation through that seam — never reach into OrbitControls directly.
- **Touch feel is device-only.** Gesture, framerate and camera-feel checks are manual on a real phone (iOS Safari + Android Chrome); state them as manual in PR bodies, never fake them with unit tests.
