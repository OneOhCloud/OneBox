#!/usr/bin/env bash
#
# Build the OneBox privileged helper as a universal (x86_64 + arm64) Mach-O
# binary with the Info.plist and Launchd.plist embedded as __TEXT sections.
# SMJobBless requires both plists to live inside the binary itself; the copies
# on disk are only the source of truth for the embed step.
#
# Output: src-tauri/target/helper/cloud.oneoh.onebox.helper
#
# Verification:
#   otool -s __TEXT __info_plist    <binary>
#   otool -s __TEXT __launchd_plist <binary>
#   codesign -dvvv                  <binary>   (only after sign-helper.sh runs)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER_DIR="$REPO_ROOT/src-tauri/helper"
BUILD_DIR="$REPO_ROOT/src-tauri/target/helper"
LABEL="cloud.oneoh.onebox.helper"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "build-helper.sh: macOS only, skipping" >&2
    exit 0
fi

if ! command -v clang >/dev/null 2>&1; then
    echo "build-helper.sh: clang not found — install Xcode Command Line Tools" >&2
    exit 1
fi

mkdir -p "$BUILD_DIR"

SOURCES=("$HELPER_DIR/Sources/main.m")

build_slice() {
    local arch="$1"
    local target="$2"
    local out="$BUILD_DIR/$LABEL.$arch"

    clang \
        -target "$target" \
        -O2 \
        -fobjc-arc \
        -Wall -Wextra \
        -framework Foundation \
        -framework Security \
        -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist    -Xlinker "$HELPER_DIR/Info.plist" \
        -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __launchd_plist -Xlinker "$HELPER_DIR/Launchd.plist" \
        "${SOURCES[@]}" \
        -o "$out"
}

# arm64 didn't exist before macOS 11, so each slice uses its own minimum.
# The resulting universal binary still runs on 10.15 Intel hosts.
build_slice x86_64 "x86_64-apple-macos10.15"
build_slice arm64  "arm64-apple-macos11.0"

lipo -create \
    "$BUILD_DIR/$LABEL.x86_64" \
    "$BUILD_DIR/$LABEL.arm64" \
    -output "$BUILD_DIR/$LABEL"

rm "$BUILD_DIR/$LABEL.x86_64" "$BUILD_DIR/$LABEL.arm64"

echo "Built universal helper: $BUILD_DIR/$LABEL"

# Sanity: both sections must be present or SMJobBless will refuse to load.
if ! otool -s __TEXT __info_plist "$BUILD_DIR/$LABEL" | grep -q "Contents of"; then
    echo "ERROR: __info_plist section missing from helper binary" >&2
    exit 1
fi
if ! otool -s __TEXT __launchd_plist "$BUILD_DIR/$LABEL" | grep -q "Contents of"; then
    echo "ERROR: __launchd_plist section missing from helper binary" >&2
    exit 1
fi

echo "  __TEXT,__info_plist    embedded"
echo "  __TEXT,__launchd_plist embedded"
