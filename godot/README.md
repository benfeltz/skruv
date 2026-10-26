# Skruv in Godot (spike 2.0.4.1)

A Godot project an agent builds and checks without ever opening the editor.
Spike branch only. It stays off main.

- **Godot:** 4.7.2.stable.official.ed1daf0bf, at `/opt/homebrew/bin/godot`. Pinned. Don't install another.
- **Editor interactions: 0.** No agent or human opened the Godot editor to make or run this project.

## MCP server verdict: none needed

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
