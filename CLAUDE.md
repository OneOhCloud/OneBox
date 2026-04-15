# OneBox — Project Notes for Claude

## Design Philosophy

These principles drive the template-cache and DNS-override subsystems below. Apply them to new code that touches system state or long-lived caches.

**1. State belongs to ground truth, not to our code that manipulates it.**
If the OS / filesystem / store already holds the canonical state, don't shadow it with a snapshot. We are thin orchestrators of system-native operations, not state managers.

**2. Operations are idempotent — no guards, no "only call if needed" checks.**
Every mutation can be run repeatedly without harm. This means callers never have to track "did I already do X?", and crash-recovery paths can call the operation unconditionally.

**3. Cleanup is scorched-earth, driven by patterns, not by tracked entities.**
Enumerate the universe (store keys, network services, network adapters), match by shape (key pattern, non-default state), and reset every match. Never maintain a list of "things I touched."

**4. Reads and writes are decoupled. Stale reads are allowed.**
The read path is fast, local, never blocks on network. The write path refreshes in the background. The two paths don't synchronize — the read may return old data while a write is mid-flight, and that's fine.

**5. System-native semantics > reinvented state.**
Each platform has its own "revert to default" primitive (macOS `networksetup empty`, Linux `resolvectl revert`, Windows `-ResetServerAddresses`, `store.delete`). Use them. Don't re-implement their effect with our own snapshot/replay logic.

**6. Trade-off bias: accept small edge-case data loss for crash-safety and simplicity.**
A stateless reset might nuke a user's unrelated manual DNS on Ethernet; a scorched-earth purge might delete a fringe store key. These are acceptable. What is not acceptable: leaving the system in a half-applied state because our replay logic couldn't unwind it correctly.

**One-liner**: *Tell the system to start and stop; let the system decide what "stopped" means.*

---

## System DNS Override Flow

Core principle: **on all three platforms, DNS override is a single directed "set" on the active interface, and restore is a system-native "reset all" enumerated by shape — no snapshot, no backup file, no in-process state.**

### Why DNS needs overriding at all

Without a system DNS override, `mDNSResponder` / `systemd-resolved` / Windows `Dnscache` bind their upstream DNS sockets directly to physical interfaces (`IP_BOUND_IF`, `SO_BINDTODEVICE`, SMHNR parallel query). **These bypass the routing table**, so the TUN device never sees the query, sing-box's `hijack-dns` route rule never fires, and DNS leaks to whichever DHCP-provided server GFW injects against.

Pointing system DNS at the TUN gateway (e.g. `172.19.0.1`) forces every query into TUN regardless of socket binding, because that IP is only reachable *through* TUN — no physical NIC has a route to it.

### Apply (on TUN start)

Each platform detects the currently-active network interface and issues **one** system command:

| Platform | Detection | Command |
|---|---|---|
| macOS | `route -n get default` → `networksetup -listallhardwareports` | `networksetup -setdnsservers <service> <gw>` |
| Linux | `ip route get 1.1.1.1` | `resolvectl dns <iface> <gw>` |
| Windows | `Get-NetRoute -DestinationPrefix 0.0.0.0/0` (filter TUN aliases) | `Set-DnsClientServerAddress -InterfaceAlias <alias> -ServerAddresses <gw>` |

No backup is taken. The TUN gateway IP comes from `helper::extract_tun_gateway_from_config` parsing the rendered sing-box config.

### Restore (on TUN stop / crash / watchdog)

Each platform **enumerates every non-loopback interface** and calls the system's native "revert to default" primitive on each. This is idempotent — running it on an interface we never touched is a no-op:

| Platform | Enumeration | Reset command per entry |
|---|---|---|
| macOS | `networksetup -listallnetworkservices` (strip disabled `*` prefix) | `networksetup -setdnsservers <service> empty` → DHCP default |
| Linux | `ip -br link show` (strip `lo`) | `resolvectl revert <iface>` → NetworkManager / netplan config |
| Windows | `Get-NetAdapter` | `Set-DnsClientServerAddress -InterfaceAlias <alias> -ResetServerAddresses` → DHCP default |

