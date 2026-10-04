# Skruv

Mobile-first, browser-playable 3D flatpack-assembly game. Three.js + plain DOM/CSS, built with Vite, tested with Vitest. Design doc and task plans live in the Obsidian vault (`notes/skruv/0.0.1/`).

## Commands

| Purpose | Command |
|---------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Full test suite | `npx vitest run` (same as `npm test`) |
| Single test file | `npx vitest run <path>` — e.g. `npx vitest run test/clamp.test.js` |
| Lint | none yet — conventions below carry code health |

Deploy: every merge to `main` publishes to GitHub Pages via `.github/workflows/deploy.yml`. `vite.config.js` sets `base: '/skruv/'`; changing it 404s every asset on Pages.

## Layout

```
src/
  main.js        bootstrap wiring only
  constants.js   every tunable (sizes, colors, camera limits, DPR cap, timing)
  scene/         Three.js renderer, room, render loop, camera controls
  physics/       Rapier world + bodies (PR 2)
  game/          rules, state, assembly logic
  ui/            DOM/CSS overlays
test/            Vitest specs, *.test.js
```

## Rules

- **Pure logic never imports Three, Rapier, or the DOM.** Math, clamps, state machines and rules live in their own modules so Vitest covers them headlessly. If a function you want to test needs Three, split it.
- **Tunables live in `src/constants.js`.** No magic numbers in modules — name the value there and import it.
- **Setup and per-frame work are separate modules.** Build objects once; the loop only updates.
- **Interaction seams are explicit.** `src/scene/cameraControls.js` exposes `enable()`/`disable()`; the gesture router drives camera vs. part manipulation through that seam — never reach into OrbitControls directly.
- **Touch feel is device-only.** Gesture, framerate and camera-feel checks are manual on a real phone (iOS Safari + Android Chrome); state them as manual in PR bodies, never fake them with unit tests.
