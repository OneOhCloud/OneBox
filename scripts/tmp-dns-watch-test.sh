#!/usr/bin/env bash
# tmp-dns-watch-test.sh — manual-gated verification for the macOS
# SCDynamicStore DNS watcher introduced alongside the ACTIVE_OVERRIDE
# single-slot refactor.
#
# Scope: proves that (a) an external DNS write during TUN triggers an
# automatic re-override, (b) the observed external value is captured as
# the user's latest intent, and (c) on TUN stop the system ends up with
# that captured value, NOT the pre-TUN snapshot and NOT empty.
#
# Per project CLAUDE.md "Workflows that need my hands": manual gates
# alternate with automated sanity checks so a silent failure on the
# operator's side (forgot to click, authorization denied) is caught
# before the next step runs.
#
# Prereqs:
#   - Signed release build of OneBox installed in /Applications
#     (the privileged helper's caller validation rejects `tauri dev`).
#   - Helper already installed (Settings -> Privileged Helper -> Install).
#   - Active primary service is Wi-Fi (adjust SERVICE below if not).
#
# This script is disposable. Delete it once the watcher has shipped.

set -euo pipefail

SERVICE="${ONEBOX_TEST_SERVICE:-Wi-Fi}"
TEST_DNS="1.1.1.1"
LOG_FILE="$HOME/Library/Logs/cloud.oneoh.onebox/OneBox.log"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

gate() {
    local prompt="$1"
    printf '\n\033[1;35m[MANUAL STEP]\033[0m %s\n' "$prompt"
    read -r -p "Confirm done? [y/N] " ans
    case "$ans" in
        y|Y) return 0 ;;
        *) fail "Aborted at gate" ;;
    esac
}

current_dns() {
    networksetup -getdnsservers "$SERVICE" | tr '\n' ' ' | sed 's/ *$//'
}

assert_dns_not() {
    local unexpected="$1"
    local got
    got="$(current_dns)"
    if [[ "$got" == *"$unexpected"* ]]; then
        fail "[$SERVICE] DNS is still '$got' (expected NOT '$unexpected')"
    fi
    ok "[$SERVICE] DNS = '$got'"
}

assert_dns_contains() {
    local expected="$1"
    local got
    got="$(current_dns)"
    if [[ "$got" != *"$expected"* ]]; then
        fail "[$SERVICE] DNS is '$got' (expected to contain '$expected')"
    fi
    ok "[$SERVICE] DNS contains '$expected' (full: '$got')"
}

log_since() {
    local marker_ts="$1"
    awk -v ts="$marker_ts" '$0 >= ts' "$LOG_FILE"
}

say "DNS watcher E2E test — service under test: $SERVICE"
if [[ ! -f "$LOG_FILE" ]]; then
    warn "Log file $LOG_FILE does not exist yet. Step 6 log scrape will be skipped."
fi

PRE_TUN_DNS="$(current_dns)"
say "Step 0 — snapshotted pre-TUN [$SERVICE] DNS: '$PRE_TUN_DNS'"

gate "Open OneBox, set mode to TUN, tap the connect toggle. Wait until UI shows 'connected'."

sleep 2
CURRENT="$(current_dns)"
case "$CURRENT" in
    198.18.*|172.19.*|172.20.*|10.*)
        ok "[$SERVICE] DNS = '$CURRENT' — looks like a TUN gateway IP"
        TUN_GATEWAY="$CURRENT"
        ;;
    *)
        fail "Expected TUN gateway IP on [$SERVICE] after TUN start, got '$CURRENT'. Is the toggle actually on?"
        ;;
esac

MARKER1="$(date '+%Y-%m-%d %H:%M:%S')"
say "Step 2 — external DNS write test"
say "Running: sudo networksetup -setdnsservers $SERVICE $TEST_DNS"
sudo networksetup -setdnsservers "$SERVICE" "$TEST_DNS"
ok "External DNS write submitted"

say "Step 3 — waiting 2s for the watcher to observe + re-override..."
sleep 2
assert_dns_contains "$TUN_GATEWAY"
ok "Watcher re-applied TUN gateway after external write"

if [[ -f "$LOG_FILE" ]]; then
    say "Step 4 — scraping log for [dns-watch] / [dns] apply markers since test start"
    if log_since "$MARKER1" | grep -E '\[dns-watch\] change event|\[dns\] apply: external write detected' >/dev/null; then
        ok "Log shows watcher fired and external-write branch was taken"
    else
        warn "Log does not show expected markers. Recent [dns]/[dns-watch] lines:"
        log_since "$MARKER1" | grep -E '\[dns(-watch)?\]' | tail -20 || true
        warn "Proceeding — log absence is diagnostic but not fatal for the behavioural test."
    fi
fi

gate "Stop TUN mode from OneBox. Wait for UI 'disconnected' state."

sleep 2
say "Step 6 — verifying restore used the LATEST external write ('$TEST_DNS'), not pre-TUN ('$PRE_TUN_DNS')"
AFTER_STOP="$(current_dns)"
if [[ "$AFTER_STOP" == *"$TEST_DNS"* ]]; then
    ok "[$SERVICE] DNS after stop = '$AFTER_STOP' — contains $TEST_DNS as expected"
else
    fail "[$SERVICE] DNS after stop = '$AFTER_STOP' — expected to contain $TEST_DNS (user's latest intent)"
fi

say "Step 7 — probing restored DNS"
if dig "@$TEST_DNS" example.com +time=2 +tries=1 +short >/dev/null 2>&1; then
    ok "dig @$TEST_DNS works — restored DNS is reachable"
else
    warn "dig @$TEST_DNS failed — verify_and_fallback should have kicked in. Check log."
    log_since "$MARKER1" | grep -E '\[dns\] phase 2' | tail -10 || true
fi

say "Cleanup — restoring pre-TUN DNS '$PRE_TUN_DNS' (manual courtesy, not part of the test)"
if [[ "$PRE_TUN_DNS" == "There aren't any DNS Servers"* || -z "$PRE_TUN_DNS" ]]; then
    sudo networksetup -setdnsservers "$SERVICE" empty
    ok "Set [$SERVICE] back to DHCP default"
else
    # shellcheck disable=SC2086
    sudo networksetup -setdnsservers "$SERVICE" $PRE_TUN_DNS
    ok "Set [$SERVICE] back to '$PRE_TUN_DNS'"
fi

say "Test complete. Things this script did NOT verify:"
echo "  - Primary-service switch (Wi-Fi → Ethernet during TUN): requires physical link toggling."
echo "  - verify_and_fallback public-DNS race: requires the captured DNS to be genuinely unreachable."
