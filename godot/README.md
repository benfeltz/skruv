# Skruv in Godot (spikes 2.0.4.1, 2.0.4.2)

A Godot project an agent builds and checks from the CLI. 2.0.4.1 made the loop; 2.0.4.2 puts
a bare room and a fully assembled, fully physical JOHNNY in it, read from the pack.
Spike branch only. It stays off main.

- **Godot:** 4.7.2.stable.official.ed1daf0bf, at `/opt/homebrew/bin/godot`. Pinned. Don't install another.
- **Physics:** Jolt, set explicitly in `project.godot`.
- **Human editor interactions: 0.** In 2.0.4.2 the worker launched the editor itself from the
  CLI (`scripts/editor.sh`) and drove it only over MCP; no human opened, clicked or saved
  anything in it on the worker's behalf.
- **Scene file (Ben, 2026-10-26, after the write-up):** `scenes/world.tscn` is the main scene.
  It is a container: one `World` node running `world.gd`. The room and JOHNNY are built in
  code when it loads, JOHNNY from `items/johnny.json`, never stored in the scene
  (`test/scene_test.gd` pins it). The scene scripts are `@tool`, so the editor builds the
  room and JOHNNY in its viewport too. Physics and the stillness log run only on Play. 2.0.4.1's one native alert ("no main scene defined")
  came from a bare `godot --path` run in a scratch project; the loop can't trigger it.

## 2.0.4.2 results

