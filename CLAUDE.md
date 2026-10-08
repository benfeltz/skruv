# Skruv

Mobile-first, browser-playable 3D flatpack-assembly game. Strict TypeScript, Three.js + plain DOM/CSS, built with Vite, tested with Vitest. Design doc and task plans live in the Obsidian vault (`notes/skruv/0.0.1/`).

## Commands

| Purpose | Command |
|---------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Full test suite | `npx vitest run` (same as `npm test`) |
| Single test file | `npx vitest run <path>` — e.g. `npx vitest run test/clamp.test.ts` |
| Validate an item | `npx tsx tools/validate/index.ts items/johnny` (once: `npm ci --prefix tools/validate`) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` (ESLint: `@eslint/js` + `typescript-eslint` recommended); the pre-commit hook runs `eslint --fix` on staged `.ts` |

CI: every PR runs the typecheck, lint, validator, tests and build (`.github/workflows/ci.yml`). Deploy: every merge to `main` typechecks, lints, validates, tests and publishes to GitHub Pages via `.github/workflows/deploy.yml`. The site is served at the domain root (custom domain skruv.site): `vite.config.ts` sets `base: '/'`; a non-root base 404s every asset.

## Layout

```
items/
  johnny/flatpack.json  the item: parts, assembled poses, booklet pages, packing (Flatpack format 1)
tools/
  validate/      Flatpack schema + validator CLI (adds ajv); lib/ is the one pack implementation and owns the Flatpack types
  agent-bridge/  MCP bridge to a dev session
src/
  main.ts        bootstrap wiring only
  constants.ts   every tunable (sizes, colors, camera limits, DPR cap, timing)
  scene/         Three.js renderer, room, render loop, camera controls
  physics/       Rapier world + bodies (PR 2)
  game/          rules, state, assembly logic; item.ts is the only door to items/
  ui/            DOM/CSS overlays
test/            Vitest specs, *.test.ts
```

## Rules

- **Pure logic never imports Three, Rapier, or the DOM.** Math, clamps, state machines and rules live in their own modules so Vitest covers them headlessly. If a function you want to test needs Three, split it.
- **Item data lives in its pack, never in code.** JOHNNY's parts, poses, pages and packing are `items/johnny/flatpack.json`; `src/game/item.ts` is the only module that imports it. Joints are derived from the assembled poses, never written down; the file lists connectors in index order, and engine code keys them by index.
- **One pack implementation.** Loading, name resolution, joint derivation and the geometry checks live in `tools/validate/lib/` — pure, zero dependencies, browser-safe, imported by both the game and the validator CLI. Never a second loader; only the CLI adds ajv. The Flatpack types are declared there, beside the code that owns them; the pack-format types (`pack.ts`, `joints.ts`) reach the game only through `src/game/item.ts`, while the vocabulary and pose maths the game imports directly bring their own types. A pack edit must pass `npx tsx tools/validate/index.ts items/johnny`.
- **Tunables live in `src/constants.ts`.** No magic numbers in modules — name the value there and import it.
- **Setup and per-frame work are separate modules.** Build objects once; the loop only updates.
- **Strict TypeScript, no escape hatches.** `tsconfig.json` is `strict` + bundler resolution + `noEmit`; no `any`, no `@ts-ignore`, no inline `eslint-disable` (a rule the tree fights is turned off in `eslint.config.js` with a reason). Relative imports keep their `.js` specifiers (`'../constants.js'`) — TS resolves them to the `.ts` sources.
- **Interaction seams are explicit.** `src/scene/cameraControls.ts` exposes `enable()`/`disable()`; the gesture router drives camera vs. part manipulation through that seam — never reach into OrbitControls directly.
- **Touch feel is device-only.** Gesture, framerate and camera-feel checks are manual on a real phone (iOS Safari + Android Chrome); state them as manual in PR bodies, never fake them with unit tests.
