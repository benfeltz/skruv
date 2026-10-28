# Skruv in Godot (spikes 2.0.4.1 to 2.0.4.4)

A Godot project an agent builds and checks from the CLI. 2.0.4.1 made the loop; 2.0.4.2 puts
a bare room and a fully assembled, fully physical JOHNNY in it, read from the pack; 2.0.4.3
ports the first slice of the design layer and plays JOHNNY's whole manual on it, the dowel the
one fastener played by hand; 2.0.4.4 ports the rest of the web build's interaction and assembly
layer, so JOHNNY is built by hand with a mouse from page 1 to 12, every fastener with its tool,
in Jolt as it is built. Spike branch only. It stays off main.

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

## 2.0.4.4 results: the full JOHNNY build

The whole manual by hand, with a mouse: orbit, pan and zoom; lift, drag, snap and seat; tap,
pull; the wrench circled on a bolt, the screwdriver held still on a cam; the build turned over and
tipped upright on the rings. Every part is a Jolt body as it is built: held while carried or waiting
at a seat, the simulation's once its fastener holds it.

| Question | Answer |
|---|---|
| Does the whole manual play by hand? | **Yes, with zero auto pages.** `test/playthrough_test.gd` has the scripted hand (`logic/hand.gd`) play all 12 pages through the router with screen points, as a mouse does: 60 pairs seated, 44 joints pressed by a click, 8 bolts cranked with the wrench, 8 cams driven with the screwdriver, 26 quarter turns on the rings; **60 of 60 joints fastened**, every part within **0.0011 mm** and **0.000°** of the finished item (in the build's own frame). Played twice, open snap (the default) and gated: both pass. |
| Can the web build's rules be carried over by an agent? | **Yes, and they mostly hold up under a real hand.** The router's flow, the camera, picking, ranking and hysteresis, seat assist, self-aim, pull, the crank and hold-to-drive, the rotate gizmo and the web's bond shapes are ported as behaviours; the web specs' test ideas pass (camera limits, preferHit, rankFits, heldOffer, toolAim, crank, every machine both ways). Of #96's 14 departures, 10 are closed, 1 is closed in part and 3 are kept, out of scope by name (below). This step adds 9 small Godot rules of its own, listed. |
| Does an assembly built joint by joint hold in Jolt? | **The carcass does; a shelf does not. RED, with numbers.** `test_physics/build_test.gd` (`loop.sh build`) has the same hand build JOHNNY with every part a Jolt body: 0 errors, 60 of 60 joints fastened on 58 physics joints, zero auto pages, the build's shape within **0.36 mm** of the finished item at every page until the shelves. Over 5 s after "done" the carcass holds within **0.040°**; **adjustableShelf-2 moves 21.39 mm** (it came to rest 29.5 mm off its place on its pins). 2.0.4.2's all-at-once build sagged 19.66 mm / 2.48° on the same Jolt settings. |
| What did porting the router cost? | About two hours of agent time from claiming the note (23:05) to the last tuning commit (00:55), most of it in step 7. `logic/` grew from 1,500 to 5,790 lines of pure GDScript (`router.gd` 1,188, `play.gd` 873, `bonds.gd` 646, `hand.gd` 903), plus 644 lines of scene code (`loop.gd`, `physics_bridge.gd`, `camera_rig.gd`, `turn_ring.gd`) and 1,179 lines of new tests. The router is the bulk: the web's 2,338-line `gestureRouter.ts` became 1,188 lines here, being pure, with the physics seam reduced to one question (`Router.kinematic()`). The hand is nearly as big again: a careful player is a lot of code once things are physical. |
| Did the editor or a human get involved? | **No.** Zero editor interactions. `scenes/world.tscn` is untouched; the build is inserted at runtime. Nothing outside `godot/` changed but the exporter (`godot/tools/export-item.ts`). |

### #96's 14 departures: closed or kept

| # | 2.0.4.3 departure | Now |
|---|---|---|
| 1 | The snap offered only the open page's pairs | **Closed.** Any type-compatible pair of free connectors seats (`Play.snap_candidate`, `fit_candidate`). `Constants.knobs.pageGating` (off) puts #96's rule back: a pair seats only if the open page still wants one of its kind, only parts of the types it wants can be picked up (and tools, to put them away), and a page's loose parts come out as it opens. `--gating` in the windowed loop. Both tested end to end. |
| 2 | The page gated the build | **Closed in part.** The booklet no longer decides what seats. It still turns by itself, once the build has caught up with a page, because the loop has to know when JOHNNY is done; the web's booklet never checks. Pages are judged by type (`Steps.key`: host type, hole, hardware type), so a horizontal turned end for end still turns its page. |
| 3 | No "where it goes" ranking or hysteresis | **Closed.** `logic/fit_rank.gd`: preferredRelatives, preferredPoses, preferredThrough, isPreferred, rankFits, preferredTargets, heldOffer; fits searched again at release (`Play.settled`). |
| 4 | Self-aim about the part's centre, no room clamp | **Closed.** The router's turnAbout: hardware turns its fastener end into the seat about that end, its footprint kept inside the walls, its height off the floor (`logic/assist.gd`, `drag_math.gd`). Panel magnetism turns toward where it goes, from the relatives. |
| 5 | Goals measured through a panel, not a dowel | Kept, and not a web rule: it is the scripted hand's answer key (`Play.goal`), never the player's. |
| 6 | No seat assist | **Closed.** With a seat on offer the held part glides into it at `SNAP.assistStrength` and the finger no longer moves it. |
| 7 | Every part kinematic until "done" | **Closed.** `scenes/physics_bridge.gd`: held while carried, placed at a seat until its first fastener engages and its joints hold it, held still under a fit on offer, lifted, turning on a ring, or a tool on a head; the simulation's otherwise, its pose read back. Results above and in "Physics as you build". |
| 8 | Hardware locked to every host | **Closed.** `Bonds.bonds()` is the web's: embed in the first host (a shelf pin rigid), bridges between hosts sharing hardware (play while only dowels hold, rigid once a cam locks; play is 0°, so every bridge is a locked joint, as the web makes it). |
| 9 | No pull, no unseat by dragging | **Closed.** A part pushed into fastened seats, dragged `FASTENER.pullDistance` px along their axis on screen, comes back to seated and carries on free (beginPull, pullTo, continueFree); a seated, unfastened part dragged away leaves its seat. |
| 10 | Bolt, cam, stud, screw and slide machines | **Closed for JOHNNY's kinds.** `fastener.gd` is the web's machine whole (stud, screw and slide rows included). Bolt and cam are played with their tools: a tool seats only on seated hardware, a drag on it (or its dial) cranks, a still press drives, it comes off at home or on a tap, a cam locks only on a screwed bolt in reach. Hand turns of studs and the slide's prismatic joint are not ported (JOHNNY has none; out of scope by name). |
| 11 | No camera, gizmo, lift line, Shift hold; touch | **Closed for the mouse; touch kept.** Camera orbit/pan/zoom under the router's seam (`logic/camera.gd`, `camera_rig.gd`); the rotate gizmo's rings (detents on, `Constants.knobs.ringDetents`); the wheel lifts mid-drag; Shift + scroll is the elevation line, which holds the part up while Shift is down (drawn as a readout, not a draggable knob). The second finger and touch are out of scope by name. |
| 12 | Picking a ray against each body | **Closed.** `logic/pick.gd` ports pickMath.ts (rayBoxReach, preferHit, the angular finger radius) and casts against the parts' boxes, which are their meshes here. |
| 13 | No feedback | **Kept, out of scope by name.** No drop guide, target rings, hole glow, seat flash or haptics. There are the ghost, the turn ring's dial and flash, the gizmo's rings and the labels. |
| 14 | The box laid in rows on the floor | **Kept.** The web unpacks a box. Here the whole box (spares and tools included, from the export's `extras`) is laid in rows on the floor at the start, 0.3 m between panels; gated, a page's parts as it opens. |

### Rules this step adds (not the web's)

1. **A spin-free fit where it goes takes its spin from where it goes.** A fit whose pairs all lie on
   one line (the plinth on one dowel) says nothing about its spin, and the web's magnetism stops
   once the fit counts as where it goes, so the web seats the plinth up to `PANEL.matchAngle` (5°)
   off. Here the offer takes the spin of where it goes. Without it the plinth seated 4.85° off.
2. **The booklet goes by type**, as above; a panel laid in (the back panel, a shelf) is where it goes
   within `Play.PLACE_REACH` 30 mm and `PLACE_TURN` 10°; a page that turns the build is complete
   once it stands as the page has it (`Steps.POSES`, the web booklet's own orientations from
   `bookletPages.ts`, any heading; within 10°).
3. **Seats are named for the manual's joints** (bookkeeping only): a loose piece of hardware seated in
   a hole the manual gives another of its type takes that one's name, and a moved panel is re-expressed
   by one of its box symmetries (`Bonds.symmetries`) or swaps names with another of its type.
4. **The tool's dial sits round its head.** The web draws a tool's dial beside the detail inset, which
   is out of scope; a press on the dial's band is the tool's crank, as the web's dialUnder has it.
5. **Gated, a tool can always be picked up** (to be put away after its page); it seats only on its page.
6. **The rings lift the whole build clear of the floor** while turning (the web lifts the part's own box).
7. **Detents on by default** (`knobs.ringDetents`); the web's rotate is free unless the snap-rotate toggle
   is on. Free rotation leaves a hand-turned build crooked.
8. **A turned fastener's body stays at its hole's mouth until it fastens**; its sink is drawn
   (`Router.drawn`), as the web's drawTurned draws it. This is the web's rule, but #96's poses had
   moved hardware as it turned; a bolt's body sinking into its panel shoved the panel 10 cm.
9. **With no physics (the pure playthrough), a part let go comes straight down** onto the top of what is
   under it (`Play.settle`).

### Physics as you build

Measured by `test_physics/build_test.gd` (`loop.sh build`, headless, `--fixed-fps 60`: one frame, one
tick). Godot's physics tick is fixed at 60 Hz (`physics_ticks_per_second`), the web's
`PHYSICS.timestep`, so the web's accumulator (`stepping.ts`) is the engine's own here. Jolt as
2.0.4.2 left it: 100 velocity / 20 position steps, 1 mm penetration slop, 2 mm speculative distance.
Each row is a commit.

| Commit | Setting | Result |
|---|---|---|
| baseline (763df81) | true masses | **Stops on page 3.** Shape within 0.02 mm when page 3 opens, then the second top panel seats on one dowel of two: its dowel-14 sits 38.4 mm out of its hole, dowel-12 5.5 mm, and the plinth leans 2.87° (14.8 mm). No done state. |
| attempt 1 (77d586e) | the web's `PHYSICS.minBodyMass` 0.2 kg | Alone, no material change (no explosion, unlike 2.0.4.2's over-constrained locks). The page-3 stop was not sag: held bodies were shoving free ones (below). With the hand fixed: **through page 12**, 60 of 60 joints, shape within 0.51 mm; the shelves fall through their pins. |
| attempt 2 (2bf73d0) | the web's body settings: CCD on every body, friction 0.6, restitution 0, damping 0.1 / 0.3 | **Done reached.** 0 errors, 60 of 60 joints, 58 physics joints, zero auto pages, shape within 0.36 mm until the shelves. 5 s stillness: carcass within **0.040°**; **adjustableShelf-2 21.39 mm** (at rest 29.5 mm off its place on its pins at "done"); asleep 0 of 55. **Kept.** |
| attempt 3 (2360603) | speculative contact distance 2 → 20 mm (Jolt's default; 2.0.4.2 found it catches a shelf) | Worse: contacts reach 2 cm out, held parts push the build from there, and on page 6 the carcass turns about 52° under the side panel coming in. Stops on page 6. **Reverted** (b316a50). |

The windowed film (`loop.sh screenshot`, 20 fps, three ticks a frame) builds it the same way and
agrees: done, 60 joints, 58 physics joints; 40 frames after, adjustableShelf-2 has moved 21.46 mm.

What the physics showed, beyond the numbers:

- **A held body shoves a free one, and a jointed build gives way where it is pushed.** Every stop
  before attempt 2 was this: seat assist easing a dowel through its panel's corner (the panel flew
  24 cm and came down 25 mm off), a screwdriver glided and lowered through the build (a cam knocked
  191 mm while the carcass held), a long panel turned near the build by magnetism (the carcass turned
  52°), a part turned on the rings where it lay. Jolt's locked joints stretch locally rather than
  moving the whole build. The web has the same rules (a kinematic Rapier body pushes; only a panel's
  fit holds its target still), so a player on the phone brushing the build with a held part should
  meet this too. The scripted hand avoids it the way a careful player would; that care is most of
  `hand.gd`.
- **Godot makes a joint's frames from where the bodies stand when it is made**, so bodies must take
  the logic's poses first (a dowel pressed home was otherwise locked at its hole's mouth).
- **Built joint by joint, on the web's bond shapes, the frame stays square**: 0.36 mm against the
  finished item, 0.040° over 5 s. The sag 2.0.4.2 measured (all 76 locks at once, hardware locked to
  every host) does not appear. The shelf on its pins is the one red left, as in 2.0.4.2.

### Screenshots (windowed, `loop.sh screenshot`)

`out/loop-wrench.png`, page 2: the allen wrench on a bolt head at the end of a lying side panel, the
turn ring's dial round it, its arc about 40% round, arrowheads at three and nine. The label reads
"Page 2 of 12: 0 of 8 joints done". `out/loop-cam.png`, page 5: the lying carcass from close in, the
screwdriver on a cam at the foot of a standing panel, its dial half filled. `out/loop-tip.png`, page
11 just opened: JOHNNY upright in the corner of the room, back panel on, fixed shelf and bottom panel
in, no adjustable shelves yet, the gizmo's red, green and blue rings still round the side panel the
hand turned it by. `out/loop-done.png`: JOHNNY standing, both adjustable shelves in; the upper one
reads as a thin sloping line (adjustableShelf-2, slipped on its pins); "Done: JOHNNY stands".

### Deviations from the 2.0.4.4 plan

- **The auto pages fell 9 → 6 → 2 → 0, not 9 → 6 → 1 → 0.** Step 4 played pins, fittings and the
  shelves (pages 9, 11, 12). Page 8 lays the back panel on the build turned face down: that turn is
  the tip's gesture, so page 8 landed with page 10 in step 6.
- **The router moved to `logic/router.gd`**, not `scenes/loop.gd`, so the headless hand plays the very
  gestures a mouse does; `loop.gd` forwards the mouse and draws. Not in the plan's table:
  `logic/router.gd`, `drag_math.gd`, `lift.gd`, `test_physics/build_test.gd` (apart from `test/` so it
  runs at `--fixed-fps 60`), `loop.sh build`.
- **The playthrough runs twice** (open and gated) without physics; physics as you build is
  `loop.sh build`. The plan's Jolt stillness assertion is that stage's, and it is red (above).
- **The export is format 3**: the box's `extras` (2 spare dowels, 2 spare cams, the allen wrench, the
  screwdriver) and each page's `tool`.
