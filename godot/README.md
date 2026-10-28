# Skruv in Godot (spikes 2.0.4.1, 2.0.4.2, 2.0.4.3)

A Godot project an agent builds and checks from the CLI. 2.0.4.1 made the loop; 2.0.4.2 puts
a bare room and a fully assembled, fully physical JOHNNY in it, read from the pack; 2.0.4.3
ports the first slice of the design layer and plays JOHNNY's whole manual on it, the dowel the
one fastener played by hand. Spike branch only. It stays off main.

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

## 2.0.4.3 results: the dowel loop

Loose parts in the room; press one and drag it; near its mate it turns to where it goes, a ghost
shows the seat, release seats it; click it and its dowels go home; a complete page turns the
booklet; the manual ends and JOHNNY stands. Pages that are not dowels alone are fastened by the
loop on arrival and listed on screen.

| Question | Answer |
|---|---|
| Does the whole loop run? | **Yes.** `test/playthrough_test.gd` plays the whole manual headless through the same code the mouse loop calls: 3 dowel pages played (1, 3, 6), 19 snaps seating all 28 dowel joints, 9 pages auto-fastened, **60 of 60 joints fastened**, every one of the 55 parts within **0.0003 mm** and **0.000°** of its assembled pose (bar: 2 mm, 0.5°). |
| Can the web build's rules be carried over by an agent? | **Mostly, and faithfully where ported.** Snap, panel fit, the press/pull machine, tap, seatHome, the pose maths, the gesture machine, self-aim and the constants carried over with the web specs' behaviours intact (the snapMath test ideas pass unchanged). What did not carry over is listed below, each with what was done instead. |
| What did the rewrite cost? | About 20 minutes of agent time from claiming the note to a green playthrough, and 30 more for the mouse loop, its shots and its test. 1,500 lines of pure GDScript in `logic/` and 441 in `scenes/loop.gd`, plus 615 lines of new tests. The spec read: snapMath, panelFit, fasteners and bookletModel whole, the assembly graph's slice, gestureState, and the drag/tap flow of the 2,338-line router. |
| Did the editor or a human get involved? | **No.** Zero editor interactions; nothing opened the editor. `scenes/world.tscn` is untouched and still holds one node; the loop is inserted at runtime. |

### What carried over, file by file

All pure: `logic/` imports no node class. Poses are `Transform3D` values, connectors plain records.

| GDScript | Web spec | Notes |
|---|---|---|
| `logic/constants.gd` | `src/constants.ts` | `SNAP`, `GESTURE`, `FASTENER` copied verbatim under the same names (`Constants.SNAP.maxDistance`), plus `PANEL`, `AIM` and `PICK`, which the panel fit, aim and picking read. `FASTENER.sinkDepth` is the Flatpack contract's and comes through the export (`ItemData.sink_depth`); `captureRadius` is copied with that note. |
| `logic/snap.gd` | `snapMath.ts` | `find_snap`, `apply_transform`, `rotation_between` (the same half-turn choice). Compatibility is the export's vocabulary, never a copy. |
| `logic/panel_fit.gd` | `panelFit.ts` `findFits` | Seed, spin, fit, dedupe as the web has them, plus an optional `allowed(hole, end)` filter (below). |
| `logic/fastener.gd` | `fasteners.ts` | The press/pull rows (dowel, pin, fitting): tap seated→pressed, pull pressed→seated, an ignored event returns the same record. |
| `logic/bonds.gd` | `assembly.ts` | `seat`, `apply`, `tap` with the router's `pressCarried`, `seat_home`, `relative_pose`, `carry_pose`, `seated_pose`, `bonds`. It also holds every part's pose, which the web keeps on its physics bodies. |
| `logic/steps.gd` | `bookletModel.ts` `createBuildSteps` | The pages come through the exporter, which calls `createBuildSteps` itself, so GDScript reimplements none of it. Here: open page, completion, turning, auto flagging. |
| `logic/gesture.gd` | `gestureState.ts` | `createGestureState` whole: owners, tap vs drag at `tapMaxDistance`/`tapMaxMs`, the lift channel, wheel, cancel. |
| `logic/play.gd` | `gestureRouter.ts` (drag/tap), `toolAim.ts` | The snap on offer for a part dragged to a pose (find_snap for lone hardware, panel fit otherwise), seat (`moverOf`), self-aim and panel magnetism (`aimWeight`, `aimStep`), tap, page turns, auto pages, floor layout. |
| `logic/hand.gd` | — | A scripted player, shared by the playthrough test and the windowed autoplay so the film shows the moves the test proves. |

