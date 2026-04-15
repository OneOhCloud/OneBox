#!/usr/bin/env bun
/**
 * Build the `tun-service` workspace member and stage it where Tauri can find
 * it both for `cargo tauri dev` and for production bundling.
 *
 * Dev flow (`bun run tauri dev` → `predev`):
 *   `cargo build -p tun-service` produces `src-tauri/target/debug/tun-service.exe`
 *   right next to the dev-mode `one-box.exe`. That's exactly where
 *   `vpn::windows::bundled_service_exe_path()` looks, so no further copying is
 *   needed for dev.
 *
 * Release flow (`bun run tauri build` → `prebuild`, or CI):
 *   Tauri's `externalBin` contract requires the binary to live at
 *   `src-tauri/binaries/<name>-<target-triple>.exe` at bundling time. Tauri
 *   strips the triple suffix when copying into the final installer, so the
 *   runtime-side lookup in the bundled app still finds `tun-service.exe` next
 *   to `one-box.exe`. Detect the rustc host triple via `rustc -vV` and copy
 *   the freshly built release binary into that location.
 *
 * Platform gating: non-Windows hosts exit silently. The Windows service
 * sub-crate is cfg-gated empty on macOS/Linux — there's nothing to build and
 * nothing to bundle.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
    console.log("[build-tun-service] non-Windows host, skip");
    process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const srcTauri = join(repoRoot, "src-tauri");

const releaseFlag = process.argv.includes("--release");
const profileArgs = releaseFlag ? ["--release"] : [];
const profileDir = releaseFlag ? "release" : "debug";

console.log(
    `[build-tun-service] cargo build -p tun-service (${releaseFlag ? "release" : "dev"})`,
);

const build = spawnSync("cargo", ["build", "-p", "tun-service", ...profileArgs], {
    cwd: srcTauri,
    stdio: "inherit",
    shell: true,
});

if (build.status !== 0) {
    console.error(
        `[build-tun-service] cargo build failed with exit code ${build.status}`,
    );
    process.exit(build.status ?? 1);
}

const outPath = join(srcTauri, "target", profileDir, "tun-service.exe");
if (!existsSync(outPath)) {
    console.error(`[build-tun-service] expected binary not found: ${outPath}`);
    process.exit(1);
}

console.log(`[build-tun-service] built ${outPath}`);

// Only stage the target-triple-suffixed copy for release builds. Dev builds
// live in `target/debug/` and are located directly by the runtime, so there's
// nothing extra to do.
if (!releaseFlag) {
    process.exit(0);
}

// Detect the rustc host triple — required by Tauri externalBin naming.
const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8", shell: true });
if (rustc.status !== 0 || !rustc.stdout) {
    console.error("[build-tun-service] failed to run `rustc -vV` to detect host triple");
    process.exit(1);
}
const hostMatch = rustc.stdout.match(/^host:\s*(\S+)$/m);
if (!hostMatch) {
    console.error(
        `[build-tun-service] could not parse host triple from rustc -vV output:\n${rustc.stdout}`,
    );
    process.exit(1);
}
const triple = hostMatch[1];

const binariesDir = join(srcTauri, "binaries");
mkdirSync(binariesDir, { recursive: true });
const stagedPath = join(binariesDir, `tun-service-${triple}.exe`);

copyFileSync(outPath, stagedPath);
console.log(`[build-tun-service] staged → ${stagedPath}`);