- **The room is the web's** (`Constants.ROOM`, 6 × 5 m floor); 2.0.4.2's was 5 × 5.
- **One step needed three tuning attempts and a revert**, recorded one commit each.
- `test/loop_mouse_test.gd` was red on 4c32b17 in this worktree (no seat on offer) and passes since
  step 1; it may be timing-sensitive (it reads real milliseconds).

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
godot --path godot -s res://main.gd    # build JOHNNY by hand with the mouse (a window), in Jolt
godot --path godot -s res://main.gd -- --gating   # the same with 2.0.4.3's page-gated snap
```

In the window: on empty space, left drag orbits, right drag pans, the wheel or a middle drag zooms
toward the cursor. On a part, left drag carries it; the wheel lifts it mid-drag; Shift + scroll
lifts the dragged or clicked part on the elevation line and holds it up while Shift is down. Near
its seat a ghost shows where it goes; let go to seat it. Click to press it home; drag something
pressed home along its axis to pull it out. Let a tool go on a bolt head or cam slot: circle its
dial (or the tool) the way the arrows point, or hold the tool still, to turn it; click it to take it
off. Click a part with nothing to press for the rings: sweep one to turn the part and its build a
quarter turn; click empty space to put them away.

Needs `npm ci` at the repo root once (the export stage runs the TS exporter).

| Stage | What it runs | Fails when |
|---|---|---|
| export | `npx tsc -p godot/tsconfig.json`, then `npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json --check` | the exporter doesn't typecheck, or the committed json (format 3: vocabulary, connectors, joints with their connector indices and mover, the box's extras, the manual's steps with their tools) differs from its output |
| version | `godot --version` | the binary isn't 4.7.2.stable |
| addons | copies gdUnit4 v6.2.2 into `addons/` from its GitHub tarball, sha256-checked. Skipped once present. | the checksum doesn't match |
| import | `godot --headless --path godot --import` | nonzero exit |
| check | `godot --headless -s res://scripts/check.gd` | a script won't compile, including an untyped declaration; or the run has no `check: ok` line |
| test | gdUnit4's `GdUnitCmdTool.gd --ignoreHeadlessMode -c -a res://test` (`-c`: keep going after a failure) | a failed test (gdUnit exit 100) |
| build | headless gdUnit4 on `res://test_physics` at `--fixed-fps 60`: the hand builds JOHNNY in Jolt, then the 5 s stillness; prints `build:` and `stillness:` lines | a failed test: **red now** (adjustableShelf-2 moves 21.39 mm) |
| screenshot | windowed `-s res://main.gd --fixed-fps 20 -- --autoplay --shots=out`: the hand builds JOHNNY in Jolt (`logic/hand.gd`) and saves `out/loop-wrench.png`, `loop-cam.png`, `loop-tip.png` and `loop-done.png` (also `screenshot.png`), then quits; prints its `loop: done` and `loop: settled` lines | nonzero exit, a `SCRIPT ERROR`, no `loop: done` line, or a missing PNG |
| drop | windowed `-- --assembled` with `--write-movie out/frame.png --fixed-fps 20 --quit-after 61`: 2.0.4.2's film; keeps `out/shot-0s.png`, `shot-1s.png`, `shot-3s.png` and prints the run's last `stillness:` line | nonzero exit, a `SCRIPT ERROR`, or a missing frame |

