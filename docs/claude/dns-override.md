# System DNS Override Flow

> **Claude-facing, not human-facing.** Optimised for Claude execution; see [`README.md`](README.md) for directory-wide conventions (preamble shape, `Do not X` framing, file:line style). Read when touching `engine/macos/mod.rs`, `engine/macos/dns_watcher.rs`, `engine/linux/mod.rs`, `engine/windows/native.rs`, `tun-service/src/dns.rs`, `commands/dns.rs`, or `core/monitor.rs::handle_process_termination`. Paths are repo-relative; if anything here disagrees with the code, trust the code and update this file.

Core principle: **DNS override is a single directed "set" on the active (or every non-TUN) interface. Restore is targeted on macOS and Linux (re-apply per-service/iface captured originals; verify + fall back to best public DNS if the original is unreachable), and scorched-earth on Windows (enumerate → blank registry) because Windows' per-adapter restore would require a lot more state tracking for little user benefit.**

## Why DNS needs overriding at all

Without a system DNS override, `mDNSResponder` / `systemd-resolved` / Windows `Dnscache` bind their upstream DNS sockets directly to physical interfaces (`IP_BOUND_IF`, `SO_BINDTODEVICE`, SMHNR parallel query). **These bypass the routing table**, so the TUN device never sees the query, sing-box's `hijack-dns` route rule never fires, and DNS leaks to whichever DHCP-provided server GFW injects against.

Pointing system DNS at the TUN gateway (e.g. `172.19.0.1`) forces every query into TUN regardless of socket binding, because that IP is only reachable *through* TUN — no physical NIC has a route to it.

## Apply (on TUN start)

| Platform | Detection | Capture (before write) | Write mechanism | Runs as |
|---|---|---|---|---|
| macOS | `route -n get default` → `networksetup -listallhardwareports` to map iface → service | `networksetup -getdnsservers <service>` → store `ActiveOverride { service, captured, gateway }` in the single-slot `ACTIVE_OVERRIDE`. Only the **currently-active (primary)** service is ever tracked | `networksetup -setdnsservers <service> <gw>` via privileged XPC helper | root (helper) |
| Linux | `ip route get 1.1.1.1` for active iface, `nmcli` / `resolvectl status` to capture original DNS | stashed into `DNS_OVERRIDE` `Mutex<Option<(String, String)>>` | `resolvectl dns <iface> <gw>` via `pkexec` shell helper | root (pkexec) |
| Windows | `tun_service::dns::enumerate_interfaces` — non-TUN adapters that already have an IP | not captured (scorched-earth restore) | `tun_service::dns::apply_override(gateway)` → per-iface `set_interface_dns` writes the `HKLM\SYSTEM\…\Interfaces\{GUID}\NameServer` registry value | SYSTEM (service) |

The TUN gateway IP comes from `engine::common::helper::extract_tun_gateway_from_config` parsing the rendered sing-box config.

**In-process state we keep**:
- macOS: `ACTIVE_OVERRIDE: Mutex<Option<ActiveOverride>>` in `engine/macos/mod.rs` — a **single slot** holding `{ service, captured, gateway }` for the currently-active primary service only. The `captured` field tracks the user's latest DNS intent: it's updated live by `dns_watcher` whenever an external party (user via System Settings / `networksetup`, another VPN, MDM) rewrites DNS on the primary during TUN, so restore always uses the user's most recent intent rather than a frozen TUN-start snapshot. Non-primary interfaces are never touched.
- Linux: `DNS_OVERRIDE: Mutex<Option<(iface, original)>>` in `engine/linux/mod.rs`.
- Windows: none — restore iterates live adapter state instead.

## macOS: SCDynamicStore watcher (`engine/macos/dns_watcher.rs`)

macOS exposes DNS-config changes through the SystemConfiguration framework. The watcher runs on a dedicated thread (`onebox-dns-watcher`) started once from `start_tun_via_helper` and stays alive for the rest of the app's lifetime — it's idempotent and is a no-op when `ACTIVE_OVERRIDE` is `None`.