### Web rules that did not carry over, and what was done instead

1. **Correctness never enters the snap** (web: any type-compatible pair seats; the booklet only
   advises). **Here the snap offers only the open page's own pairs**, matched by connector
   identity, so the page knows when it is done. Loose hardware stands in for any loose piece of
   its type (`Bonds.swap`): a dowel is a dowel, and the picked one takes the manual's name.
2. **The booklet is reference only** on the web. **Here a page gates the build**: it completes
   when its joints are seated and fastened, then it turns.
3. **"Where it goes" ranking and hysteresis** (`rankFits`, `preferredPoses`, `heldOffer`) are
   not ported. Instead `find_fits` takes the page pairs as an `allowed` filter at seed, spin and
   seat, and the most pairs then the nearest fit wins. Without the filter, a two-dowel horizontal
   seated 2.26° off: the spin paired a dowel with the neighbouring hole at the same radius, and
   both real pairs still fell inside the 1 cm / 5° match window.
4. **Self-aim turns hardware about its fastener end, clamped inside the room.** Here it turns
   about the part's centre, with no room clamp (`SNAP.roomTolerance`, `GESTURE.wallMargin`,
   `ceilingMargin` unused). Lone hardware turns only its end's axis, as on the web; anything else
   turns whole toward where it goes (PANEL magnetism).
5. **A goal measured through a dowel is wrong.** A dowel is round about its axis, and snap only
   straightens the axis, so its spin is arbitrary. Goals and the turn check go through a panel on
   each side (`Play._panel_of`), and a fastener's turn is its end axis's. This is not a web
   divergence: the web never asks a dowel where its panel goes either. It was the playthrough's
   first red (a one-dowel plinth carried 5° off).
6. **Seat assist** (`SNAP.assistStrength`: the held part glides into the seat on offer) is not
   ported. The ghost shows the seat, and release jumps to it.
7. **Physics during the build.** On the web a seated part is held kinematic until a fastener
   engages, then rides Rapier on its bonds. Here every part is a frozen kinematic body the whole
   build, moved by the pure poses. At "done" every body goes to Jolt and every fastened pair
   becomes a locked joint, the 2.0.4.2 shape.
8. **Bonds.** The web embeds hardware in its first host and bridges the hosts (with angular play
   while only dowels hold; `angularPlayDegrees` is 0). Here hardware is locked to each host (and
   to a fitting's far panel and a cam's bolt), as 2.0.4.2 built it.
9. **Pull and unseat.** The machine has `pull`, tested both ways, but the scene has no pull
   gesture (`FASTENER.pullDistance`) and no unseating by dragging a part away.
10. **Bolt, cam, stud, screw and slide machines** are not ported. Their events return the same
    record, and their pages are fastened by `Fastener.auto_home`, marked `auto`, at the export's
    poses: hardware at its home against its host, a page's panel against the build, the tip page
    moving the build to its assembled, upright pose.
11. **Input.** Touch, the second-finger lift, camera orbit/pan/zoom, gizmo rings, the lift line
    and Shift-hold are not wired. The gesture machine is ported whole, but the scene feeds it one
    mouse pointer and the wheel (`GESTURE.desktopLiftRate` per px, 20 px a notch). The camera is
    fixed, and reframes on JOHNNY at "done".
12. **Picking** is a ray against each body, with hardware given an invisible box no thinner than
    `PICK.proxyMinSize`. The web's angular finger radius and preference rules (`pickMath.ts`) are
    not ported.
13. **Feedback.** No drop guide, target rings, hole glow, seat flash or haptics. The page label,
    the ghost and the auto list are all there is.
14. **Layout.** The web unpacks a box. Here each page's loose parts are laid in rows on the
    floor, thinnest side down, when the page opens.

