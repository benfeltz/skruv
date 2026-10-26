#!/usr/bin/env bash
# The agent loop for the Godot project: fetch addons → import → compile check → headless tests.
# Exit 0 only when every stage passes. No stage opens the editor.
#
#   godot/scripts/loop.sh            # the whole loop
#   GODOT=/path/to/godot loop.sh     # another binary (default: /opt/homebrew/bin/godot, 4.7.2)
#
# Logs land in godot/out/<stage>.log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
GODOT="${GODOT:-/opt/homebrew/bin/godot}"
GODOT_VERSION="4.7.2.stable"
STAGE_TIMEOUT_S=180

GDUNIT_TAG="v6.2.2"
GDUNIT_URL="https://github.com/godot-gdunit-labs/gdUnit4/archive/refs/tags/${GDUNIT_TAG}.tar.gz"
GDUNIT_SHA256="53ba53c23328d8f30205acc2f7ffe3d663773847d09b8f48edab1df6a5950571"

mkdir -p "$OUT"

fail() { echo "loop: FAIL at $1 (see $OUT/$1.log)" >&2; exit 1; }

# Run godot with a hard wall-clock limit. A script error before quit() leaves Godot
# running forever, so no stage may wait on it unbounded. perl's alarm survives exec.
godot_run() {
  local stage="$1"; shift
  perl -e 'alarm shift; exec @ARGV' "$STAGE_TIMEOUT_S" "$GODOT" "$@" >"$OUT/$stage.log" 2>&1
}

stage_version() {
  local v; v="$("$GODOT" --version)"
  [[ "$v" == "$GODOT_VERSION"* ]] || { echo "loop: need Godot $GODOT_VERSION, found $v at $GODOT" >&2; exit 1; }
  echo "loop: godot $v"
}

# gdUnit4 is copied in as files at a pinned tag and checksum. It is never committed;
# project.godot enables it by path.
stage_addons() {
  [[ -f "$ROOT/addons/gdUnit4/plugin.cfg" ]] && { echo "loop: addons present"; return; }
  local tmp; tmp="$(mktemp -d)"
  curl -sSL -o "$tmp/gdunit.tar.gz" "$GDUNIT_URL"
  echo "$GDUNIT_SHA256  $tmp/gdunit.tar.gz" | shasum -a 256 -c - >/dev/null \
    || { echo "loop: gdUnit4 checksum mismatch" >&2; exit 1; }
  tar -xzf "$tmp/gdunit.tar.gz" -C "$tmp" "gdUnit4-${GDUNIT_TAG#v}/addons/gdUnit4"
  mkdir -p "$ROOT/addons"
  cp -R "$tmp/gdUnit4-${GDUNIT_TAG#v}/addons/gdUnit4" "$ROOT/addons/gdUnit4"
  echo "loop: gdUnit4 $GDUNIT_TAG copied in"
}

stage_import() {
  godot_run import --headless --path "$ROOT" --import || fail import
  echo "loop: import ok"
}

# check.gd prints "check: ok" only when every script compiles. Requiring that line means
# a crash or a hang can never read as a pass.
stage_check() {
  godot_run check --headless --path "$ROOT" -s res://scripts/check.gd || fail check
  grep -q '^check: ok' "$OUT/check.log" || fail check
  grep '^check:' "$OUT/check.log" | sed 's/^/loop: /'
}

stage_test() {
  godot_run test --headless --path "$ROOT" \
    -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd --ignoreHeadlessMode -rd "$OUT/reports" -a res://test \
    || fail test
  echo "loop: tests ok"
}

stage_version
stage_addons
stage_import
stage_check
stage_test
echo "loop: PASS"
