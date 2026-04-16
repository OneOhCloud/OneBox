#!/usr/bin/env bash
#
# Sign the prebuilt OneBox privileged helper with the Developer ID Application
# certificate. The embedded Info.plist / Launchd.plist sections must already be
# present — scripts/build-helper.sh takes care of that.
#
# Usage:
#   scripts/sign-helper.sh [path-to-helper-binary]
#
# Defaults to src-tauri/target/helper/cloud.oneoh.onebox.helper.
#
# The signing identity is hard-coded to match the Team ID baked into
# src-tauri/helper/Info.plist (SMAuthorizedClients) and the DR embedded in
# src-tauri/Info.privileged-helper.plist (SMPrivilegedExecutables, merged
# into the main app's Info.plist by Tauri's create_info_plist). Do not
# parameterize it — drift between these three places produces a misleading
# "helper validation failed" error at SMJobBless time that is very hard to
# diagnose.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SIGNING_IDENTITY="Developer ID Application: OneOh Cloud LLC (GN2W3N34TM)"
HELPER_BIN="${1:-$REPO_ROOT/src-tauri/target/helper/cloud.oneoh.onebox.helper}"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "sign-helper.sh: macOS only, skipping" >&2
    exit 0
fi

if [[ ! -f "$HELPER_BIN" ]]; then
    echo "sign-helper.sh: helper binary not found at $HELPER_BIN" >&2
    echo "  run scripts/build-helper.sh first" >&2
    exit 1
fi

# --options runtime + --timestamp are required for Apple notarization to
# accept the helper. --identifier pins the signature to the bundle ID even
# though the helper is a bare Mach-O (no .app wrapper).
codesign \
    --force \
    --sign "$SIGNING_IDENTITY" \
    --identifier "cloud.oneoh.onebox.helper" \
    --options runtime \
    --timestamp \
    "$HELPER_BIN"

echo "Signed helper: $HELPER_BIN"

# Verify the signature and the designated requirement match the hard-coded
# SMAuthorizedClients string inside Info.plist. If Team ID drifts, SMJobBless
# will fail at install time with a misleading "helper validation failed"
# error; catching it here is much easier to diagnose.
codesign --verify --verbose=2 "$HELPER_BIN"
codesign --display --requirements - "$HELPER_BIN" 2>&1 | grep -q "GN2W3N34TM" || {
    echo "sign-helper.sh: designated requirement does not contain Team ID GN2W3N34TM" >&2
    echo "  is the signing identity in the keychain actually from team GN2W3N34TM?" >&2
    exit 1
}

echo "Signature verified, DR contains Team ID GN2W3N34TM"
