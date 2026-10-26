#!/usr/bin/env bash
# Launches the Godot editor on this project from the CLI, so an agent can drive it through
# the godot_mcp addon (an MCP server inside the editor). No human works in this editor.
#
#   godot/scripts/editor.sh start    # background editor, pid in godot/out/editor.pid; waits for the server
#   godot/scripts/editor.sh stop
#   godot/scripts/editor.sh status
#
# The editor rewrites project.godot on load (same values, every comment stripped; 4.7.2), so
# start keeps the hand-written file in godot/out/project.godot.hand and puts it back once the
# server is up. stop never restores (that snapshot may predate edits made while the editor ran);
# it only warns if the editor's header is back. The log is godot/out/editor.log. The server listens on the port in project.godot
# (godot_mcp/server/port); its bearer token is in godot/.godot/godot_mcp/headers.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
PID="$OUT/editor.pid"
GODOT="${GODOT:-/opt/homebrew/bin/godot}"
READY_TIMEOUT_S=60

mkdir -p "$OUT"
touch "$OUT/.gdignore"

# Put the hand-written project.godot back if the editor rewrote it.
restore_project() {
  [[ -f "$OUT/project.godot.hand" ]] || return 0
  if ! cmp -s "$OUT/project.godot.hand" "$ROOT/project.godot"; then
    cp "$OUT/project.godot.hand" "$ROOT/project.godot"
    echo "editor: the editor rewrote project.godot; restored the hand-written file"
  fi
}

running() { [[ -f "$PID" ]] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "editor: already running (pid $(cat "$PID"))"; exit 0; fi
    : >"$OUT/editor.log"
    cp "$ROOT/project.godot" "$OUT/project.godot.hand"
    # The addon runs jobs under GNU `timeout`; macOS has none, so scripts/bin carries a shim.
    PATH="$ROOT/scripts/bin:$PATH" nohup "$GODOT" --editor --path "$ROOT" </dev/null >"$OUT/editor.log" 2>&1 &
    echo $! >"$PID"
    disown
    for _ in $(seq "$READY_TIMEOUT_S"); do
      if grep -q 'godot_mcp: serving' "$OUT/editor.log"; then
        grep 'godot_mcp: serving' "$OUT/editor.log" | tail -1 | sed 's/^/editor: /'
        restore_project
        exit 0
      fi
      running || { echo "editor: exited early (see $OUT/editor.log)" >&2; exit 1; }
      sleep 1
    done
    echo "editor: no MCP server after ${READY_TIMEOUT_S}s (see $OUT/editor.log)" >&2
    exit 1
    ;;
  stop)
    if running; then
      kill "$(cat "$PID")"
      for _ in $(seq 10); do running || break; sleep 1; done
      echo "editor: stopped"
    else
      echo "editor: not running"
    fi
    rm -f "$PID"
    if head -1 "$ROOT/project.godot" | grep -q '^; Engine configuration file'; then
      echo "editor: WARNING project.godot carries the editor's header again; check git diff" >&2
    fi
    ;;
  status)
    if running; then echo "editor: running (pid $(cat "$PID"))"; else echo "editor: not running"; exit 1; fi
    ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