### Screenshots (windowed, `loop.sh screenshot`)

`out/loop-page3.png`, mid-page 3 with 3 of 7 dowels pressed: side panel 1 lies flat on the floor
in front with side panel 2 behind it. A top/bottom panel stands on edge on side panel 1's far end,
on its dowels; a fixed shelf and the other horizontal lie loose to the right. Dowels show as
small tan specks at the panel ends. The label reads "Page 3 of 12: 3 of 7 dowels pressed", and
the list shows page 2's bolts and side panels laid in by the loop.

`out/loop-done.png`, 2 s after "done": the room's framing, JOHNNY upright mid-room, the brown back
panel on, the fixed shelf and both adjustable shelves level on their pins, the plinth at the
foot. "Done: JOHNNY stands" sits bottom-left, and the nine auto pages (2, 4, 5, 7, 8, 9, 10, 11,
12) are listed top-left with what each fastened. Jolt moved the build: the worst body after 2 s
is the back panel, 13.7 mm from its assembled pose (the 2.0.4.2 sag, not this task's to tune).

### The stillness red, unchanged

The jointed stillness test is still the one red, and its numbers are unchanged like for like: run
alone, it measures 19.66 mm / 2.484° on this branch and on fce976a. In the full suite its numbers
depend on which suites ran before it in the same process: 347.5 mm / 21.9° with 2.0.4.2's
suites, 388.7 mm / 130.5° with this branch's. Finding 13 grows: **the test order changes the
physics**, not only headless against windowed. The windowed drop film (`loop.sh drop`) still
settles to 19.66 mm / 2.48°.

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
godot/scripts/loop.sh                  # exit 0 = every stage passed
godot/scripts/loop.sh screenshot drop  # one or more named stages alone (e.g. while a test is red)
godot --path godot -s res://main.gd    # play the dowel loop with the mouse (a window)
```

Needs `npm ci` at the repo root once (the export stage runs the TS exporter).

| Stage | What it runs | Fails when |
|---|---|---|
| export | `npx tsc -p godot/tsconfig.json`, then `npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json --check` | the exporter doesn't typecheck, or the committed json (format 2: vocabulary, connectors, joints with their connector indices and mover, the manual's steps) differs from its output |
| version | `godot --version` | the binary isn't 4.7.2.stable |
| addons | copies gdUnit4 v6.2.2 into `addons/` from its GitHub tarball, sha256-checked. Skipped once present. | the checksum doesn't match |
| import | `godot --headless --path godot --import` | nonzero exit |
| check | `godot --headless -s res://scripts/check.gd` | a script won't compile, including an untyped declaration; or the run has no `check: ok` line |
| test | gdUnit4's `GdUnitCmdTool.gd --ignoreHeadlessMode -c -a res://test` (`-c`: keep going after a failure) | a failed test (gdUnit exit 100) |
| screenshot | windowed `-s res://main.gd --fixed-fps 20 -- --autoplay --shots=out`: the loop plays the manual itself (`logic/hand.gd`) and saves `out/loop-page3.png` and `out/loop-done.png` (also `screenshot.png`), then quits; prints its `loop: done` and `loop: settled` lines | nonzero exit, a `SCRIPT ERROR`, no `loop: done` line, or a missing PNG |
| drop | windowed `-- --assembled` with `--write-movie out/frame.png --fixed-fps 20 --quit-after 61`: 2.0.4.2's film; keeps `out/shot-0s.png`, `shot-1s.png`, `shot-3s.png` and prints the run's last `stillness:` line | nonzero exit, a `SCRIPT ERROR`, or a missing frame |

Every Godot call has a 180 s wall-clock cap. Logs are in `godot/out/<stage>.log`, and
gdUnit's HTML/XML reports are in `godot/out/reports/`. The loop reaches the test stage's
end in about 15 s on this Mac (the two 5 s stillness runs dominate); the screenshots add about
8 s and the film about 4 s. **It currently stops at
the test stage**, because the jointed stillness test is red (above). The worker reads the
PNGs with its file reader and says what it sees.

Verified red: a type error (`var wrong: int = "a string"`) fails at check, an untyped
`var x = 1` fails at check, and a wrong expected child count fails at test. Each went
back to PASS when reverted.

## Layout

```
project.godot          written by hand; no main scene; untyped declarations are errors; Jolt and
                       its tuning; gdUnit4 and godot_mcp enabled by path; MCP port 6550
main.gd                loop entry point (extends SceneTree): starts World; user args --assembled,
                       --autoplay, --shots=<dir>
scenes/world.tscn      main scene: one World node, nothing else; open it in the editor and Play
tools/export-item.ts   the exporter (TS, through tools/validate/lib); tsconfig.json typechecks it
items/johnny.json      the exporter's output, committed; the only item data Godot reads
scenes/item_data.gd    ItemData: typed reader for items/johnny.json
scenes/room.gd         Room: static floor (top at y = 0), three walls, sun, ambient, camera
scenes/item.gd         Item: a body per instance, a locked joint per joint, the 2 cm drop; or the compound control
scenes/stillness.gd    Stillness: one measurement of offset, turn, speed, sleep, lowest point
scenes/world.gd        World: room + the dowel loop at runtime; start_assembled (and the editor):
                       room + the standing item, a stillness: line each second
scenes/loop.gd         Loop: the mouse loop (bodies follow Play's poses, picking, drag, ghost,
                       tap, labels, the hand-off to Jolt at done, the autoplay and its shots)
logic/                 pure, no nodes: constants, snap, panel_fit, fastener, bonds, steps,
                       gesture, play (the build as played), hand (the scripted player)
scenes/hello.gd        2.0.4.1's trivial scene, still tested
scripts/check.gd       the compile gate
scripts/loop.sh        the loop
scripts/editor.sh      start/stop/status the editor from the CLI, for the MCP server
scripts/mcp.sh         call one MCP tool over HTTP
scripts/bin/timeout    GNU timeout stand-in for the addon (macOS has none)
addons/godot_mcp/      voidrot/godot-mcp @ 57715ac, a plain file copy, committed
test/                  item_test (counts and pages vs the pack), room_test, scene_test, stillness_test,
                       hello_test; snap_test, fastener_test, steps_test, gesture_test (the web
                       specs' ideas); playthrough_test (the acceptance test); loop_mouse_test
                       (real mouse events through the scene, headless)
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

Added in 2.0.4.3:

17. **An inner class may not share a native class's name.** `class Window:` inside a script is a
    parse error ("hides a native class"); panel_fit's window is `FitWindow`.
18. **The test order changes the physics.** The same stillness test gives different numbers by
    which suites ran before it in the gdUnit process (see "The stillness red, unchanged").
19. **A windowed run can save its own frames.** `await RenderingServer.frame_post_draw` then
    `get_viewport().get_texture().get_image().save_png()` writes the exact frame a script asks
    for, with no movie writer, so the loop shoots at a page, not at a second.
20. **Mouse input tests headless.** `get_viewport().push_input()` with `InputEventMouseButton`
    and `InputEventMouseMotion` reaches `_unhandled_input`, and ray picking against bodies works
    in the headless physics space once a physics frame has passed. The mouse path is tested
    without a window.

## Deviations from the 2.0.4.3 plan

- New files the plan's table doesn't list: `logic/panel_fit.gd` (the panel half of the snap: a
  panel seats on all its dowels at once), `logic/play.gd` (the build as played, shared by the
  test and the scene), `logic/hand.gd` (the scripted player), `test/loop_mouse_test.gd`.
- `bonds.gd` is the assembly-graph slice and holds every pose, so the playthrough needs no
  physics. The scene's bodies follow it, and physics joins only at "done".
- The export is format 2: besides `steps` and each joint's `kind` (already there), it carries
  the vocabulary, each type's connectors and each joint's connector indices and mover, since
  the snap needs them and GDScript must not keep a second copy.
- `item.gd`'s mesh and collider helpers are static now, so the loop builds bodies the same way.
- The screenshot stage films the loop by page (the autoplay saves its PNGs itself), and
  2.0.4.2's drop film moved to its own `drop` stage, still in the full loop.
- `steps_test` pins the dowel pages to 1, 3 and 6, so a pack edit that moves them is noticed.

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