| Question | Answer |
|---|---|
| Does Godot read Flatpack? | **Yes, through the one pack implementation.** `tools/export-item.ts` runs `tools/validate/lib` (loadPack, deriveJoints) and writes `items/johnny.json`: 13 part types, 55 assembled instances, 60 derived joints with their `through` and `captured` parts. GDScript reads only that file and holds no JOHNNY number and no joint derivation. The loop fails if the committed json drifts from the exporter. |
| Is it a fully assembled physical world? | **Yes.** 55 `RigidBody3D`s and 76 locked `Generic6DOFJoint3D`s (one per derived joint, plus one to each joint's `through` panel and `captured` bolt). 4.7 has no fixed joint. Seated hardware collides with nothing and shelf pins stay solid, as in the web build. |
| Does it vibrate or jerk? | **No vibration, no jerk at rest: it settles and sleeps within 1–2 s in every configuration but one.** It **sags** instead, and it fails the stillness test. With the final settings the frame holds square to a few mm, but both adjustable shelves fall through their 1 g shelf pins in the headless test. A rigid compound control of the same parts passes. One attempt, the web build's 0.2 kg mass floor, **exploded** the assembly. |

### The stillness test

`test/stillness_test.gd` drops the item 2 cm onto the floor, steps 5 s headless, and asserts
every body asleep, every part within **2 mm** of its assembled position and **0.5°** of its
assembled rotation, and the lowest point within **2 mm** of the floor. It prints a
`stillness:` line each second and a `moved:` line per part over threshold, so a red run keeps
its numbers. It runs twice: the jointed build, and a compound control (the same shapes on one
body, no joints).

Measured at t = 5 s, all deterministic run to run; each row is one commit:

| Commit | Jointed: offset / turn / lowest | What moved | Compound control |
|---|---|---|---|
| baseline: Jolt defaults, true masses | 1391.9 mm / 9.66° / −3.15 mm | top panel −50.9 mm, fixed shelf −42.1, bottom −7.0 down the sides; both adjustable shelves fell through their pins to the floor | not yet built |
| 1. solver steps 10/2 → 100/20 | 430.8 mm / 29.5° / −1.69 mm | frame holds square (top −3.4, fixed −2.2), leans 0.24° as one; shelves still fall | — |
| 2. joint anchors at part midpoints | 487.8 mm / 0.39° / −1.74 mm | no material change | — |
| 3. compound body as the control | 487.8 mm / 0.39° / −1.74 mm | as 2 | **fails too:** 69.7 mm / 1.93° / −12.16 mm: leans back, sinks a corner |
| 4. contact slop 20 → 1 mm, speculative 20 → 2 mm (beyond the plan) | 347.5 mm / 21.9° / −1.01 mm | frame within ~7 mm; shelves fall | **passes:** 1.01 mm / 0.000° / −1.00 mm |
| 5. 0.2 kg minimum body mass (beyond the plan) | **explodes:** 500 m/s (Jolt's cap), parts 50–80 m away | everything | passes, unchanged |
| final: attempt 4 (5 reverted) | 347.5 mm / 21.9° / −1.01 mm | shelves through pins | passes |

Sleep passed in every run except the explosion: Jolt put all 55 bodies to sleep by t = 1–2 s
and nothing woke afterwards. The intermediate 1 mm / 20 mm contact setting held the shelves
(jointed 12.9 mm / 2.45°) but tipped the control 4.9°.

**The run context changes the outcome.** The windowed run of the same code
(`loop.sh screenshot`) settles to 19.66 mm / 2.48° with both shelves still on their pins,
where the headless test measures 347.5 mm / 21.9°. Each context repeats itself exactly, but
they differ from each other, so one passing run proves little.

### What Jolt did

- Locked 6DOF joints between a 1–5 g piece of hardware and 2–6 kg panels give way under
  load at Jolt's default 10 velocity / 2 position steps: the top panel slid 51 mm down the
  sides. Ten times the steps fixes most of that.
- Jolt's default `penetration_slop` and `speculative_contact_distance` are both 20 mm, ten
  times this test's 2 mm bar. A rigid 2 m bookcase leans 1.9° and sinks 12 mm under them. At
  1 mm / 2 mm it lands within 1 mm and 0°.
- The 5 mm shelf pins can't hold a 2.1 kg shelf. A 20 mm speculative distance catches it; 2 mm
  lets it through.
- Raising the hardware to 0.2 kg made the jointed build explode, where the same change fixed
  the shelf pins in the web build's Rapier. The untested guess: the extra locks to `through`
  panels and `captured` bolts over-constrain the hardware, and 1 g gives way where 0.2 kg
  fights.

### Screenshots (windowed, `loop.sh screenshot`)

Frames at 0, 1 and 3 s: `out/shot-0s.png`, `shot-1s.png`, `shot-3s.png`. At 0 s JOHNNY stands
square mid-room, lifted 2 cm. At 1 s it has landed: the top panel sits slightly below the
tops of the sides, and the upper adjustable shelf looks very slightly tilted. 3 s is
byte-identical to 1 s: asleep, no vibration.

## The editor as a tool: verdict

Server: [voidrot/godot-mcp](https://github.com/voidrot/godot-mcp) @ `57715ac`, copied into
`addons/godot_mcp/` and enabled by editing `project.godot`, port pinned to 6550.
`scripts/editor.sh start` launches the editor in the background and waits for the server.
`scripts/mcp.sh <tool> '<json>'` calls a tool over HTTP. `.mcp.json` is the client entry for
a new Claude session (it shows "pending approval" until approved in an interactive session,
so this worker used `mcp.sh`).

| Plan call | Result |
|---|---|
| run the project | **works**: `run_headless` with `script: res://main.gd` and `frames` |
| a debugger error from a broken script | **works**: `validate_script` gives parse errors with lines, `run_headless` gives runtime errors with file, line and stack, `get_editor_log` has both |
| the running game's scene tree | **no**: `get_scene_tree` reads only the *edited* `.tscn`, and this project has none |
| capture the viewport | **no**: voidrot has no capture tool |

mkdevkit/godot-mcp (the fallback) has `get_game_scene_tree` and `get_game_screenshot`, but
only with the editor in Play mode. Play runs a scene file, which this project never saves, so
it was read but not installed.

**Used during step 5:** `run_headless` once, to run a throwaway probe that listed which parts
moved. That found the sag and the falling shelves.

**What it saved against `loop.sh`: nothing measurable.** The same probe runs with
`godot --headless -s probe.gd`, and the test now prints the same per-part lines itself.
`run_headless` returns errors more tidily (structured file/line/stack where `loop.sh` greps
for `SCRIPT ERROR`), and a run with `frames` can't hang. That's a convenience, not a
capability. What it cost:

- The editor **rewrites `project.godot` on every launch** (same values, every comment
  stripped), so `editor.sh` keeps the hand-written file and puts it back.
- The addon runs jobs under GNU `timeout`, which macOS lacks; `scripts/bin/timeout` is a
  stand-in on the editor's PATH.
- A newly copied addon is dropped ("No directory found") until a headless `--import` has
  indexed it, and the editor removes it from the enabled list when that happens.
- The tools reach a running Claude session only after a restart and an approval, so the
  worker spoke HTTP to it directly.
- A snapshot-and-restore on stop nearly wiped two tuning commits: the snapshot predated them.
  `editor.sh stop` now only warns.

A human was never needed in the editor. For a project whose scenes are code, the editor adds
nothing the CLI loop lacks. It's worth revisiting only for a server that reads the
*running* game's tree and screen without a scene file.

## The loop

```bash
godot/scripts/loop.sh             # exit 0 = every stage passed
godot/scripts/loop.sh screenshot  # one or more named stages alone (e.g. while a test is red)
```

Needs `npm ci` at the repo root once (the export stage runs the TS exporter).

| Stage | What it runs | Fails when |
|---|---|---|
| export | `npx tsc -p godot/tsconfig.json`, then `npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json --check` | the exporter doesn't typecheck, or the committed json differs from its output |
| version | `godot --version` | the binary isn't 4.7.2.stable |
| addons | copies gdUnit4 v6.2.2 into `addons/` from its GitHub tarball, sha256-checked. Skipped once present. | the checksum doesn't match |
| import | `godot --headless --path godot --import` | nonzero exit |
| check | `godot --headless -s res://scripts/check.gd` | a script won't compile, including an untyped declaration; or the run has no `check: ok` line |
| test | gdUnit4's `GdUnitCmdTool.gd --ignoreHeadlessMode -c -a res://test` (`-c`: keep going after a failure) | a failed test (gdUnit exit 100) |
| screenshot | windowed `-s res://main.gd --write-movie out/frame.png --fixed-fps 20 --quit-after 61`; keeps `out/shot-0s.png`, `shot-1s.png`, `shot-3s.png` (and `screenshot.png`, the 3 s one) and prints the run's last `stillness:` line | nonzero exit, a `SCRIPT ERROR`, or a missing frame |

Every Godot call has a 180 s wall-clock cap. Logs are in `godot/out/<stage>.log`, and
gdUnit's HTML/XML reports are in `godot/out/reports/`. The loop reaches the test stage's
end in about 14 s on this Mac (the two 5 s stillness runs dominate); the film adds about 4 s. **It currently stops at
the test stage**, because the jointed stillness test is red (above). The worker reads the
PNGs with its file reader and says what it sees.

Verified red: a type error (`var wrong: int = "a string"`) fails at check, an untyped
`var x = 1` fails at check, and a wrong expected child count fails at test. Each went
back to PASS when reverted.

## Layout

```
project.godot          written by hand; no main scene; untyped declarations are errors; Jolt and
                       its tuning; gdUnit4 and godot_mcp enabled by path; MCP port 6550
main.gd                loop entry point (extends SceneTree): starts World
scenes/world.tscn      main scene: one World node, nothing else; open it in the editor and Play
tools/export-item.ts   the exporter (TS, through tools/validate/lib); tsconfig.json typechecks it
items/johnny.json      the exporter's output, committed; the only item data Godot reads
scenes/item_data.gd    ItemData: typed reader for items/johnny.json
scenes/room.gd         Room: static floor (top at y = 0), three walls, sun, ambient, camera
scenes/item.gd         Item: a body per instance, a locked joint per joint, the 2 cm drop; or the compound control
scenes/stillness.gd    Stillness: one measurement of offset, turn, speed, sleep, lowest point
scenes/world.gd        World: room + item, a stillness: line each second
scenes/hello.gd        2.0.4.1's trivial scene, still tested
scripts/check.gd       the compile gate
scripts/loop.sh        the loop
scripts/editor.sh      start/stop/status the editor from the CLI, for the MCP server
scripts/mcp.sh         call one MCP tool over HTTP
scripts/bin/timeout    GNU timeout stand-in for the addon (macOS has none)
addons/godot_mcp/      voidrot/godot-mcp @ 57715ac, a plain file copy, committed
test/                  item_test (counts vs the pack, bodies), room_test, scene_test, stillness_test, hello_test
*.gd.uid               Godot 4.4+ script ids, generated by import, committed
```

`../.mcp.json` (repo root) is the client entry for the editor's server.

Ignored: `.godot/` (import cache), `addons/gdUnit4/` (fetched), `out/` (loop output,
which carries a `.gdignore` so Godot doesn't import its own screenshots).

## Findings on Godot 4.7.2 (macOS, arm64)

1. **`--check-only` can't gate.** `godot --headless --check-only -s bad.gd` prints the
   parse error and exits **0**. `scripts/check.gd` exists for this reason.
2. **`load()` isn't a compile check either.** A script that fails to compile still loads
   as a non-null `GDScript`. `can_instantiate()` is what returns false.
3. **A script must never reload itself.** `ResourceLoader.load(own_path, "",
   CACHE_MODE_IGNORE)` from inside the running script crashes the VM (an internal
   opcode error, then SIGSEGV), so `check.gd` skips its own file.
4. **A script error before `quit()` hangs Godot forever.** Every call in `loop.sh` has a
   wall-clock cap, and each pass needs an explicit success line, so a crash or hang never
   reads as green.
5. **No main scene from code** (2.0.4.2 now has `scenes/world.tscn` as one). `run/main_scene` must be a scene file; a `.gd` there
   fails to load. A custom `run/main_loop_type` still demands a main scene. The project
   therefore starts with `-s res://main.gd`.
6. **A bare run with no main scene pops a native alert**, even with `--headless`
   ("Error: Can't run project: no main scene defined"). Someone has to click it, so an
   unattended loop must always pass `-s`.
7. **No headless screenshot.** `--headless --write-movie` crashes with SIGSEGV (a null
   texture in the dummy renderer). The capture is a windowed run, and a Godot window
   shows for about 3 s on the desktop. This is the only part of the loop that needs a
   display.
8. **The movie writer ignores `--resolution`.** It writes the project's viewport size,
   1152×648 by default. It also writes a `frame.wav`, which the loop deletes.
9. **gdUnit4's `-rd` is relative to the project**, so an absolute path gets nested under
   `godot/`. The loop passes `out/reports`.
10. **Addons are exempt from the typing rule.** `debug/gdscript/warnings/exclude_addons`
    defaults to on, so the untyped-declaration error applies only to our code.

Added in 2.0.4.2:

11. **No fixed joint.** 4.7 has `PinJoint3D`, `HingeJoint3D`, `SliderJoint3D`,
    `ConeTwistJoint3D` and `Generic6DOFJoint3D`; a fully locked 6DOF is the fixed joint.
12. **Jolt's contact defaults are 20 mm** (`penetration_slop`, `speculative_contact_distance`),
    too loose for millimetre furniture (see the stillness table).
13. **Run context changes the physics.** The same scene settles differently in the headless
    gdUnit run and the windowed movie run, though each repeats exactly.
14. **`RigidBody3D.mass` is single precision**: 0.6 reads back as 0.6000000238, so a test
    compares at a relative 1e-6.
15. **gdUnit4 stops at the first failure** unless given `-c`, which hid a whole test.
16. **Launching the editor rewrites `project.godot`**, and drops an enabled addon it hasn't
    indexed yet (see the editor verdict).

## Deviations from the 2.0.4.2 plan

- The plan's step format was a checklist; each item 0–7 is one commit, and each tuning attempt
  is its own commit (attempts 4 and 5 go beyond the plan's three; 5 is reverted).
- New files the plan's table doesn't list: `scenes/item_data.gd` (the typed reader),
  `scenes/stillness.gd` (the measurement, shared by the log and the test), `test/room_test.gd`,
  `scripts/mcp.sh`, `scripts/bin/timeout`, `godot/tsconfig.json`.
- The export carries all 13 part types (the plan's count) and each joint's `through` and
  `captured`, so the back panel and the cam/bolt pairs are attached by locks the lib derived.
- Collisions copy the web build's rule (seated hardware collides with nothing, shelf pins stay
  solid). It was part of the first build, before any measurement, not a tuning step.
- `item_test.gd` reads `items/johnny/flatpack.json` directly to count types and instances. It
  only counts; the joint count is pinned to the lib's 60.
- `loop.sh` takes stage names, so the screenshots can be filmed while the test is red.

## Deviations from the 2.0.4.1 plan

- The plan's step 2 check, `godot --headless --path godot --quit`, was not run. With no
  main scene it pops the alert in finding 6. A headless `--import` exiting 0 was the check
  instead.
- `main.gd` and `scripts/check.gd` are new files the plan's table doesn't list. They are
  the entry point and the compile gate that findings 1 and 5 make necessary.
- gdUnit4 is fetched by `loop.sh` at a pinned checksum instead of being committed (272
  files, 1.8 MB). It is still a plain file copy enabled in `project.godot`; nothing ran in
  an editor.
- No MCP client config was added, because no server was picked. (2.0.4.2 added one.)

## Where it got stuck

Nowhere blocking. Headless capture is the only gap: a screenshot needs a window on a
logged-in desktop, so the loop's last stage won't run on a display-less CI runner as
written.

## 2.0.4.1 MCP server verdict: none needed (superseded by the editor verdict above)

Evaluated 2026-10-26 in the plan's order. The bar: the server works on files on disk and
runs `godot` headless, with no editor open.

| Candidate | Result on 4.7.2 | Needs the editor? | Verdict |
|---|---|---|---|
| [raising-heart/godot-mcp](https://github.com/raising-heart/godot-mcp) @ `a9efd96` | Built from source. `doctor` found 4.7.2. Its own end-to-end suite (`test/smoke.mjs`, a real MCP client against real Godot) passed 29 of 30. The one failure is a Windows-path case (`C:/Windows/win.ini`), which macOS reads as a relative path. Has `check_scripts`, a headless `run_project` and `capture_screenshot`. | No | Passes the bar. Not adopted (see below). |
| [YasiruRF/godot-mcp](https://github.com/YasiruRF/godot-mcp) @ `25ccc4e` | Built, 25 of 25 unit tests pass. The file tools parse and edit `.tscn` text, and `run_headless` runs the project. It has no screenshot and no compile check. The `editor_*` tools need its plugin running in an open editor. | Only for `editor_*` | Passes on its file tools, but they edit `.tscn` files and this project has none. |
| voidrot/godot-mcp, mkdevkit/godot-mcp | Not installed. The plan reaches them only if the first two fail. | Yes, by construction (editor plugins) | Fails the bar. |

**Why none.** These scenes are built in typed GDScript, with no `.tscn`. That takes away
most of what the servers offer: scene-tree reading, node adding and `.tscn` editing. What
is left is a compile check, a headless run and a screenshot, and `scripts/loop.sh` does all
three with the `godot` CLI. The worker reads the PNG with its own file reader.

raising-heart also has a defect for this project. Its `capture_screenshot` and its default
`run_project` start the *main scene*, and a project with no main scene makes Godot show a
native macOS alert ("Can't run project: no main scene defined"). That happens even with
`--headless`, and someone has to click it away. It has `run_project` with `script:`, but
its screenshot tool has no script option. It is the one to come back to if a later sub-task
wants the tools inside Claude: it passes the bar and has the best compile-error report.
Wire it as a project `.mcp.json` entry:
`node <clone>/build/index.js` with `GODOT_PATH=/opt/homebrew/bin/godot`.
