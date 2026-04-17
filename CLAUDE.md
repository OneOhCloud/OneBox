# OneBox — Project Notes for Claude

## UI terminology: never say "subscription" / "订阅"

All user-facing copy — i18n values, toast text, placeholders, labels,
button captions, aria-labels, fallback names shown in a list — must use
**"配置"** (Chinese) and **"Config"** (English) when referring to the
user's saved server configurations. Avoid every variant of:

- `订阅` / `订阅管理` / `订阅列表` / `订阅链接` / `订阅文件`
- `配置文件` (use the shorter `配置` instead)
- `subscription` / `subscriptions` / `Subscription(s)`

Rule of thumb: shortest possible term wins. `配置` (2 chars) beats
`配置文件` (4 chars) beats `订阅配置` (4 chars). English: `Config`
beats `Configuration` beats `Subscription`.

Why: the product is a local config store for sing-box server profiles,
not a SaaS subscription service. The word "subscription" misleads new
users into expecting billing / renewal / account flows that don't
exist. Calling it a `配置` / `Config` tells users what it actually is.

This only governs **display text**. Code identifiers can keep legacy
names (`addSubscription`, `GET_SUBSCRIPTIONS_LIST_SWR_KEY`, i18n
keys like `add_subscription`) to avoid a disruptive rename. Values
the user reads on screen must use the new vocabulary.

## Reading third-party source

Several moving parts in this project come from code we don't own: `sing-box`,
the Tauri 2 CLI / bundler, `tauri-action`, `onebox-lifecycle`, etc. Whenever
a question can only be answered by reading one of those — *how* does Tauri
assemble the .app bundle, *when* does the bundler sign vs. notarize, *what*
does `beforeBundleCommand` run against — **clone the upstream repo at the
exact version we use, then read from the checkout**. Do not rely on web
search, blog posts, or GitHub's web UI: they lose surrounding context and
often point at the wrong branch for the version we're on.

Scratch location: `/tmp/src-probe/<name>` or `~/src/`. The clone is
disposable and must not be added to this repo. Use `git clone --depth=1
--branch <tag>` (or `--branch v<ver>`) to match the pinned version in
`Cargo.lock` / `package.json`.

This is a project-specific reminder of the global
`Problem Analysis Priority Order` rule in `~/.claude/CLAUDE.md`.

## Deep link bug triage: read logs before code

