#!/usr/bin/env bash
# tmp-test-helper-upgrade.sh — manual-gated verification for the XPC
# "stale connection after SMJobBless" fix landed in
# src-tauri/src/engine/macos/helper.m (onebox_helper_install now calls
# `[[OneBoxHelperClient sharedClient] invalidate]` on the success path).
#
# Background: NSXPCConnection is cached as a process-lifetime singleton.
# SMJobBless atomically replaces the helper binary; the old mach port is
# destroyed and the OS fires `invalidationHandler` asynchronously on an
# XPC private queue. A caller that runs between SMJobBless's return and
# the handler's dispatch receives the stale cached connection and its
# first proxy call fails with "Couldn't communicate with a helper
# application." Observed in production as the first DNS apply after a
# helper upgrade failing exactly once.
#
# Per project CLAUDE.md §11 "Workflows that need my hands": manual gates
# alternate with automated sanity checks so a silent failure on the
# operator's side (forgot to click, authorization denied) is caught
# before the next step runs.
#
# Modes
#   default (MODE=fresh):
#       Regression test for the fresh-install path. Removes the installed
#       helper, lets the user launch OneBox, verifies SMJobBless fires and
#       no 'xpc error: Couldn't communicate' appears on the DNS apply.
#       NOTE: on fresh install the cached _connection is nil when
#       `invalidate` runs, so the explicit invalidate is a no-op and the
#       '[client] XPC connection invalidated' marker will NOT appear.
#       This mode proves "no regression", not "fix works".
#
#   MODE=upgrade ONEBOX_OLD_HELPER=/path/to/old-helper:
#       True upgrade path. Installs an older signed helper binary first
#       (must be signed with the same identity as the current build),
#       has the user launch OneBox briefly to establish an XPC connection,
#       then upgrades to the current bundled helper. Verifies:
#         (a) [client] XPC connection invalidated appears right after
#             SMJobBless success (our new explicit invalidate),
#         (b) the subsequent DNS apply succeeds without the xpc error.
#
# Prereqs:
#   - Signed release build of OneBox installed in /Applications
#     (SMJobBless requires a signed app; `tauri dev` won't work).
#   - For MODE=upgrade: an older OneBox.app helper binary with a
#     CFBundleVersion textually different from the current bundled one.
#
# This script is disposable. Delete it once the fix has been merged and
# a release has shipped with a version bump that exercises the upgrade
# path in the wild.

set -euo pipefail

MODE="${MODE:-fresh}"
HELPER_LABEL="cloud.oneoh.onebox.helper"
HELPER_PATH="/Library/PrivilegedHelperTools/${HELPER_LABEL}"
LAUNCHD_PLIST="/Library/LaunchDaemons/${HELPER_LABEL}.plist"
APP_BUNDLE="/Applications/OneBox.app"
BUNDLED_HELPER="${APP_BUNDLE}/Contents/Library/LaunchServices/${HELPER_LABEL}"
LOG_FILE="$HOME/Library/Logs/cloud.oneoh.onebox/OneBox.log"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

gate() {
    local prompt="$1"
    printf '\n\033[1;35m[MANUAL STEP]\033[0m %s\n' "$prompt"
    read -r -p "Confirm done? [y/N] " ans
    case "$ans" in
        y|Y) return 0 ;;
        *) fail "Aborted at gate" ;;
    esac
}

log_since() {
    local marker_ts="$1"
    [[ -f "$LOG_FILE" ]] || return 0
    awk -v ts="$marker_ts" '$0 >= ts' "$LOG_FILE"
}

extract_cfbundle_version() {
    # Scrape CFBundleVersion from a helper binary's embedded __info_plist
    # section. Matches what ensure_helper_installed does in Rust.
    local bin="$1"
    [[ -f "$bin" ]] || { echo ""; return 0; }
    otool -s __TEXT __info_plist "$bin" 2>/dev/null \
        | xxd -r -p 2>/dev/null \
        | plutil -extract CFBundleVersion raw -o - - 2>/dev/null \
        || echo ""
}

require_app_bundle() {
    [[ -d "$APP_BUNDLE" ]] || fail "OneBox.app not found at $APP_BUNDLE"
    [[ -f "$BUNDLED_HELPER" ]] || fail "Bundled helper not found at $BUNDLED_HELPER"
    local v
    v="$(extract_cfbundle_version "$BUNDLED_HELPER")"
    [[ -n "$v" ]] || fail "Cannot read CFBundleVersion from bundled helper"
    ok "Bundled helper CFBundleVersion = '$v'"
    echo "$v"
}

