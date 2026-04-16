#!/usr/bin/env bash
#
# Invoked by Tauri's `build.beforeBundleCommand`. Runs after the Rust binary
# is compiled but before the .app is assembled — exactly the window where we
# need the privileged helper binary to already exist, signed and ready, so
# that `copy_custom_files_to_bundle` (app.rs:105) can pick it up and place it
# at Contents/Library/LaunchServices/ before Tauri's own sign pass.
#
# macOS only: on other platforms this is a no-op. The build-helper.sh and
# sign-helper.sh scripts themselves also no-op on non-Darwin, but checking
# here avoids spawning an extra process on every Linux/Windows build.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$SCRIPT_DIR/build-helper.sh"
"$SCRIPT_DIR/sign-helper.sh"
