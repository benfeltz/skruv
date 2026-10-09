#!/bin/sh
# Engine spike 1.2 (branch-local): the phone loop from the command line — no Xcode clicks.
#
#   scripts/ios.sh build     root web build → cap sync ios → xcodebuild (Apple Development signing)
#   scripts/ios.sh install   xcrun devicectl install of the built .app on the attached iPhone
#   scripts/ios.sh launch    xcrun devicectl launch of the installed app
#   scripts/ios.sh all       build, install, launch — and time each
#   scripts/ios.sh sim       simulator build → boot → install → launch (no signing, no phone)
#
# Env: SKRUV_TEAM (signing team, default the Apple Development team on this host),
# SKRUV_DEVICE (devicectl device id/name; default the first available paired iPhone),
# CAP_LIVE_URL (see capacitor.config.ts: shell loads the Vite dev server instead of the bundle),
# SKRUV_SIM (simulator name for `sim`, default "iPhone 17 Pro"),
# SKRUV_UNSIGNED=1 (compile-only device build, no signing — proves the chain without an account).
set -eu
cd "$(dirname "$0")/.."

TEAM="${SKRUV_TEAM:-P48A4S4YXT}"
BUNDLE_ID=site.skruv.spike
CONFIG=Release
DERIVED=build/DerivedData
APP="$DERIVED/Build/Products/$CONFIG-iphoneos/App.app"

device() {
  if [ -n "${SKRUV_DEVICE:-}" ]; then echo "$SKRUV_DEVICE"; return; fi
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices
      .find((x) => x.hardwareProperties?.platform === "iOS" && x.connectionProperties?.pairingState === "paired" && x.connectionProperties?.tunnelState !== "unavailable");
    if (!d) { console.error("no paired iPhone available — plug it in / unlock it"); process.exit(1); }
    console.log(d.identifier);' "$json"
  rm -f "$json"
}

step() {
  label="$1"; shift
  start=$(date +%s)
  "$@"
  echo "⏱  $label: $(( $(date +%s) - start )) s"
}

build() {
  step "web build + cap sync" npm run sync
  if [ -n "${SKRUV_UNSIGNED:-}" ]; then signing="CODE_SIGNING_ALLOWED=NO"; else signing="CODE_SIGN_STYLE=Automatic"; fi
  step "xcodebuild" xcodebuild -quiet \
    -project ios/App/App.xcodeproj -scheme App -configuration "$CONFIG" \
    -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" "$signing" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    build
  echo "built $APP ($(du -sh "$APP" | cut -f1))"
}

install() { step "devicectl install" xcrun devicectl device install app --device "$(device)" "$APP"; }
launch() { step "devicectl launch" xcrun devicectl device process launch --terminate-existing --device "$(device)" "$BUNDLE_ID"; }

sim() {
  name="${SKRUV_SIM:-iPhone 17 Pro}"
  step "web build + cap sync" npm run sync
  step "xcodebuild (simulator)" xcodebuild -quiet \
    -project ios/App/App.xcodeproj -scheme App -configuration "$CONFIG" \
    -destination "platform=iOS Simulator,name=$name" -derivedDataPath "$DERIVED" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" build
  xcrun simctl boot "$name" 2>/dev/null || true
  step "simctl install" xcrun simctl install "$name" "$DERIVED/Build/Products/$CONFIG-iphonesimulator/App.app"
  step "simctl launch" xcrun simctl launch --terminate-running-process "$name" "$BUNDLE_ID"
}

case "${1:-}" in
  build) build ;;
  install) install ;;
  launch) launch ;;
  all) build; install; launch ;;
  sim) sim ;;
  *) echo "usage: $0 build|install|launch|all|sim" >&2; exit 2 ;;
esac