**Keys watched** (via `system-configuration` crate, pattern matched by `SCDynamicStoreSetNotificationKeys`):

- `(State|Setup):/Network/Service/.*/DNS` — per-service DNS changes. `Setup:` catches user intent written by System Settings / `networksetup`; `State:` catches runtime writes (DHCP push, our override, other VPN agents). Watching both layers removes the race window where one updates before the other.
- `State:/Network/Global/IPv4` — primary-service change (Wi-Fi → Ethernet).

**Callback → state machine**: every event delegates to `reapply_on_active_primary(gateway)`, which re-detects the primary, re-reads its current DNS, then picks one of three branches:

1. Current primary matches `ACTIVE_OVERRIDE.service` AND current DNS == gateway → no-op (our own write round-tripped).
2. Current primary matches AND current DNS != gateway → treat observed value as user's latest intent, update `ACTIVE_OVERRIDE.captured`, re-write gateway.
3. Current primary differs from `ACTIVE_OVERRIDE.service` → NIC switch. Write the old service's `captured` back (preserving the user's DNS on the now-idle interface), capture the new primary's current DNS, override it.

**Self-write suppression**: no separate dedup table. The callback reads the current DNS and compares against `gateway`; our own writes surface as "already == gateway" and fast-path to the no-op branch. Single race window: user manually sets DNS to exactly the TUN gateway IP — we'd treat it as our own write and miss the intent update. Acceptable (TUN gateway IPs like `198.18.x.x` are effectively never user-chosen).

**Why app-side not helper-side**: `ACTIVE_OVERRIDE` + `networksetup` invocations already live in the main app; moving the watcher into the helper would require shipping the intent map back over XPC at stop time for no correctness gain.

## Restore (on TUN stop / crash / reload)

| Platform | Strategy | Implementation |
|---|---|---|
| macOS | Targeted + verify + fallback, split into two phases: **(pre-kill)** write the slot's `captured` DNS back to its `service`; **(post-kill)** probe each IP on UDP/53 with a 500 ms per-server timeout; if all probes fail, swap in `commands::dns::get_best_dns_server` (fastest-responding public DNS). Non-primary interfaces are never touched by design. | `engine/macos/mod.rs::apply_captured_originals_sync` + `verify_and_fallback`; called in order from `stop_tun_process` with `stop_sing_box` + route cleanup in between. Helper call: `networksetup -setdnsservers <service> <captured-or-best>` |
| Linux | Targeted: re-apply captured original DNS to the one iface we touched | `engine/linux/mod.rs::restore_system_dns(iface, original)` via pkexec `resolvectl dns` |
| Windows | Scorched-earth: blank `NameServer` on every non-TUN adapter with an IP → DHCP default | Two parallel copies of `reset_all_interfaces_dns` (native Win32 registry writes): `tun_service::dns` runs it inside the SCM service on normal stop; `engine/windows/native.rs` runs it via UAC self-elevation on the crash-recovery path |

Restore is called from two paths:

1. **User-initiated stop** — `PlatformEngine::stop(app)`:
   - macOS: `stop_tun_process` (async) drains `ACTIVE_OVERRIDE`, runs `apply_captured_originals_sync` (phase 1), kills sing-box, removes TUN routes, then runs `verify_and_fallback` (phase 2). The phases **must** straddle `stop_sing_box`: while sing-box is alive, every UDP/53 probe from the OneBox process gets routed through TUN → the proxy → every server looks reachable and the fallback never fires. Phase 1's drain means the crash-recovery path below becomes a no-op. The SCDynamicStore watcher stays alive but is idle (slot `None`).
   - Linux: `stop_tun_and_restore_dns(take_dns_override())` drains the stash and does restore + pkill in one pkexec call. No verify phase.
   - Windows: SCM stop; the service's own stop handler calls `reset_all_interfaces_dns` before reporting STOPPED.
