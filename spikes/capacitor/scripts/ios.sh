#!/bin/sh
# Engine spike 1.2 (branch-local): the phone loop from the command line — no Xcode clicks.
#
#   scripts/ios.sh build     root web build → cap sync ios → xcodebuild (Apple Development signing)
#   scripts/ios.sh install   xcrun devicectl install of the built .app on the attached iPhone
#   scripts/ios.sh launch    xcrun devicectl launch of the installed app
#   scripts/ios.sh all       build, install, launch — and time each
#   scripts/ios.sh sim       simulator build → boot → install → launch (no signing, no phone)
#   scripts/ios.sh testflight  web build → archive → export (App Store Connect) → altool upload
#
# Env: SKRUV_TEAM (signing team, default the Apple Development team on this host),
# SKRUV_DEVICE (devicectl device id/name; default the first available paired iPhone),
# CAP_LIVE_URL (see capacitor.config.ts: shell loads the Vite dev server instead of the bundle),
# SKRUV_SIM (simulator name for `sim`, default "iPhone 17 Pro"),
# SKRUV_UNSIGNED=1 (compile-only device build, no signing — proves the chain without an account),
# SKRUV_ASC_KEY_ID + SKRUV_ASC_ISSUER (App Store Connect API key for `testflight`; the .p8 lives at
# ~/.appstoreconnect/private_keys/AuthKey_<id>.p8 and never enters the repo).
set -eu
cd "$(dirname "$0")/.."

TEAM="${SKRUV_TEAM:-P48A4S4YXT}"
BUNDLE_ID=site.skruv.capacitor
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

testflight() {
  : "${SKRUV_ASC_KEY_ID:?set SKRUV_ASC_KEY_ID}" "${SKRUV_ASC_ISSUER:?set SKRUV_ASC_ISSUER}"
  key="$HOME/.appstoreconnect/private_keys/AuthKey_$SKRUV_ASC_KEY_ID.p8"
  auth="-authenticationKeyPath $key -authenticationKeyID $SKRUV_ASC_KEY_ID -authenticationKeyIssuerID $SKRUV_ASC_ISSUER"
  archive=build/App.xcarchive
  export_dir=build/export
  # Every upload needs a build number above the last one: minutes since 2026-01-01 (UTC).
  build_number=$(( ($(date -u +%s) - 1767225600) / 60 ))
  step "web build + cap sync" npm run sync
  # Archive unsigned; the export signs with the cloud-managed distribution certificate through
  # the API key — so a fresh CI runner needs no .p12 or profile, and local runs take the same path.
  step "xcodebuild archive" xcodebuild -quiet \
    -project ios/App/App.xcodeproj -scheme App -configuration "$CONFIG" \
    -destination 'generic/platform=iOS' -archivePath "$archive" \
    DEVELOPMENT_TEAM="$TEAM" CODE_SIGNING_ALLOWED=NO PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    CURRENT_PROJECT_VERSION="$build_number" \
    archive
  cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM</string>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST
  rm -rf "$export_dir"
  # shellcheck disable=SC2086 # $auth is a flag list
  step "xcodebuild export" xcodebuild -quiet -exportArchive \
    -archivePath "$archive" -exportPath "$export_dir" -exportOptionsPlist build/ExportOptions.plist \
    -allowProvisioningUpdates $auth
  step "altool upload" xcrun altool --upload-app --type ios --file "$export_dir/App.ipa" \
    --apiKey "$SKRUV_ASC_KEY_ID" --apiIssuer "$SKRUV_ASC_ISSUER"
  echo "uploaded build $build_number of $BUNDLE_ID — TestFlight lists it once Apple finishes processing"
}

case "${1:-}" in
  build) build ;;
  install) install ;;
  launch) launch ;;
  all) build; install; launch ;;
  sim) sim ;;
  testflight) testflight ;;
  *) echo "usage: $0 build|install|launch|all|sim|testflight" >&2; exit 2 ;;
esac
