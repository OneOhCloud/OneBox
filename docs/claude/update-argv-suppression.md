# Update-driven relaunch: deep-link argv suppression

> **Claude-facing, not human-facing.** Optimised for Claude execution; see [`README.md`](README.md) for directory-wide conventions (preamble shape, `Do not X` framing, file:line style). Read when touching `src-tauri/src/app/setup.rs` deep-link handling, `src/components/settings/updater*.tsx`, or `src/utils/update.ts`. Paths are repo-relative; if anything here disagrees with the code, trust the code and update this file.

`tauri-plugin-updater` on Windows (NSIS) and on macOS/Linux (via `tauri::process::restart`) forwards the current process's `argv` to the freshly-installed binary when it relaunches. Concretely, the NSIS installer is invoked with `/ARGS <original-argv>` so the new exe boots with the same command line as the one being replaced. `tauri-plugin-deep-link::handle_cli_arguments` runs at plugin-init time on Windows/Linux and populates its `current` URL slot from argv — so an app originally launched via `onebox-networktools://config?...&apply=1` will see the URL back in argv on every update-relaunch. Without a guard, the post-update cold-start path in `app/setup.rs` re-imports + re-applies the original payload.

## Mechanism

- JS side, immediately before `updateInfo.install()`, writes `{ at: Date.now() }` to the `update_suppress_argv_deeplink_at` key in the settings store (`src/utils/update.ts::markPendingUpdateRelaunch`, called from both `updater.tsx` and `updater-button.tsx`).
- Rust side, in the cold-start Windows/Linux argv branch of `app/setup.rs`, reads + `delete`s the key (both best-effort). If the read returned a timestamp within `UPDATE_SUPPRESS_TTL_MS` of now, the argv-carried deep link is discarded. Otherwise it's processed normally.
- TTL is 5 minutes. NSIS install → relaunch finishes in seconds in practice, so the TTL is a safety net for the "install crashed after writing the marker but before relaunching" scenario.

### Store-load pitfall (historical)

`tauri-plugin-store` exposes two readers: `app.get_store(path)` returns `Some` **only if the store is already loaded** into the in-process collection; `app.store(path)` loads from disk on first call. On a post-update cold-start the webview hasn't initialised yet, so no JS has touched the store — `get_store` returns `None` and the suppression silently no-ops. The marker on disk is ignored and the NSIS-replayed argv URL re-imports. The reader MUST be `app.store("settings.json")`. Loading the file is still a pure read with respect to `UPDATE_SUPPRESS_KEY` — the closed-write-path invariant is about *writing the key*, not about whether the backing file materialises.

### Triage markers

Every cold-start decision emits one `[update-suppress]` info line with the branch taken, so failures are greppable without re-reading source:

- `[update-suppress] no marker present → not suppressing` — JS never wrote the marker (user launched via a genuine deep-link click, or the update path didn't call `markPendingUpdateRelaunch`).
- `[update-suppress] marker age={N}ms < ttl=300000ms → suppressing argv deep link` — normal successful suppression.
- `[update-suppress] marker age={N}ms ≥ ttl=300000ms → not suppressing (stale residue)` — marker is older than the TTL; treated as residue from a failed install and cleared. Deep link processed normally.
- `[update-suppress] marker malformed (no u64 \`at\`) → not suppressing` — write path wrote a shape we don't recognise; investigate `markPendingUpdateRelaunch`.
- `[update-suppress] failed to load settings.json, not suppressing: …` — disk/permissions issue; after this line the re-import will fire.

Triage recipe for "deep link re-imports after update":

| Symptom | grep | Meaning |
|---|---|---|
| No `[update-suppress]` at all on cold-start | `grep '\[update-suppress\]' OneBox.log` | The cold-start `get_current` branch didn't fire — argv URL wasn't captured. Check `Cold-start deep link config data` / the plugin-init argv path. |
| `no marker present` | — | JS never wrote the marker. Check the update call path in `updater.tsx` / `updater-button.tsx` did call `markPendingUpdateRelaunch` (must be awaited before `install()`). |
| `marker age ≥ ttl` | — | Install took > 5 min, or the marker survived across an unrelated restart. Investigate the delta between marker write and cold-start timestamp. |
| `failed to load settings.json` | — | Store file path resolution / permissions. Check `resolve_store_path` behaviour in the plugin. |

## Critical invariants

Breaking either one makes the suppression mechanism silently wrong:

1. **Closed write path.** `markPendingUpdateRelaunch` is the **only** code that ever writes this key. Rust's read path **must not** re-write it. If a future change adds a second writer, the mental model collapses and the suppression can fire in unrelated flows.
2. **Never extend the TTL.** The whole point of the timestamp is that it **ages out**. A stuck marker must self-heal within `UPDATE_SUPPRESS_TTL_MS`. Don't add "refresh on read", don't extend the TTL to hours, don't add a bool-equivalent that never expires. If the read path's `delete` fails (store locked, disk full, process killed mid-save), the TTL is the only thing preventing permanent deep-link death — and deep links failing silently is considered more fatal than a single accidental re-import.

## What about macOS?

macOS deep links don't go through argv — they're delivered via the Cocoa `application:openURLs:` delegate and only appear through `on_open_url`. So the `#[cfg(any(windows, target_os = "linux"))]` gate matches exactly the platforms where the argv-replay bug exists. macOS never needs to write or read this key.

## Files

- `src/types/definition.ts` — `UPDATE_SUPPRESS_ARGV_DEEPLINK_AT_KEY` constant.
- `src/utils/update.ts` — `markPendingUpdateRelaunch`.
- `src/components/settings/updater.tsx`, `src/components/settings/updater-button.tsx` — call sites (always immediately before `updateInfo.install()`).
- `src-tauri/src/app/setup.rs` — `should_suppress_argv_deeplink` (impure, touches the store), `decide_suppress_argv_deeplink` (pure helper, unit-tested), `SuppressDecision`, `UPDATE_SUPPRESS_KEY`, `UPDATE_SUPPRESS_TTL_MS`, call site inside the cold-start `get_current` branch.