2. **Process exited** (crash, external kill, reload) — `core::monitor::handle_process_termination` calls `PlatformEngine::on_process_terminated(app, was_user_stop)`:
   - macOS: spawns the async `restore_system_dns` fire-and-forget. Because sing-box is already dead by the time this runs, the write + verify + fallback can run back-to-back without the phase split — probes hit the physical NIC directly. If the user-stop path already drained `ACTIVE_OVERRIDE`, this returns early (slot `None`).
   - Linux: `take_dns_override()` — drained on user-stop path, so this is a no-op there; on crash it's the only restore that runs.
   - Windows: if `!was_user_stop`, self-elevates via UAC to re-run `reset_all_interfaces_dns` (crash path only); user-stop path already cleaned up via the service.

On top of restore, `PlatformEngine::restart` (the config-reload path) also flushes the OS DNS cache — `dscacheutil -flushcache` + `killall -HUP mDNSResponder` on macOS, `resolvectl flush-caches` on Linux (bundled into the pkexec `reload` verb), `ipconfig /flushdns` from the Windows service. Without this, stale FakeIP entries linger for up to sing-box's 600s DNS TTL after a mode switch.

## What we deliberately DON'T do

- **No backup file.** The prior design wrote `/tmp/onebox-dns-backup.tsv`. Deleted. Windows uses the OS's "back to DHCP" primitive; macOS and Linux use process-local `Mutex` slots that die with the process.
- **No "only restore if we applied" guard.** Every termination path calls restore. On macOS/Linux the slot/stash is authoritative — if it's empty, restore is a no-op; if it has an entry, restore runs unconditionally. Benefit: immune to crashes between apply and restore.
- **No attempt to preserve the user's manual DNS on unrelated Windows adapters.** If Ethernet had `1.1.1.1` set manually while Wi-Fi was running OneBox, Windows stop will reset Ethernet too. Accepted trade-off — see Design Philosophy's overarching trade-off in `CLAUDE.md`. macOS and Linux preserve untouched interfaces because their per-service/iface restore primitives are cheap; Windows' `HKLM\…\Interfaces\{GUID}` per-adapter state would require tracking which GUIDs we touched across service restarts, not worth it.
- **macOS: no tracking of non-primary services.** OneBox only ever touches the currently-active (primary) service. Non-primary services' DNS is irrelevant to the DNS-leak surface because the OS resolver binds to the primary. When the primary switches (Wi-Fi → Ethernet), the old service's captured value is written back and the new primary is captured fresh — each transition is self-contained, there is no multi-service map.
- **macOS: no scorched-earth fallback.** The original macOS restore ran `networksetup -setdnsservers <svc> empty` on *every* network service at stop time — simpler code, identical semantics for TUN-touched services, but it destroyed users' manual DNS on interfaces OneBox never had reason to touch (secondary Ethernet, VPN profiles, etc.). The current targeted single-slot design lives in `engine/macos/mod.rs`. Don't "simplify" back to scorched-earth: the project CLAUDE.md's overarching trade-off ("accept small edge-case data loss for crash-safety and simplicity") explicitly excludes this case because the loss is reproducible on *every* TUN stop, not edge-case.
- **macOS: no separate watcher stop/restart.** The SCDynamicStore watcher thread is started once on first TUN start and left running for the app's lifetime. The callback gates on `ACTIVE_OVERRIDE.is_some()`; when the slot is empty the callback returns immediately. Reason: tearing down a CFRunLoop cleanly from another thread is more fragile than a cheap boolean check on each change event, and DNS change events are rare (O(1/minute)) so the idle cost is negligible.
- **No public-DNS fallback in `verify_and_fallback` on probe failure.** When all probes of the `captured` value fail, `engine/macos/mod.rs::verify_and_fallback` writes `"empty"` to the service — **not** a hardcoded public resolver. Reason: any hardcoded fallback (prior design used `223.5.5.5` via `get_best_dns_server`) gets read back by the next `reapply_on_active_primary` → `read_service_dns` → committed to `ACTIVE_OVERRIDE.captured`, so the polluted value self-propagates across stop/start cycles. Writing `"empty"` gives control to DHCP, which in captive state is the portal hijacker — the only pre-auth resolver that answers. Accept cost: a user who had manually configured Setup DNS loses it after one NetworkDown/NetworkUp or stop cycle. **Do not reintroduce `get_best_dns_server` into this path — the pollution cycle is the blocker regardless of which fallback IP is chosen.** `get_best_dns_server` itself stays callable (used by `lib.rs`, `commands/config_fetch.rs`, `commands/dns.rs`); only its `verify_and_fallback` call site is removed.
- **`EngineManager::on_network_down` is macOS-only.** The `NetworkDown → write Setup empty` release is implemented only in `engine/macos/mod.rs::release_dns_on_network_down`; Windows and Linux use the trait's default no-op in `engine/mod.rs`. Reason: Windows `NameServer` is owned by the SCM TUN service, so releasing from the app process needs a new SCM control verb or UAC self-elevation (unacceptable on every NetworkDown); Linux's lifecycle listener is gated behind `cfg(any(target_os = "windows", target_os = "macos"))` in `app/setup.rs::spawn_lifecycle_listener`, so no NetworkDown event exists on Linux. **Do not add a Windows impl that silently "releases" without actually rewriting the registry — either wire a proper SCM control verb or leave the default.**