Restore is called from three sites, all unconditionally:

1. `vpn::<platform>::stop_tun_process` — normal user-initiated stop. Runs *before* killing sing-box so the user's network isn't stuck pointing at an unreachable TUN gateway if the kill fails.
2. `core::handle_process_termination` — watchdog fallback. Fires whenever a TUN-mode sing-box process exits, regardless of how. Since restore is idempotent, we call it with no file-existence check and no state lookup.
3. Windows also calls it from a dedicated UAC-elevated PS script in the crash path (restore embedded in stop script + restart-on-crash script).

### What we deliberately DON'T do

- **No backup file.** The prior design wrote `/tmp/onebox-dns-backup.tsv` storing the user's original DNS values so restore could replay them. Deleted. The restore now uses the OS's built-in "back to DHCP" semantics.
- **No in-process state tracking of "which service did I touch".** The process manager tracks `tun_password` (needed for sudo) but nothing DNS-specific.
- **No "only restore if we applied" guard.** Restore always runs on TUN termination. Cost: a few hundred ms of no-op `setdnsservers` / `resolvectl revert` calls. Benefit: immune to crashes between apply and restore.
- **No attempt to preserve user's manual DNS on unrelated interfaces.** If the user had `1.1.1.1` manually set on Ethernet while using Wi-Fi with OneBox, stop will reset Ethernet too. Accepted trade-off — see Design Philosophy #6.

### Files

- `src-tauri/src/vpn/helper.rs` — `extract_tun_gateway_from_config` (parses sing-box config to find TUN inbound's IPv4 address)
- `src-tauri/src/vpn/macos.rs` — `apply_system_dns_override` / `restore_system_dns` + `detect_active_network_service` / `list_all_network_services`
- `src-tauri/src/vpn/linux.rs` — `apply_system_dns_override` / `restore_system_dns` + `detect_active_iface` / `list_all_ifaces`
- `src-tauri/src/vpn/windows.rs` — `prepare_dns_override` / `build_dns_apply_block` / `build_dns_restore_block` (embedded in elevated PS scripts)
- `src-tauri/src/core.rs::handle_process_termination` — watchdog fallback that unconditionally calls restore on TUN termination

### Why the restore-before-kill order matters (macOS / Linux)

In `stop_tun_process` we restore DNS **first**, then kill sing-box. If we killed sing-box first, TUN tears down, the default route reverts to physical NIC, and for ~500ms the system DNS is still pointing at a now-unreachable `172.19.0.1` — every app's DNS lookup times out during that window. Restoring first means the stale gateway address is overwritten before its addressability vanishes.

Windows batches both steps into a single elevated PS script, so ordering there is script-internal.

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

CI release workflows (`.github/workflows/{stable,beta,dev,manual}-release.yml`) run the sync **explicitly** as a "Sync config templates" step right after "Download Binaries", not relying on the prebuild hook. Two reasons:

1. **Fail-early visibility** — if sync fails (GitHub 404, parse error, network flake), we want to see it in a dedicated CI step with clear logs, not hidden mid-`tauri build` 10 minutes later.
2. **Belt-and-suspenders against bun pre-hook breakage** — if a future bun version changes how it invokes `prebuild`, the explicit step still produces a valid `generated.ts` before `tauri-action` runs. The prebuild hook in `package.json` remains for local dev.

Each channel's step sets its own `CONF_TEMPLATE_BRANCH` via env (`stable` / `beta` / `dev` / `stable` for manual). After running sync, the step greps for `BUILT_IN_TEMPLATE_OBJECTS` / `BUILD_TIME_TEMPLATE_SOURCE` / `singBoxVersion: 'v` in the output as a smoke check — catches silent corruption before the real build wastes time.

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
