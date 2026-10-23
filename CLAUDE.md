# Skruv

Mobile-first, browser-playable 3D flatpack-assembly game. Strict TypeScript, Three.js + plain DOM/CSS, built with Vite, tested with Vitest. Design doc and task plans live in the Obsidian vault (`notes/skruv/0.0.1/`).

## Commands

| Purpose | Command |
|---------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Full test suite | `npx vitest run` (same as `npm test`) |
| Single test file | `npx vitest run <path>` — e.g. `npx vitest run test/clamp.test.ts` |
| Validate an item | `npx tsx tools/validate/index.ts items/johnny` (and `items/blank`, `items/overkall`; once: `npm ci --prefix tools/validate`) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` (ESLint: `@eslint/js` + `typescript-eslint` recommended); the pre-commit hook runs `eslint --fix` on staged `.ts` |
| Shell, local phone loop | `cd app && npm ci && scripts/ios.sh build` (then `install`, `launch`, or `all` / `sim`; the script's header lists them) |

CI: every PR runs the typecheck, lint, validator, tests and build (`.github/workflows/ci.yml`). Deploy: every merge to `main` typechecks, lints, validates, tests and publishes `web/dist` to GitHub Pages via `.github/workflows/deploy.yml`. A PR or merge touching only `app/`, `docs/` or Markdown skips both workflows (`paths-ignore`). The site is served at the domain root (custom domain skruv.site): `web/vite.config.ts` sets `base: '/'`; a non-root base 404s every asset.

## Layout

```
app/
  the Capacitor shell: capacitor.config.ts, package.json, scripts/ios.sh (local iPhone loop), ios/ and android/ native projects; builds web/dist
web/
  index.html, public/, vite.config.ts  the teaser's own files; the build reads ../src (`vite build web`)
items/
  johnny/flatpack.json  an item: parts, assembled poses, booklet pages, packing (Flatpack format 1)
  blank/flatpack.json   the second item: a side table of box legs and double-ended studs
  overkall/flatpack.json  the third item: a nightstand whose drawer is a dowelled, screwed box
tools/
  validate/      Flatpack schema + validator CLI (adds ajv); lib/ is the one pack implementation and owns the Flatpack types
  agent-bridge/  MCP bridge to a dev session
src/
  main.ts        bootstrap wiring only
  constants.ts   every tunable (sizes, colors, camera limits, DPR cap, timing)
  scene/         Three.js renderer, room, render loop, camera controls
  physics/       Rapier world + bodies (PR 2)
  game/          rules, state, assembly logic; item.ts is the only door to items/; roomSave.ts is the save format
  ui/            DOM/CSS overlays
test/            Vitest specs, *.test.ts
```

## Rules

- **Pure logic never imports Three, Rapier, or the DOM.** Math, clamps, state machines and rules live in their own modules so Vitest covers them headlessly. If a function you want to test needs Three, split it.
- **Item data lives in its pack, never in code.** JOHNNY's parts, poses, pages and packing are `items/johnny/flatpack.json`; `src/game/item.ts` is the only module that imports it. Joints are derived from the assembled poses, never written down; the file lists connectors in index order, and engine code keys them by index.
- **One pack implementation.** Loading, name resolution, joint derivation and the geometry checks live in `tools/validate/lib/` — pure, zero dependencies, browser-safe, imported by both the game and the validator CLI. Never a second loader; only the CLI adds ajv. The Flatpack types are declared there, beside the code that owns them; the pack-format types (`pack.ts`, `joints.ts`) reach the game only through `src/game/item.ts`, while the vocabulary and pose maths the game imports directly bring their own types. A pack edit must pass `npx tsx tools/validate/index.ts items/<item>`.
- **The room's save is one JSON document, format-versioned** (`src/game/roomSave.ts`, `docs/room-save/format-1.md`); restored at boot by `src/game/roomRestore.ts`, a refused save starting the room empty and left in the store; a new kind of object is a new `kind` in `objects`, never a format bump.
- **The door names the active world's item.** A kept world runs nothing that reads the pack; the slot (`src/game/itemSlot.ts`) turns the door before it activates, restores or disposes a world. Words: a *world* is one item's build in the room (`itemWorld.ts`), an *item* is a pack, the *physics world* is Rapier's.
- **The manuals are the switcher** (`src/ui/manualFan.ts`, model in `src/game/manualFan.ts`): every world's manual lives in the pocket at the manual band's far end (its right end upright, its foot in landscape), a spine of cover edges at rest with the open manual's on top, from the first world on. A tap spreads the covers as a row (above the band upright, leftward into the room in landscape), the open one nearest the pocket; a tap on another cover is the slot's `pick`, a swipe never picks. The band prints the open manual's name. The catalog only adds items; its thumb, the menu and the lift line keep their places, and the menu's drop opens to the right in landscape.
- **Tunables live in `src/constants.ts`.** No magic numbers in modules — name the value there and import it.
- **Setup and per-frame work are separate modules.** Build objects once; the loop only updates.
- **Strict TypeScript, no escape hatches.** `tsconfig.json` is `strict` + bundler resolution + `noEmit`; no `any`, no `@ts-ignore`, no inline `eslint-disable` (a rule the tree fights is turned off in `eslint.config.js` with a reason). Relative imports keep their `.js` specifiers (`'../constants.js'`) — TS resolves them to the `.ts` sources.
- **Interaction seams are explicit.** `src/scene/cameraControls.ts` exposes `enable()`/`disable()`; the gesture router drives camera vs. part manipulation through that seam — never reach into OrbitControls directly.
- **Touch feel is device-only.** Gesture, framerate and camera-feel checks are manual on a real phone (iOS Safari + Android Chrome); state them as manual in PR bodies, never fake them with unit tests.