quit_onebox_if_running() {
    if pgrep -x OneBox >/dev/null 2>&1; then
        gate "OneBox is running. Quit it (⌘Q or tray → Quit) so the next launch is a true cold start."
        if pgrep -x OneBox >/dev/null 2>&1; then
            fail "OneBox still running after gate"
        fi
        ok "OneBox is not running"
    fi
}

remove_installed_helper() {
    say "Removing installed helper (launchd unload + file rm)"
    sudo launchctl bootout "system/${HELPER_LABEL}" 2>/dev/null || true
    sudo rm -f "$HELPER_PATH"
    sudo rm -f "$LAUNCHD_PLIST"
    [[ ! -e "$HELPER_PATH" ]] || fail "Helper still present at $HELPER_PATH after removal"
    [[ ! -e "$LAUNCHD_PLIST" ]] || fail "Launchd plist still present at $LAUNCHD_PLIST"
    ok "Helper removed cleanly"
}

assert_helper_registered() {
    if ! sudo launchctl print "system/${HELPER_LABEL}" >/dev/null 2>&1; then
        fail "Helper not registered in launchd after SMJobBless"
    fi
    ok "Helper registered in launchd"
    local v
    v="$(extract_cfbundle_version "$HELPER_PATH")"
    ok "Installed helper CFBundleVersion = '$v'"
}

assert_no_xpc_error_on_dns() {
    local marker_ts="$1"
    local slice
    slice="$(log_since "$marker_ts")"
    if grep -q "apply_system_dns_override failed: xpc error" <<<"$slice"; then
        warn "XPC error still present — regression. Relevant lines:"
        grep -E "apply_system_dns_override|xpc error|\[client\]|SMJobBless|CFBundleVersion" <<<"$slice" | tail -30 || true
        fail "DNS apply hit the stale-connection error"
    fi
    ok "No 'Couldn't communicate' XPC error on DNS apply path"
}

assert_invalidate_log_present() {
    local marker_ts="$1"
    local slice
    slice="$(log_since "$marker_ts")"
    if grep -q "\[client\] XPC connection invalidated" <<<"$slice"; then
        ok "'[client] XPC connection invalidated' marker present (explicit invalidate exercised)"
    else
        warn "'[client] XPC connection invalidated' marker NOT found."
        warn "Expected on MODE=upgrade because a live connection existed before SMJobBless."
        warn "Recent [client]/[helper] lines:"
        grep -E '\[client\]|\[helper\]' <<<"$slice" | tail -20 || true
        fail "Invalidate path not exercised — check the fix"
    fi
}

assert_smjobbless_fired() {
    local marker_ts="$1"
    local slice
    slice="$(log_since "$marker_ts")"
    if ! grep -qE "upgrading via SMJobBless|installing via SMJobBless|CFBundleVersion bundled=" <<<"$slice"; then
        warn "No SMJobBless marker in log slice. Recent [helper] lines:"
        grep -E '\[helper\]' <<<"$slice" | tail -20 || true
        fail "ensure_helper_installed did not hit the SMJobBless path — test inconclusive"
    fi
    ok "SMJobBless path triggered"
}

case "$MODE" in
    fresh|upgrade) ;;
    *) fail "Unknown MODE='$MODE' — use 'fresh' (default) or 'upgrade'" ;;
esac

say "Mode: $MODE"
BUNDLED_VERSION="$(require_app_bundle)"
quit_onebox_if_running