Runtime log directory on macOS: `~/Library/Logs/cloud.oneoh.onebox/OneBox.log`
(Linux `~/.config/cloud.oneoh.onebox/logs/`, Windows
`%APPDATA%\cloud.oneoh.onebox\logs\`). For **any** deep-link-related
report — "doesn't auto-import", "opens the app but does nothing",
"sometimes works, sometimes doesn't" — open this file **before** reading
Rust or TS source.

Key log markers produced by `src-tauri/src/app/setup.rs`:

- `Received deep link: [Url { ... }]` — `on_open_url` fired, hot-start path.
- `Cold-start deep link config data: ... apply=<bool>` — Windows/Linux
  cold-start fallback (`deep_link().get_current()` caught a URL that
  `on_open_url` missed because the plugin delivered before registration).
- `Received config data: <base64> apply=<bool>` — payload parsed OK.

What the log tells you that source cannot:

1. **Did Rust even see the URL?** If `Received deep link` is absent, the
   problem is on the OS / plugin side, not in OneBox's TS/apply logic.
2. **Timing vs. app startup.** Compare the deep-link timestamp to
   `Copying database files`, `User-Agent:`, and `captive.oneoh.cloud
   status:` — these mark `app_setup()` progress. A deep link arriving
   *before* the webview is ready is a different bug from one arriving
   after.
3. **Hot-start vs. cold-start.** An `[engine-state] ... (epoch=N)` line
   immediately before the deep link means the app was already running
   (hot start). Absence of any prior state line plus presence of
   `Copying database files` right above means cold start — and cold-start
   first-install is the scenario most likely to race the frontend's
   `listen('deep_link_pending', ...)` registration.

If the user reports a failure case but the log doesn't contain the
failure reproduction, **ask them to reproduce and attach fresh logs**
before speculating on the fix. The source code has several plausible
race windows; the log pins down which one is actually firing.

## Frontend: respect the Tailwind / linter hints

We use Tailwind v4 (dynamic spacing via `--spacing`, default 4px/unit) plus
the `tailwindcss-intellisense` extension. When the extension emits a
`suggestCanonicalClasses` hint ("The class `w-[22px]` can be written as
`w-5.5`"), **take it** rather than leaving the arbitrary bracket form in
place. Reasons:

- Arbitrary values (`w-[22px]`, `left-[11px]`) bypass the theme scale and
  are harder to refactor later.
- The canonical form (`w-5.5`, `left-2.75`) participates in the spacing
  theme — if we ever change `--spacing`, the layout scales uniformly.
- Reviewers and future contributors expect the canonical form, and a
  mixed style makes diffs noisier.

Rule of thumb: if the pixel value is an integer multiple of `--spacing`
(4px by default), use the canonical class. Examples:

| Arbitrary      | Canonical   |
|----------------|-------------|
| `w-[22px]`     | `w-5.5`     |
| `h-[22px]`     | `h-5.5`     |
| `left-[11px]`  | `left-2.75` |
| `min-h-[24px]` | `min-h-6`   |

Keep the arbitrary form only when the value doesn't fit the spacing
scale (e.g. `text-[10px]` — default text sizes start at `text-xs` = 12px)
or when the property has no theme-backed canonical form
(`tracking-[0.22em]`, custom `shadow-[…]` with multi-parameter values).

The same principle extends to every Tailwind-IntelliSense severity-4
hint (unnecessary negative modifier, deprecated class, unknown-modifier
reorder, etc.) — treat them as review-ready lints, not suggestions to
ignore.

## Release workflow triggers

All four release channels (dev, beta, stable, manual) are served by a **single workflow**: `release.yml`. It is triggered by:

1. A `push` that modifies `src-tauri/tauri.conf.json` on the channel's own branch (dev: `feature/dev`, beta: `feature/beta`, stable: `main`), or
2. A manual `workflow_dispatch` from the Actions tab, where the operator picks the channel.

The workflow's `resolve` job maps the trigger to a channel, then derives all channel-specific parameters (tag name, prerelease flag, template branch, etc.). Beta and stable have a `check-reuse` job that can skip the full build by copying artifacts from the upstream channel (dev→beta, beta→stable) when the version matches.

Do **not** split this back into per-channel workflow files. The earlier multi-file design wasted GitHub Actions cache (each workflow had its own Rust cache namespace) and required every build-step change to be replicated four times. Do **not** chain releases with `workflow_run` triggers — an earlier design caused an automatic dev→beta→stable cascade on every dev push. If you see a reason to re-introduce either pattern, treat it as a design change that needs explicit discussion, not a "missing feature" to patch back in.

The canonical way to cut a release on any channel is `make bump` on that channel's branch, then push. Nothing else.

## GitHub CLI access: use `gh` freely for history and CI diagnostics

I have **full write permissions on `OneOhCloud/OneBox`** via the `gh`
CLI already configured on this host. Before guessing at CI behaviour,
cache state, past failures, or commit history, query it directly. The
answers are one command away and dramatically better than speculation.

Routinely useful invocations:

```bash
gh run list --limit 10 --workflow=release.yml
gh run view <run-id> --json jobs -q '.jobs[] | {name, conclusion, status}'
gh api repos/OneOhCloud/OneBox/actions/jobs/<job-id>/logs | grep -i cache
gh cache list --sort created_at --order desc --json id,key,ref,sizeInBytes
gh workflow run release.yml -r feature/dev -f channel=dev
gh pr list --state=all --limit 20
gh issue view <n> --json title,body,comments
```

No GitHub MCP server is installed on this host (only Gmail / Drive /
Calendar MCPs are registered). `gh` covers every CI and repo-diagnostic
need `gh api` can reach, and is the preferred interface for this repo.

## Verifying Linux from a macOS host: never commit just to transport

When you need to check whether a local change compiles / behaves correctly
on Linux, **do not commit + push + pull** just to move the code onto the
Linux VM. That pollutes the git history with "fix typo", "re-add missing
import" churn that shouldn't exist as commits. Commits are for finished
work, not transport.

Use `make linux-check` instead (wraps `scripts/linux-check.sh`). The
script:

1. `ssh`s into the Linux VM (default `root@100.91.1.95`; override with
   `ONEBOX_LINUX_VM=user@host`). If the VM is unreachable it prints a
   note asking me to start the VM manually and exits — **never try to
   guess the VM's up state or attempt to boot it automatically**, I have
   a snapshot and will start it.
2. `git fetch` + `git checkout --detach <local HEAD>` on the VM so the
   committed baseline matches local.
3. Pipes `git diff HEAD --binary` through `git apply` on the VM so
   whatever WIP I have in the working tree lands without a commit.
4. Runs `cargo check` on the VM and tails the output.

A second invocation re-runs cleanly because step 2 starts with
`git reset --hard HEAD` to unwind the previous patch.

If you discover a real bug during a linux-check round, fold the fix into
the **same** working-tree diff and rerun `make linux-check` until it's
green. Only then, commit once with the final change.

The same principle applies if a Windows VM gets added later — add
`make windows-check` that patch-transports the same way.

## Workflows that need my hands: ask, don't guess

Some test / verification flows in this project cannot be fully automated by
the assistant, because they require GUI interaction, a signed app bundle in
`/Applications`, a system authorization prompt, or a process the assistant's
tools can't drive (e.g. clicking a toggle in OneBox, confirming a sudo prompt
in a TCC dialog).

**Never pretend a manual step is automated.** If a workflow has a manual
gate, the assistant should produce a short-lived shell script at
`scripts/tmp-<name>.sh` that:

1. Runs every step it *can* run non-interactively (sudo cleanup, re-signing,
   launchd inspection, log queries, etc.).
2. At each manual gate, prints a clearly-framed **MANUAL STEP** block
   describing exactly what I need to do in the GUI / terminal, then waits on
   `read -r -p "Confirm done? [y/N] "`. Any answer other than `y`/`Y`
   aborts with a non-zero exit.
3. Immediately after each manual gate, runs an automated sanity check so
   that a silent failure on my side (forgot to click, authorization denied,
   etc.) is caught before the next step. Example: after "click Install
   privileged helper", check `sudo launchctl print system/<label>`.
4. Prints a one-line success message at the end and lists anything the
   script cannot verify (e.g. a toast message only visible in the UI).

File naming: `scripts/tmp-<purpose>.sh`. The `tmp-` prefix is a marker that
the file is disposable — delete it once the workflow it validates has been
merged and stabilised. Don't let these accumulate; they rot quickly.

Do **not**:

- Write the manual step into a memory file and tell me "I'll remember to
  do this next time". The script is the authoritative place.
- Bundle the automated and manual parts into a single `echo "now do X"`
  without a `read` gate — I will miss it and the script will race ahead.
- Skip the sanity check after a manual gate just because the script "should
  work". The point of these scripts is to catch the case where it doesn't.
- Check the temporary scripts into a release. They are for the dev loop
  only; once the feature ships, the script should be removed in the same
  commit, or at minimum in the follow-up cleanup commit.

Real example: `scripts/tmp-test-phase2a.sh` for the SMJobBless caller
validation flow — cleans old helper, re-integrates new one, pauses for me
to click Install + accept the system prompt, verifies launchd registered
it, pauses again for me to click Ping, then scrapes the unified log for
`connection accepted` / `reject:` lines.

## CHANGELOG writing rules

`CHANGELOG.MD` is written for **end users**, not developers. Each entry should be a single sentence describing what the user can observe. Do not include implementation details, file paths, config field names, code-level terms (e.g. `route_exclude_address`, `inbound`, `hijack-dns`), root-cause analysis, RFC terminology, or emoji. Provide both English and Simplified Chinese entries.

Bad: `Fixed bypass-router mode where the Mixed inbound listened on 127.0.0.1, making LAN hosts unreachable`
Good: `Fixed bypass-router mode not handling DNS and traffic from other devices on the LAN`

## Design Philosophy

These principles drive the template-cache and DNS-override subsystems below. Apply them to new code that touches system state or long-lived caches.

**1. State belongs to ground truth, not to our code that manipulates it.**
If the OS / filesystem / store already holds the canonical state, don't shadow it with a snapshot. We are thin orchestrators of system-native operations, not state managers.

**2. Operations are idempotent — no guards, no "only call if needed" checks.**
Every mutation can be run repeatedly without harm. This means callers never have to track "did I already do X?", and crash-recovery paths can call the operation unconditionally.

**3. Cleanup is targeted on macOS/Linux, scorched-earth on Windows.**
macOS and Linux capture the touched service/interface's pre-override DNS and re-apply it on stop — any service we never touched is left alone. Windows enumerates all non-TUN adapters and blanks their `NameServer` registry value to DHCP default, because Windows' per-adapter stateful registry primitive makes targeted restore expensive and the blast radius of resetting every adapter is already accepted by Design Philosophy #6 for that platform. macOS used to also be scorched-earth (`networksetup -setdnsservers <svc> empty` on every service) but that destroyed the user's manual DNS on interfaces OneBox never had reason to touch; the current targeted design is in `engine/macos/mod.rs::DNS_CAPTURED`.

**4. Reads and writes are decoupled. Stale reads are allowed.**
The read path is fast, local, never blocks on network. The write path refreshes in the background. The two paths don't synchronize — the read may return old data while a write is mid-flight, and that's fine.

**5. System-native semantics > reinvented state.**
Each platform has its own "revert to default" primitive (macOS `networksetup empty`, Linux `resolvectl revert`, Windows `-ResetServerAddresses`, `store.delete`). Use them. Don't re-implement their effect with our own snapshot/replay logic.

**6. Trade-off bias: accept small edge-case data loss for crash-safety and simplicity.**
A scorched-earth purge might delete a fringe store key or reset a Windows adapter OneBox didn't care about. These are acceptable. What is *not* acceptable: leaving the system in a half-applied state because our replay logic couldn't unwind it correctly. Note: macOS DNS restore *does* track per-service originals because user-facing complaints about losing manual DNS outweighed the simplicity of scorched-earth. Windows keeps the scorched-earth default because the stateful-registry alternative is complex and Windows users rarely hand-configure DNS on secondary adapters.

**One-liner**: *Tell the system to start and stop; let the system decide what "stopped" means.*

---

## System DNS Override Flow

Core principle: **DNS override is a single directed "set" on the active (or every non-TUN) interface. Restore is targeted on macOS and Linux (re-apply per-service/iface captured originals; verify + fall back to best public DNS if the original is unreachable), and scorched-earth on Windows (enumerate → blank registry) because Windows' per-adapter restore would require a lot more state tracking for little user benefit.**

### Why DNS needs overriding at all

Without a system DNS override, `mDNSResponder` / `systemd-resolved` / Windows `Dnscache` bind their upstream DNS sockets directly to physical interfaces (`IP_BOUND_IF`, `SO_BINDTODEVICE`, SMHNR parallel query). **These bypass the routing table**, so the TUN device never sees the query, sing-box's `hijack-dns` route rule never fires, and DNS leaks to whichever DHCP-provided server GFW injects against.

Pointing system DNS at the TUN gateway (e.g. `172.19.0.1`) forces every query into TUN regardless of socket binding, because that IP is only reachable *through* TUN — no physical NIC has a route to it.

### Apply (on TUN start)

| Platform | Detection | Capture (before write) | Write mechanism | Runs as |
|---|---|---|---|---|
| macOS | `route -n get default` → `networksetup -listallhardwareports` to map iface → service | `networksetup -getdnsservers <service>` → append `(service, original)` to `DNS_CAPTURED` **only if service not already captured** | `networksetup -setdnsservers <service> <gw>` via privileged XPC helper | root (helper) |
| Linux | `ip route get 1.1.1.1` for active iface, `nmcli` / `resolvectl status` to capture original DNS | stashed into `DNS_OVERRIDE` `Mutex<Option<(String, String)>>` | `resolvectl dns <iface> <gw>` via `pkexec` shell helper | root (pkexec) |
| Windows | `tun_service::dns::enumerate_interfaces` — non-TUN adapters that already have an IP | not captured (scorched-earth restore) | `tun_service::dns::apply_override(gateway)` → per-iface `set_interface_dns` writes the `HKLM\SYSTEM\…\Interfaces\{GUID}\NameServer` registry value | SYSTEM (service) |

The TUN gateway IP comes from `engine::common::helper::extract_tun_gateway_from_config` parsing the rendered sing-box config.

**In-process state we keep**:
- macOS: `DNS_CAPTURED: Mutex<Vec<(service, original_dns)>>` in `engine/macos/mod.rs`. Append-only while TUN runs; `NetworkUp` re-applies to the new active service but never overwrites an existing capture (the on-disk value we'd read back now is our own TUN gateway, not the true original).
- Linux: `DNS_OVERRIDE: Mutex<Option<(iface, original)>>` in `engine/linux/mod.rs`.
- Windows: none — restore iterates live adapter state instead.

### Restore (on TUN stop / crash / reload)

| Platform | Strategy | Implementation |
|---|---|---|
| macOS | Targeted + verify + fallback, split into two phases: **(pre-kill)** write each captured `(service, original)` back; **(post-kill)** probe each on UDP/53 with a 500 ms per-server timeout; if all of a service's captured servers fail, swap in `commands::dns::get_best_dns_server` (fastest-responding public DNS). Services never captured are left untouched. | `engine/macos/mod.rs::apply_captured_originals_sync` + `verify_and_fallback`; called in order from `stop_tun_process` with `stop_sing_box` + route cleanup in between. Helper call: `networksetup -setdnsservers <service> <original-or-best>` |
| Linux | Targeted: re-apply captured original DNS to the one iface we touched | `engine/linux/mod.rs::restore_system_dns(iface, original)` via pkexec `resolvectl dns` |
| Windows | Scorched-earth: blank `NameServer` on every non-TUN adapter with an IP → DHCP default | Two parallel copies of `reset_all_interfaces_dns` (native Win32 registry writes): `tun_service::dns` runs it inside the SCM service on normal stop; `engine/windows/native.rs` runs it via UAC self-elevation on the crash-recovery path |

Restore is called from two paths:

1. **User-initiated stop** — `PlatformEngine::stop(app)`:
   - macOS: `stop_tun_process` (async) drains `DNS_CAPTURED`, runs `apply_captured_originals_sync` (phase 1), kills sing-box, removes TUN routes, then runs `verify_and_fallback` (phase 2). The phases **must** straddle `stop_sing_box`: while sing-box is alive, every UDP/53 probe from the OneBox process gets routed through TUN → the proxy → every server looks reachable and the fallback never fires. Phase 1's drain means the crash-recovery path below becomes a no-op.
   - Linux: `stop_tun_and_restore_dns(take_dns_override())` drains the stash and does restore + pkill in one pkexec call. No verify phase.
   - Windows: SCM stop; the service's own stop handler calls `reset_all_interfaces_dns` before reporting STOPPED.
2. **Process exited** (crash, external kill, reload) — `core::monitor::handle_process_termination` calls `PlatformEngine::on_process_terminated(app, was_user_stop)`:
   - macOS: spawns the async `restore_system_dns` fire-and-forget. Because sing-box is already dead by the time this runs, the write + verify + fallback can run back-to-back without the phase split — probes hit the physical NIC directly. If the user-stop path already drained `DNS_CAPTURED`, this returns early (empty stash).
   - Linux: `take_dns_override()` — drained on user-stop path, so this is a no-op there; on crash it's the only restore that runs.
   - Windows: if `!was_user_stop`, self-elevates via UAC to re-run `reset_all_interfaces_dns` (crash path only); user-stop path already cleaned up via the service.

On top of restore, `PlatformEngine::restart` (the config-reload path) also flushes the OS DNS cache — `dscacheutil -flushcache` + `killall -HUP mDNSResponder` on macOS, `resolvectl flush-caches` on Linux (bundled into the pkexec `reload` verb), `ipconfig /flushdns` from the Windows service. Without this, stale FakeIP entries linger for up to sing-box's 600s DNS TTL after a mode switch.

### What we deliberately DON'T do

- **No backup file.** The prior design wrote `/tmp/onebox-dns-backup.tsv`. Deleted. Windows uses the OS's "back to DHCP" primitive; macOS and Linux use process-local `Mutex` stashes that die with the process.
- **No "only restore if we applied" guard.** Every termination path calls restore. On macOS/Linux the capture stash is authoritative — if it's empty, restore is a no-op; if it has entries, restore runs unconditionally. Benefit: immune to crashes between apply and restore.
- **No attempt to preserve the user's manual DNS on unrelated Windows adapters.** If Ethernet had `1.1.1.1` set manually while Wi-Fi was running OneBox, Windows stop will reset Ethernet too. Accepted trade-off — see Design Philosophy #6. macOS and Linux preserve untouched interfaces because their per-service/iface restore primitives are cheap; Windows' `HKLM\…\Interfaces\{GUID}` per-adapter state would require tracking which GUIDs we touched across service restarts, not worth it.
- **macOS: no write-time DNS override re-capture.** When `NetworkUp` fires (Wi-Fi flap, interface switch), `apply_system_dns_override` runs again, but `DNS_CAPTURED` only appends if the service isn't already present. Re-capturing would read back our own TUN gateway IP as the "original" and clobber the real original on stop.

**DNS_CAPTURED invariant (macOS)**: append-only during the TUN session, drained exactly once by `take_all_captured`. **Never** overwrite an existing entry. If you add a code path that mutates it, the "manual DNS survives TUN" property breaks.

### Files

- `src-tauri/src/engine/common/helper.rs` — `extract_tun_gateway_from_config` (parses the rendered config for the TUN inbound's IPv4).
- `src-tauri/src/engine/macos/mod.rs` — `DNS_CAPTURED` stash, `apply_system_dns_override` (captures + writes), `apply_captured_originals_sync` + `verify_and_fallback` (the two restore phases), `restore_system_dns` (crash-path wrapper), `read_service_dns`, `detect_active_network_service`, `list_all_network_services`, `stop_tun_process`. XPC calls go to the privileged helper in `engine/macos/helper.{rs,m}`.
- `src-tauri/src/commands/dns.rs` — `probe_dns_reachable` (single-server UDP/53 liveness probe, 500 ms timeout) and `get_best_dns_server` (races 29 public resolvers, picks the fastest). Consumed by the macOS verify pass.
- `src-tauri/src/engine/linux/mod.rs` — `apply_system_dns_override` / `restore_system_dns`, `detect_active_iface`, `capture_original_dns`, `stop_tun_and_restore_dns` (pkexec), and the private `DNS_OVERRIDE` stash. Shell helper at `src-tauri/resources/linux/onebox-tun-helper` runs as root.
- `src-tauri/src/engine/windows/native.rs` — `enumerate_interfaces`, `reset_all_interfaces_dns`, `self_elevate_helper` (used on the crash-recovery restore path). Pure native Win32 registry writes, no PowerShell.
- `src-tauri/tun-service/src/dns.rs` — the SCM service's own copy of the same interface-enumeration + apply/reset logic, called from `service_main` on normal start and stop.
- `src-tauri/src/core/monitor.rs::handle_process_termination` — dispatcher that unconditionally calls `PlatformEngine::on_process_terminated` on TUN-mode sing-box exit.

### Why the restore-before-kill order matters

In `stop_tun_process` (macOS) / `stop_tun_and_restore_dns` (Linux) we restore DNS **first**, then kill sing-box. If we killed sing-box first, TUN tears down, the default route reverts to the physical NIC, and for ~500 ms the system DNS still points at an unreachable `172.19.0.1` — every app's DNS lookup times out during that window. Restoring first overwrites the stale gateway while it's still addressable.

Windows doesn't need an explicit order here: the reset runs inside the service process before the SCM state transitions to STOPPED, so by the time the TUN is removed the registry's `NameServer` values are already cleared.

### Why the macOS verify phase runs AFTER kill

The user-stop path on macOS intentionally straddles `stop_sing_box` with its two DNS phases. The reason is counter-intuitive: while sing-box is alive, every UDP packet this process emits — including the DNS probes in `verify_and_fallback` — gets picked up by the TUN device and routed through the active outbound proxy. So every public DNS we probe looks reachable regardless of whether the physical network can actually reach it. The fallback to `get_best_dns_server` would never fire, and a captured DNS that's been dead for hours (e.g. a Wi-Fi gateway IP the user has since roamed away from) would stay configured, leaving the system unable to resolve anything after TUN goes away. Only once `stop_sing_box` + `remove_tun_routes` run do probes egress through the physical NIC and report truthful liveness. That's why phase 1 (write) must happen before the kill (for the restore-before-kill reason above) but phase 2 (probe + fallback) must happen after.

The crash path (`on_process_terminated`) doesn't need this split — sing-box is already dead when the monitor fires.

### Methodology reminder: expand every verb in the TUN lifecycle

When editing any step in the TUN start/stop/restart sequence, **expand the verb into its concrete system-state effect** before deciding where a new step goes. "`stop_sing_box`" is not "stop a process" — it is "tear down the `utun233` device so the kernel no longer captures this process's outbound packets". "`remove_tun_routes`" is not "clean up" — it is "delete the routes that tell the kernel to hand `172.19.0.1` to TUN". A step that emits packets from this process (probe, telemetry, health check, log upload) must check whether **TUN is still the default route at the insertion point**. If yes, the packet is captured by TUN and routed through the proxy — it tells you nothing about the physical network. The probe-after-kill bug in this module's history came from treating `stop_sing_box` as an abstract "stop the process" rather than "take down the virtual NIC". Rule of thumb: if you cannot state, in one sentence, what observable kernel / socket / routing state changes across a given step boundary, stop and read the code for that step before inserting anything adjacent. See also `~/.claude/CLAUDE.md` → *Step-by-step Semantic Analysis*.

---

## Update-driven relaunch: deep-link argv suppression

`tauri-plugin-updater` on Windows (NSIS) and on macOS/Linux (via `tauri::process::restart`) forwards the current process's `argv` to the freshly-installed binary when it relaunches. Concretely, the NSIS installer is invoked with `/ARGS <original-argv>` so the new exe boots with the same command line as the one being replaced. `tauri-plugin-deep-link::handle_cli_arguments` runs at plugin-init time on Windows/Linux and populates its `current` URL slot from argv — so an app originally launched via `onebox-networktools://config?...&apply=1` will see the URL back in argv on every update-relaunch. Without a guard, the post-update cold-start path in `app/setup.rs` re-imports + re-applies the original payload.

**Mechanism**:

- JS side, immediately before `updateInfo.install()`, writes `{ at: Date.now() }` to the `update_suppress_argv_deeplink_at` key in the settings store (`src/utils/update.ts::markPendingUpdateRelaunch`, called from both `updater.tsx` and `updater-button.tsx`).
- Rust side, in the cold-start Windows/Linux argv branch of `app/setup.rs`, reads + `delete`s the key (both best-effort). If the read returned a timestamp within `UPDATE_SUPPRESS_TTL_MS` of now, the argv-carried deep link is discarded. Otherwise it's processed normally.
- TTL is 5 minutes. NSIS install → relaunch finishes in seconds in practice, so the TTL is a safety net for the "install crashed after writing the marker but before relaunching" scenario.

**Critical invariants** — breaking either one makes the suppression mechanism silently wrong:

1. **Closed write path.** `markPendingUpdateRelaunch` is the **only** code that ever writes this key. Rust's read path **must not** re-write it. If a future change adds a second writer, the mental model collapses and the suppression can fire in unrelated flows.
2. **Never extend the TTL.** The whole point of the timestamp is that it **ages out**. A stuck marker must self-heal within `UPDATE_SUPPRESS_TTL_MS`. Don't add "refresh on read", don't extend the TTL to hours, don't add a bool-equivalent that never expires. If the read path's `delete` fails (store locked, disk full, process killed mid-save), the TTL is the only thing preventing permanent deep-link death — and deep links failing silently is considered more fatal than a single accidental re-import.

**What about macOS?** macOS deep links don't go through argv — they're delivered via the Cocoa `application:openURLs:` delegate and only appear through `on_open_url`. So the `#[cfg(any(windows, target_os = "linux"))]` gate matches exactly the platforms where the argv-replay bug exists. macOS never needs to write or read this key.

**Files**:

- `src/types/definition.ts` — `UPDATE_SUPPRESS_ARGV_DEEPLINK_AT_KEY` constant.
- `src/utils/update.ts` — `markPendingUpdateRelaunch`.
- `src/components/settings/updater.tsx`, `src/components/settings/updater-button.tsx` — call sites (always immediately before `updateInfo.install()`).
- `src-tauri/src/app/setup.rs` — `should_suppress_argv_deeplink`, `UPDATE_SUPPRESS_KEY`, `UPDATE_SUPPRESS_TTL_MS`, call site inside the cold-start `get_current` branch.

---

## Windows Platform Implementation Philosophy

**1. Native Win32 over PowerShell.**
PowerShell pulls in a runtime, breaks under restricted execution policies, leaves transcript files behind, and forces escape-hell for paths with spaces. Direct API calls are deterministic and depend only on the OS itself.

**2. Demo-then-integrate for unsafe Win32 work.**
Build a small CLI binary that exposes each Win32 entry point as a subcommand, with unit tests for the pure helpers. Validate signatures, permissions, and real-machine behavior in isolation before touching production code paths.

---

## Config Template Loading Flow

Core principle: **there is one source of truth — the `conf-template` repo — and every template OneBox ever uses traces back to it**. Both the built-in fallback (baked at build time) and the live-fetched runtime cache (refreshed by SWR) are snapshots of the same upstream files. They can never disagree in shape, only in freshness.

### Single source of truth: `conf-template` repo

The `conf-template` repo (`OneOhCloud/conf-template`) owns all 4 template variants (`tun-rules`, `tun-global`, `mixed-rules`, `mixed-global`) across all supported sing-box versions (`1.12`, `1.13`, `1.13.8`, …). Only `conf/1.13.8/zh-cn/*.jsonc` is hand-edited; derived versions are produced by a generator in that repo. The generator also runs the static validator + `sing-box check` on every emitted file — invalid templates can never reach the CDN.

See `conf-template/CONVENTIONS.md` for the contract.

### Build-time path (bake a snapshot into the binary)

`scripts/sync-templates.ts` runs automatically before every `bun run dev` / `bun run build` via bun's npm-style `predev` / `prebuild` script hooks. It:

1. Derives the version directory from the baked-in `SING_BOX_VERSION` (mirrors `store.ts::getDefaultConfigTemplateURL`).
2. In parallel, `fetch`es the four `.jsonc` files from `https://raw.githubusercontent.com/OneOhCloud/conf-template/<branch>/conf/<version>/zh-cn/<variant>.jsonc`.
3. Parses each with `jsonc-parser` (validates + strips comments), then emits `src/config/templates/generated.ts` as a **TypeScript module with real object literals** — one `export const MIXED_TEMPLATE = { … } as const` per variant, plus a `BUILT_IN_TEMPLATE_OBJECTS` record mapping `configType` to those constants, plus a metadata block (repo, branch, commit SHA, build timestamp, sing-box version).

The emitted file is real TypeScript code, not JSON-strings-inside-TS. Advantages:

- **`tsc` parses it like any other source file.** Any malformed JSON produced by an upstream sync breaks the build immediately, not at runtime.
- **No escape hell.** The old design serialised each template with `JSON.stringify` and embedded the result inside a TS template literal, meaning any unusual character in a template string had to survive two layers of escaping correctly. Emitting real object literals sidesteps the whole problem.
- **Precise literal types via `as const`.** The compiler can narrow the template shape for free if future code wants to poke at specific fields.

Branch defaults to `stable`; override with `CONF_TEMPLATE_BRANCH=beta|dev` in CI for non-stable release channels.

`generated.ts` is `.gitignore`d — every fresh checkout regenerates. If the network fetch fails **and** an existing `generated.ts` from a prior run is present, the script warns and keeps the stale snapshot so offline dev still works; fresh checkouts with no network fail fast.

The tauri build chain works without modifying `tauri.conf.json`:
```
tauri build → beforeBuildCommand "bun run build" → prebuild hook "sync-templates" → build (tsc && vite build)
```

The single CI release workflow (`.github/workflows/release.yml`) runs the sync **explicitly** as a "Sync config templates" step right after "Download Binaries", not relying on the prebuild hook. Two reasons:

1. **Fail-early visibility** — if sync fails (GitHub 404, parse error, network flake), we want to see it in a dedicated CI step with clear logs, not hidden mid-`tauri build` 10 minutes later.
2. **Belt-and-suspenders against bun pre-hook breakage** — if a future bun version changes how it invokes `prebuild`, the explicit step still produces a valid `generated.ts` before `tauri-action` runs. The prebuild hook in `package.json` remains for local dev.

The channel-specific `CONF_TEMPLATE_BRANCH` (`stable` / `beta` / `dev` / `stable` for manual) is derived from the `resolve` job's channel output and threaded into the sync step's env. After running sync, the step greps for `BUILT_IN_TEMPLATE_OBJECTS` / `BUILD_TIME_TEMPLATE_SOURCE` / `singBoxVersion: 'v` in the output as a smoke check — catches silent corruption before the real build wastes time.

**Windows runner specifics**: the step declares `shell: bash` so `set -euo pipefail` and heredoc-style `run: |` work identically across Linux, macOS, and Windows. Without that, Windows defaults to PowerShell and interprets `set -euo pipefail` as a `Set-Variable` cmdlet invocation (`A parameter cannot be found that matches parameter name 'euo'`).

### Runtime read path (non-blocking, stale allowed)

`config/merger/main.ts::getConfigTemplate(mode)`:

1. Read the current-schema v2 key from the `tauri-plugin-store` file cache (`settings.json`).
2. If present → parse and return (stale content is acceptable).
3. If absent → call `getBuiltInTemplate` from `config/templates/index.ts` which looks up the build-time object in `BUILT_IN_TEMPLATE_OBJECTS[mode]`, runs `JSON.stringify` on it to get a string, writes that into the cache, then returns the string for the caller's subsequent `JSON.parse`. Seeding happens once; subsequent reads are pure cache hits.

`templates/index.ts` only stringifies on the cache-miss path, so the work happens at most four times per app launch (once per configType, in the fallback path). The caller's string-based store interface stays unchanged.

No network I/O on this path. `setTunConfig` / `setMixedConfig` / their `-global` variants all go through `getConfigTemplate` — the merge step's **only** template source is the cache.

The hand-written `TunRulesConfig` / `TunGlobalConfig` / `mixedRulesConfig` / `miexdGlobalConfig` object literals are gone. `getBuiltInTemplate` is a ~15-line dispatcher over `BUILT_IN_TEMPLATE_OBJECTS[mode]`; the old `config/version_1_12/` directory has been renamed to `config/merger/` (its historical name — "version_1_12" — no longer reflected the actual sing-box version) and the vestigial `zh-cn/config.ts` is gone.

### Runtime write path (background periodic refresh)

`hooks/useSwr.ts::primeAllConfigTemplateCaches` (invoked via a SWR hook in `App.tsx`):

1. For each `configType` in parallel, call `primeConfigTemplateCache(mode)`:
   - Try `fetch(remote URL)` → on success, write JSON string to the v2 key.
   - On any failure (network / non-HTTPS URL / parse error), write the build-time snapshot from `generated.ts` to the v2 key.
2. The write is unconditional — every prime overwrites the cache so it reflects the latest attempt.

The SWR hook uses `revalidateOnFocus: true` + `dedupingInterval: 30 min`. Cold start triggers one prime; focus and the 30-minute window trigger further refreshes. The prime path is completely independent of `getConfigTemplate` — the merger may read a stale cache while a prime is in flight, and that's fine.

### The two-path model in one picture

```
conf-template repo (human-edited at 1.13.8 canonical)
        │
        │ generator (inside conf-template) runs on every commit
        │ static validator + sing-box check
        ▼
conf/<ver>/zh-cn/*.jsonc  (committed, served by CDN)
        │                                │
        │ build time                     │ run time
        │ sync-templates.ts              │ primeConfigTemplateCache (SWR)
        ▼                                ▼
src/config/templates/generated.ts   tauri-plugin-store v2 cache
        │                                │
        │    ─ fallback when cache is ─  │
        │    empty or SWR fetch fails    │
        ▼                                ▼
            getConfigTemplate(mode)
                     │
                     ▼
              set*Config mergers
```

- **Binary ships → user never opens app → OneBox still works**: built-in snapshot is the floor.
- **Network available → cache populates via SWR → every merge uses the fresher copy**: live is the ceiling.
- **Both paths share the same upstream**: SWR-fetched templates and built-in snapshot come from the same `conf-template` commit on the same branch on the same day (one at app-ship time, one at every 30-minute SWR tick), so their shape is guaranteed consistent.

### Cache shape

- Key: `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-config-cache-v${TEMPLATE_CACHE_SCHEMA_VERSION}`
- `TEMPLATE_CACHE_SCHEMA_VERSION` is bumped whenever a sing-box upgrade makes prior cached templates unusable (e.g. 1.13.8 rejecting legacy `sniff` inbound fields).
- Value: JSON string (stringified sing-box config template).

### Legacy purge (scorched-earth)

`hooks/useSwr.ts::purgeLegacyTemplateCache` runs once at app mount (SWR with `dedupingInterval: Infinity`). It enumerates `store.keys()` rather than relying on a hardcoded list so every historical shape is cleaned in one pass:

- Any key containing `-template-config-cache` that isn't the current v2 key → delete. Covers old-major (`1.12`), suffix-less v1, and orphan naming (`-rules-template-config-cache`).
- Any `-template-path` override whose value points at a stale URL (e.g. `conf/1.13/zh-cn/` post-1.13.8) → delete the override **and** the sibling v2 content cache (which was poisoned by the stale URL). `getDefaultConfigTemplateURL` will then resolve to the migrated path.

Purge + prime run in parallel at mount. Order doesn't matter: if purge wipes a poisoned v2 cache, prime repopulates it from the new default URL; if prime lands first, purge detects the stale-override signature and still wipes it, and the next prime cycle re-seeds.

### Why this shape

- **Single source of truth removes a class of bugs.** Before the generator + sync, built-in fallbacks drifted away from remote templates (the `www.qq.com → overseas IP` regression was exactly this: remote dropped `dns.rules`, built-in still had it, only the runtime-cache-via-remote path was hit). Now both trace to the same `conf-template` commit, so "works in built-in fallback but not in live" is structurally impossible.
- **Decoupled read/write.** TUN toggle latency never depends on network. Users with flaky connectivity still get fast starts from the last-known-good cache.
- **Build-time fallback absorbs the "binary never updates" risk.** Clients that get one build and sit on it forever still have a frozen-but-valid template from ship day. Not ideal, but much better than hand-written fallbacks that ossify at first-commit time.
- **Schema version + scorched-earth purge.** Upgrades that invalidate old templates bump `TEMPLATE_CACHE_SCHEMA_VERSION`, and the purge sweeps everything that doesn't match the current key on next launch, so a client upgrade can never use a poisoned cache from a previous version.

### Files

**In OneBox repo**:
- `scripts/sync-templates.ts` — build-time fetch + emit `generated.ts` (predev/prebuild hook). Emits real TS object literals, not JSON-stringified strings.
- `src/config/templates/generated.ts` — AUTO-GENERATED, `.gitignore`d. Exports `MIXED_TEMPLATE` / `TUN_TEMPLATE` / `MIXED_GLOBAL_TEMPLATE` / `TUN_GLOBAL_TEMPLATE` as typed object constants (with `as const`) plus `BUILT_IN_TEMPLATE_OBJECTS: Record<configType, unknown>` mapping keys to those constants, plus `BUILD_TIME_TEMPLATE_SOURCE` metadata.
- `src/config/templates/index.ts` — hand-written. Re-exports `BUILD_TIME_TEMPLATE_SOURCE`, imports `BUILT_IN_TEMPLATE_OBJECTS`, and provides `getBuiltInTemplate(mode): string` which stringifies the selected object on read.
- `src/config/common.ts` — schema version, cache key builder, stale-URL detector
- `src/config/merger/main.ts` — `getConfigTemplate` (read path) + the four `set*Config` mergers (renamed from `version_1_12/main.ts`)
- `src/config/merger/helper.ts` — inbound configurators / DHCP / VPN server merging (renamed from `version_1_12/helper.ts`)
- `src/hooks/useSwr.ts` — `primeConfigTemplateCache` / `primeAllConfigTemplateCaches` (write path) + `purgeLegacyTemplateCache`
- `src/single/store.ts` — `getConfigTemplateURL` / `getDefaultConfigTemplateURL` (URL resolution, including the 1.13.8 patch-version branch)
- `src/App.tsx` — mounts both SWR hooks (purge once, prime periodically)
- `package.json` — `sync-templates` / `prebuild` / `predev` scripts
- `.gitignore` — excludes `src/config/templates/generated.ts`

**In conf-template repo** (separate repo, `OneOhCloud/conf-template`):
- `scripts/generate.ts` — canonical → derived transformer + static + `sing-box check` validator
- `conf/1.13.8/zh-cn/*.jsonc` — canonical (only hand-edited files)
- `conf/{1.13,1.12}/zh-cn/*.jsonc` — derived, regenerated on every `pnpm generate`
- `CONVENTIONS.md` — full contract including validator rules and how to add variants/versions
