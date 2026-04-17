# System DNS Override Flow

> OneBox subsystem deep-dive. Extracted from the project `CLAUDE.md`. Read when touching `engine/macos/mod.rs`, `engine/linux/mod.rs`, `engine/windows/native.rs`, `tun-service/src/dns.rs`, `commands/dns.rs`, or `core/monitor.rs::handle_process_termination`. Paths are repo-relative; if anything here disagrees with the code, trust the code and update this file.

Core principle: **DNS override is a single directed "set" on the active (or every non-TUN) interface. Restore is targeted on macOS and Linux (re-apply per-service/iface captured originals; verify + fall back to best public DNS if the original is unreachable), and scorched-earth on Windows (enumerate → blank registry) because Windows' per-adapter restore would require a lot more state tracking for little user benefit.**

## Why DNS needs overriding at all

Without a system DNS override, `mDNSResponder` / `systemd-resolved` / Windows `Dnscache` bind their upstream DNS sockets directly to physical interfaces (`IP_BOUND_IF`, `SO_BINDTODEVICE`, SMHNR parallel query). **These bypass the routing table**, so the TUN device never sees the query, sing-box's `hijack-dns` route rule never fires, and DNS leaks to whichever DHCP-provided server GFW injects against.

Pointing system DNS at the TUN gateway (e.g. `172.19.0.1`) forces every query into TUN regardless of socket binding, because that IP is only reachable *through* TUN — no physical NIC has a route to it.

## Apply (on TUN start)

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

## Restore (on TUN stop / crash / reload)

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

## What we deliberately DON'T do

- **No backup file.** The prior design wrote `/tmp/onebox-dns-backup.tsv`. Deleted. Windows uses the OS's "back to DHCP" primitive; macOS and Linux use process-local `Mutex` stashes that die with the process.
- **No "only restore if we applied" guard.** Every termination path calls restore. On macOS/Linux the capture stash is authoritative — if it's empty, restore is a no-op; if it has entries, restore runs unconditionally. Benefit: immune to crashes between apply and restore.
- **No attempt to preserve the user's manual DNS on unrelated Windows adapters.** If Ethernet had `1.1.1.1` set manually while Wi-Fi was running OneBox, Windows stop will reset Ethernet too. Accepted trade-off — see Design Philosophy #6 in `CLAUDE.md`. macOS and Linux preserve untouched interfaces because their per-service/iface restore primitives are cheap; Windows' `HKLM\…\Interfaces\{GUID}` per-adapter state would require tracking which GUIDs we touched across service restarts, not worth it.
- **macOS: no write-time DNS override re-capture.** When `NetworkUp` fires (Wi-Fi flap, interface switch), `apply_system_dns_override` runs again, but `DNS_CAPTURED` only appends if the service isn't already present. Re-capturing would read back our own TUN gateway IP as the "original" and clobber the real original on stop.
- **macOS: no scorched-earth fallback.** The original macOS restore ran `networksetup -setdnsservers <svc> empty` on *every* network service at stop time — simpler code, identical semantics for TUN-touched services, but it destroyed users' manual DNS on interfaces OneBox never had reason to touch (secondary Ethernet, VPN profiles, etc.). The current targeted `DNS_CAPTURED`-based design lives in `engine/macos/mod.rs`. Don't "simplify" back to scorched-earth: Design Philosophy #6's "accept small edge-case data loss" explicitly excludes this case because the loss is reproducible on *every* TUN stop, not edge-case.

**DNS_CAPTURED invariant (macOS)**: append-only during the TUN session, drained exactly once by `take_all_captured`. **Never** overwrite an existing entry. If you add a code path that mutates it, the "manual DNS survives TUN" property breaks.

## Files

- `src-tauri/src/engine/common/helper.rs` — `extract_tun_gateway_from_config` (parses the rendered config for the TUN inbound's IPv4).
- `src-tauri/src/engine/macos/mod.rs` — `DNS_CAPTURED` stash, `apply_system_dns_override` (captures + writes), `apply_captured_originals_sync` + `verify_and_fallback` (the two restore phases), `restore_system_dns` (crash-path wrapper), `read_service_dns`, `detect_active_network_service`, `list_all_network_services`, `stop_tun_process`. XPC calls go to the privileged helper in `engine/macos/helper.{rs,m}`.
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

When editing any step in the TUN start/stop/restart sequence, **expand the verb into its concrete system-state effect** before deciding where a new step goes. "`stop_sing_box`" is not "stop a process" — it is "tear down the `utun233` device so the kernel no longer captures this process's outbound packets". "`remove_tun_routes`" is not "clean up" — it is "delete the routes that tell the kernel to hand `172.19.0.1` to TUN". A step that emits packets from this process (probe, telemetry, health check, log upload) must check whether **TUN is still the default route at the insertion point**. If yes, the packet is captured by TUN and routed through the proxy — it tells you nothing about the physical network. The probe-after-kill bug in this module's history came from treating `stop_sing_box` as an abstract "stop the process" rather than "take down the virtual NIC". Rule of thumb: if you cannot state, in one sentence, what observable kernel / socket / routing state changes across a given step boundary, stop and read the code for that step before inserting anything adjacent. See also `~/.claude/CLAUDE.md` → *Step-by-step Semantic Analysis*.