Every Godot call has a 180 s wall-clock cap. Logs are in `godot/out/<stage>.log`, and
gdUnit's HTML/XML reports are in `godot/out/reports/`. The loop reaches the test stage's
end in about 50 s on this Mac (the two playthroughs and the two 5 s stillness runs dominate); the
build adds about 45 s, the screenshots about 60 s and the film about 4 s. **It currently stops at
the test stage**, because 2.0.4.2's jointed stillness test is red, and the build stage is red too
(above); `loop.sh build screenshot drop` runs the rest. The worker reads the
PNGs with its file reader and says what it sees.

Verified red: a type error (`var wrong: int = "a string"`) fails at check, an untyped
`var x = 1` fails at check, and a wrong expected child count fails at test. Each went
back to PASS when reverted.

## Layout

```
project.godot          written by hand; no main scene; untyped declarations are errors; Jolt and
                       its tuning; gdUnit4 and godot_mcp enabled by path; MCP port 6550
main.gd                loop entry point (extends SceneTree): starts World; user args --assembled,
                       --autoplay, --shots=<dir>, --gating
scenes/world.tscn      main scene: one World node, nothing else; open it in the editor and Play
tools/export-item.ts   the exporter (TS, through tools/validate/lib); tsconfig.json typechecks it
items/johnny.json      the exporter's output, committed; the only item data Godot reads
scenes/item_data.gd    ItemData: typed reader for items/johnny.json
scenes/room.gd         Room: static floor (top at y = 0), three walls, sun, ambient, camera
scenes/item.gd         Item: a body per instance, a locked joint per joint, the 2 cm drop; or the compound control
scenes/stillness.gd    Stillness: one measurement of offset, turn, speed, sleep, lowest point
scenes/world.gd        World: room + the build at runtime; start_assembled (and the editor):
                       room + the standing item, a stillness: line each second
scenes/loop.gd         Loop: the mouse into the router, the drawn turns, ghost, gizmo rings, lift
                       line, labels, the autoplay and its shots
scenes/physics_bridge.gd  PhysicsBridge: every part a Jolt body, held or let go as the router says,
                       poses read back, joints from Bonds.bonds()
scenes/camera_rig.gd   CameraRig: the Camera3D, copying logic/camera.gd's orbit
scenes/turn_ring.gd    TurnRing: the dial round each seated tool's head
logic/                 pure, no nodes: constants, camera (orbit and limits), router (the gesture
                       flow), pick, drag_math, lift, snap, panel_fit, fit_rank, assist, fastener,
                       crank, tools, bonds (the assembly graph), steps (the booklet), gesture,
                       play (the build as played), hand (the scripted player)
scenes/hello.gd        2.0.4.1's trivial scene, still tested
scripts/check.gd       the compile gate
scripts/loop.sh        the loop
scripts/editor.sh      start/stop/status the editor from the CLI, for the MCP server
scripts/mcp.sh         call one MCP tool over HTTP
scripts/bin/timeout    GNU timeout stand-in for the addon (macOS has none)
addons/godot_mcp/      voidrot/godot-mcp @ 57715ac, a plain file copy, committed
test/                  item_test (counts and pages vs the pack), room_test, scene_test, stillness_test,
                       hello_test; snap_test, fastener_test, steps_test, gesture_test, camera_test,
                       pick_test, fit_rank_test, assist_test, crank_test, router_test (the web
                       specs' ideas); playthrough_test (open and gated, no physics);
                       loop_mouse_test (real mouse events through the scene, headless)
test_physics/          build_test: the hand builds JOHNNY in Jolt, and the stillness (loop.sh build)
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

Added in 2.0.4.4:

21. **A joint takes its bodies' frames from where they stand when it is made**, from the nodes'
    transforms. A body moved in the same tick must be moved before the joint is made.
22. **A kinematic body drags a jointed Jolt build apart where it pushes**, rather than moving it whole:
    locked Generic6DOF joints stretch locally under a kinematic push (a cam left 191 mm from its panel,
    the rest of the carcass within a millimetre).
23. **`--fixed-fps 60` makes a headless gdUnit run step physics once a frame**, so a test that awaits
    `physics_frame` thousands of times runs in seconds instead of real time. It lives apart from
    `test/` so it doesn't change the other suites' physics (finding 18).

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