**ACTIVE_OVERRIDE invariants (macOS)**:
1. At most one entry, always representing the currently-active primary service (never a stale previous primary).
2. The `captured` field is updated only by `reapply_on_active_primary` when it observes `current_dns != gateway` on the current primary — that's the user's latest intent.
3. Drained exactly once per TUN session by `take_active_override` (user-stop path; crash path runs after and finds `None`).
4. If you add a code path that writes `ACTIVE_OVERRIDE` outside `reapply_on_active_primary` / `take_active_override` / `release_dns_on_network_down` / `apply_system_dns_override`, the "latest user DNS survives TUN" property breaks — audit that path against all five invariants.
5. `released: bool`: set to `true` by `release_dns_on_network_down` before it writes `"empty"`. While `released == true`, `reapply_on_active_primary` returns early without touching Setup — this prevents the SCDynamicStore watcher's callback from observing the `"empty"` write and treating it as an "external write", which would rewrite Setup back to the gateway and defeat the release. The NetworkUp re-apply path (`apply_system_dns_override` → `reapply_on_active_primary`) clears the flag back to `false` before the gateway rewrite, so subsequent `reapply` calls proceed normally. If the process exits while `released == true`, the slot dies with the process; no on-disk recovery needed.

## Files

- `src-tauri/src/engine/common/helper.rs` — `extract_tun_gateway_from_config` (parses the rendered config for the TUN inbound's IPv4).
- `src-tauri/src/engine/macos/mod.rs` — `ACTIVE_OVERRIDE` slot, `apply_system_dns_override` (public entry from TUN start + NetworkUp) and `reapply_on_active_primary` (shared state-machine driver; `dns_watcher` uses this directly with the cached gateway), `apply_captured_originals_sync` + `verify_and_fallback` (the two restore phases), `restore_system_dns` (crash-path wrapper), `read_service_dns`, `detect_active_network_service`, `stop_tun_process`. XPC calls go to the privileged helper in `engine/macos/helper.{rs,m}`.
- `src-tauri/src/engine/macos/dns_watcher.rs` — SCDynamicStore watcher thread. `ensure_started()` is idempotent and called from `start_tun_via_helper`. Callback delegates to `reapply_on_active_primary`; early-returns when `ACTIVE_OVERRIDE` is `None`.
- `src-tauri/src/commands/dns.rs` — `probe_dns_reachable` (single-server UDP/53 liveness probe, 500 ms timeout) and `get_best_dns_server` (races 29 public resolvers, picks the fastest). Consumed by the macOS verify pass.
- `src-tauri/src/engine/linux/mod.rs` — `apply_system_dns_override` / `restore_system_dns`, `detect_active_iface`, `capture_original_dns`, `stop_tun_and_restore_dns` (pkexec), and the private `DNS_OVERRIDE` stash. Shell helper at `src-tauri/resources/linux/onebox-tun-helper` runs as root.
- `src-tauri/src/engine/windows/native.rs` — `enumerate_interfaces`, `reset_all_interfaces_dns`, `self_elevate_helper` (used on the crash-recovery restore path). Pure native Win32 registry writes, no PowerShell.
- `src-tauri/tun-service/src/dns.rs` — the SCM service's own copy of the same interface-enumeration + apply/reset logic, called from `service_main` on normal start and stop.
- `src-tauri/src/core/monitor.rs::handle_process_termination` — dispatcher that unconditionally calls `PlatformEngine::on_process_terminated` on TUN-mode sing-box exit.

## Why the restore-before-kill order matters

In `stop_tun_process` (macOS) / `stop_tun_and_restore_dns` (Linux) we restore DNS **first**, then kill sing-box. If we killed sing-box first, TUN tears down, the default route reverts to the physical NIC, and for ~500 ms the system DNS still points at an unreachable `172.19.0.1` — every app's DNS lookup times out during that window. Restoring first overwrites the stale gateway while it's still addressable.

Windows doesn't need an explicit order here: the reset runs inside the service process before the SCM state transitions to STOPPED, so by the time the TUN is removed the registry's `NameServer` values are already cleared.

## Why the macOS verify phase runs AFTER kill

The user-stop path on macOS intentionally straddles `stop_sing_box` with its two DNS phases. The reason is counter-intuitive: while sing-box is alive, every UDP packet this process emits — including the DNS probes in `verify_and_fallback` — gets picked up by the TUN device and routed through the active outbound proxy. So every public DNS we probe looks reachable regardless of whether the physical network can actually reach it. The fallback to `get_best_dns_server` would never fire, and a captured DNS that's been dead for hours (e.g. a Wi-Fi gateway IP the user has since roamed away from) would stay configured, leaving the system unable to resolve anything after TUN goes away. Only once `stop_sing_box` + `remove_tun_routes` run do probes egress through the physical NIC and report truthful liveness. That's why phase 1 (write) must happen before the kill (for the restore-before-kill reason above) but phase 2 (probe + fallback) must happen after.

The crash path (`on_process_terminated`) doesn't need this split — sing-box is already dead when the monitor fires.

## Methodology reminder: expand every verb in the TUN lifecycle

> This section is a concrete application of the general principle documented in the project `CLAUDE.md` § "Step-by-step semantic analysis for sequential code". If you're here because you were pointed from that section, this is the probe-after-kill walkthrough it references.

When editing any step in the TUN start/stop/restart sequence, **expand the verb into its concrete system-state effect** before deciding where a new step goes. "`stop_sing_box`" is not "stop a process" — it is "tear down the `utun233` device so the kernel no longer captures this process's outbound packets". "`remove_tun_routes`" is not "clean up" — it is "delete the routes that tell the kernel to hand `172.19.0.1` to TUN". A step that emits packets from this process (probe, telemetry, health check, log upload) must check whether **TUN is still the default route at the insertion point**. If yes, the packet is captured by TUN and routed through the proxy — it tells you nothing about the physical network. The probe-after-kill bug in this module's history came from treating `stop_sing_box` as an abstract "stop the process" rather than "take down the virtual NIC". Rule of thumb: if you cannot state, in one sentence, what observable kernel / socket / routing state changes across a given step boundary, stop and read the code for that step before inserting anything adjacent. See also `~/.claude/CLAUDE.md` → *Step-by-step Semantic Analysis*.
