#!/usr/bin/env bash
# The agent loop for the Godot project: export check → fetch addons → import → compile check →
# headless tests (the dowel-loop playthrough among them) → windowed dowel-loop screenshots →
# windowed drop film of the finished item.
# Exit 0 only when every stage passes. No stage opens the editor.
#
#   godot/scripts/loop.sh            # the whole loop
#   godot/scripts/loop.sh screenshot drop # named stages only, in the order given (e.g. while a test is red)
#   GODOT=/path/to/godot loop.sh     # another binary (default: /opt/homebrew/bin/godot, 4.7.2)
#
# Logs land in godot/out/<stage>.log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
OUT="$ROOT/out"
GODOT="${GODOT:-/opt/homebrew/bin/godot}"
GODOT_VERSION="4.7.2.stable"
STAGE_TIMEOUT_S=180
SHOT_FPS=20
# The drop is filmed at these seconds; frame N of the movie is at N / SHOT_FPS s.
SHOT_SECONDS=(0 1 3)

GDUNIT_TAG="v6.2.2"
GDUNIT_URL="https://github.com/godot-gdunit-labs/gdUnit4/archive/refs/tags/${GDUNIT_TAG}.tar.gz"
GDUNIT_SHA256="53ba53c23328d8f30205acc2f7ffe3d663773847d09b8f48edab1df6a5950571"

mkdir -p "$OUT"
touch "$OUT/.gdignore"  # keep Godot from importing the loop's own PNGs and logs

fail() { echo "loop: FAIL at $1 (see $OUT/$1.log)" >&2; exit 1; }

# Run godot with a hard wall-clock limit. A script error before quit() leaves Godot
# running forever, so no stage may wait on it unbounded. perl's alarm survives exec.
godot_run() {
  local stage="$1"; shift
  perl -e 'alarm shift; exec @ARGV' "$STAGE_TIMEOUT_S" "$GODOT" "$@" >"$OUT/$stage.log" 2>&1
}

# The item Godot reads is generated from the pack by the TS exporter, through the one pack
# implementation. The exporter must typecheck, and the committed json must be its exact output.
stage_export() {
  [[ -d "$REPO/node_modules" ]] || { echo "loop: run npm ci at the repo root first (the exporter needs it)" >&2; exit 1; }
  ( cd "$REPO" && npx tsc -p godot/tsconfig.json \
      && npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json --check ) >"$OUT/export.log" 2>&1 \
    || fail export
  tail -1 "$OUT/export.log" | sed 's/^/loop: /'
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

# -c: run every test even after a failure, so a red run still reports all of them.
stage_test() {
  godot_run test --headless --path "$ROOT" \
    -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd --ignoreHeadlessMode -c -rd out/reports -a res://test \
    || fail test
  echo "loop: tests ok"
}

# Windowed on purpose: `--headless --write-movie` crashes 4.7.2 with signal 11, and a headless
# viewport has no pixels. A window shows for about 8 s. Always started through main.gd, because a
# bare run with no main scene shows a native macOS alert that someone has to click.
#
# screenshot: the dowel loop plays the manual itself (scenes/loop.gd autoplay, logic/hand.gd) at
# a fixed 20 fps and saves out/loop-page3.png (page 3, three dowels pressed) and out/loop-done.png
# (JOHNNY handed to Jolt and settled 2 s), then quits. out/screenshot.png is the done one.
stage_screenshot() {
  rm -f "$OUT"/loop-*.png "$OUT/screenshot.png"
  godot_run screenshot --path "$ROOT" -s res://main.gd --fixed-fps "$SHOT_FPS" -- --autoplay --shots="$OUT" \
    || fail screenshot
  if grep -q 'SCRIPT ERROR' "$OUT/screenshot.log"; then fail screenshot; fi
  grep -q '^loop: done' "$OUT/screenshot.log" || fail screenshot
  local shot
  for shot in loop-page3 loop-done; do [[ -f "$OUT/$shot.png" ]] || fail screenshot; done
  cp "$OUT/loop-done.png" "$OUT/screenshot.png"
  echo "loop: screenshots loop-page3.png loop-done.png in $OUT"
  grep -E '^loop: (done|settled)' "$OUT/screenshot.log" | sed 's/^/loop: windowed /'
}

# drop: 2.0.4.2's film of the finished JOHNNY dropped 2 cm (`--assembled`). Frames are the
# project's viewport size (1152x648); `--resolution` is ignored by the movie writer on 4.7.2.
# Keeps out/shot-<s>s.png for each of SHOT_SECONDS.
stage_drop() {
  rm -f "$OUT"/frame*.png "$OUT"/shot-*.png
  local last_s="${SHOT_SECONDS[${#SHOT_SECONDS[@]}-1]}"
  godot_run drop --path "$ROOT" -s res://main.gd \
    --write-movie "$OUT/frame.png" \
    --fixed-fps "$SHOT_FPS" --quit-after "$(( last_s * SHOT_FPS + 1 ))" -- --assembled || fail drop
  if grep -q 'SCRIPT ERROR' "$OUT/drop.log"; then fail drop; fi
  local sec frame
  for sec in "${SHOT_SECONDS[@]}"; do
    frame="$(printf '%s/frame%08d.png' "$OUT" "$(( sec * SHOT_FPS ))")"
    [[ -f "$frame" ]] || fail drop
    cp "$frame" "$OUT/shot-${sec}s.png"
  done
  rm -f "$OUT"/frame*.png "$OUT/frame.wav"
  echo "loop: drop film $(cd "$OUT" && ls shot-*.png | tr '\n' ' ')in $OUT"
  grep '^stillness:' "$OUT/drop.log" | tail -1 | sed 's/^/loop: windowed /'
}

if (( $# > 0 )); then
  for stage in "$@"; do "stage_$stage"; done
  exit 0
fi

stage_export
stage_version
stage_addons
stage_import
stage_check
stage_test
stage_screenshot
stage_drop
echo "loop: PASS"