if [[ "$MODE" == "upgrade" ]]; then
    OLD_HELPER="${ONEBOX_OLD_HELPER:-}"
    [[ -n "$OLD_HELPER" ]] || fail "MODE=upgrade requires ONEBOX_OLD_HELPER=/path/to/old-helper"
    [[ -f "$OLD_HELPER" ]] || fail "Old helper not found: $OLD_HELPER"
    OLD_VERSION="$(extract_cfbundle_version "$OLD_HELPER")"
    [[ -n "$OLD_VERSION" ]] || fail "Cannot read CFBundleVersion from old helper"
    [[ "$OLD_VERSION" != "$BUNDLED_VERSION" ]] || fail \
        "Old helper CFBundleVersion '$OLD_VERSION' equals bundled '$BUNDLED_VERSION' — need a different version"
    ok "Old helper CFBundleVersion = '$OLD_VERSION' (bundled = '$BUNDLED_VERSION')"

    # Verify old helper is signed — SMJobBless rejects unsigned binaries.
    if ! codesign -v "$OLD_HELPER" 2>/dev/null; then
        fail "Old helper failed codesign -v — must be signed with same identity as current build"
    fi
    ok "Old helper signature valid"

    remove_installed_helper

    say "Installing old helper directly (bypassing SMJobBless for setup)"
    sudo cp "$OLD_HELPER" "$HELPER_PATH"
    sudo chown root:wheel "$HELPER_PATH"
    sudo chmod 544 "$HELPER_PATH"

    # Generate a minimal launchd plist matching what SMJobBless would produce.
    # The bundled helper's own Launchd.plist is the source of truth — copy
    # it from the old helper's neighbour if present, else from the bundled.
    SRC_LAUNCHD="$(dirname "$OLD_HELPER")/Launchd.plist"
    [[ -f "$SRC_LAUNCHD" ]] || SRC_LAUNCHD="$(dirname "$BUNDLED_HELPER")/Launchd.plist"
    [[ -f "$SRC_LAUNCHD" ]] || fail "Cannot locate a Launchd.plist to seed $LAUNCHD_PLIST"
    sudo cp "$SRC_LAUNCHD" "$LAUNCHD_PLIST"
    sudo chown root:wheel "$LAUNCHD_PLIST"
    sudo chmod 644 "$LAUNCHD_PLIST"
    sudo launchctl bootstrap system "$LAUNCHD_PLIST"
    assert_helper_registered

    gate "Launch OneBox. The version check should see installed='$OLD_VERSION' == nothing to do (wait — bundled='$BUNDLED_VERSION' ≠ '$OLD_VERSION', so an SMJobBless UPGRADE prompt WILL appear). Click Install Helper + authenticate. Then in OneBox, switch mode to TUN and toggle connect."

    MARKER="$(date '+%Y-%m-%d %H:%M:%S')"
    sleep 1
    # Give the log a moment to flush the SMJobBless + DNS apply lines.
    say "Waiting 6s for SMJobBless + DNS apply to land in the log..."
    sleep 6

    assert_smjobbless_fired "$MARKER"
    assert_invalidate_log_present "$MARKER"
    assert_no_xpc_error_on_dns "$MARKER"

    say "UPGRADE PATH: PASS — the explicit invalidate ran and DNS apply did not error"

else
    # MODE=fresh
    remove_installed_helper

    MARKER="$(date '+%Y-%m-%d %H:%M:%S')"
    gate "Launch OneBox. macOS will prompt 'OneBox wants to install a helper tool' — click Install Helper and authenticate. Then in OneBox, switch mode to TUN and toggle connect."

    sleep 1
    say "Waiting 6s for SMJobBless + DNS apply to land in the log..."
    sleep 6

    assert_helper_registered
    assert_smjobbless_fired "$MARKER"
    assert_no_xpc_error_on_dns "$MARKER"

    # On fresh install, the explicit invalidate sees a nil _connection and is a
    # no-op — the '[client] XPC connection invalidated' marker will NOT appear.
    # We only assert on the upgrade path. Report observed state for info.
    if log_since "$MARKER" | grep -q "\[client\] XPC connection invalidated"; then
        warn "'[client] XPC connection invalidated' appeared on a fresh install."
        warn "This is unexpected — on fresh install _connection should be nil when invalidate runs."
        warn "Likely means something called into the helper before onebox_helper_install (e.g. a ping)."
        warn "Not a failure, but worth a note."
    else
        ok "No invalidate-log line (expected on fresh install — _connection was nil)"
    fi

    say "FRESH-INSTALL PATH: PASS — no regression from the invalidate addition"
fi

cat <<'EOF'

Not verified automatically by this script:
  - macOS-13+ SMAppService migration path (this script tests SMJobBless only).
  - The invalidationHandler actually firing async after our explicit
    invalidate returns — only observable via os_log from XPC itself, not
    in OneBox.log. The fix bypasses the race by invalidating synchronously,
    so the async handler is no longer load-bearing.

If MODE=fresh passed but you want to exercise the true upgrade path,
re-run with:
  MODE=upgrade ONEBOX_OLD_HELPER=/path/to/older/cloud.oneoh.onebox.helper \
      scripts/tmp-test-helper-upgrade.sh
EOF
