# Config Template Loading Flow

> **Claude-facing, not human-facing.** Optimised for Claude execution; see [`README.md`](README.md) for directory-wide conventions (preamble shape, `Do not X` framing, file:line style). Read when editing template JSONC, bumping sing-box versions, changing the cache shape, or debugging "remote has it but built-in doesn't" (or vice versa). Touches `scripts/sync-templates.ts`, `src/config/**`, `src/hooks/useSwr.ts`, `src/single/store.ts`. Paths are repo-relative; if anything here disagrees with the code, trust the code and update this file.

Core principle: **there is one source of truth — the `conf-template` repo — and every template OneBox ever uses traces back to it**. Both the built-in fallback (baked at build time) and the live-fetched runtime cache (refreshed by SWR) are snapshots of the same upstream files. They can never disagree in shape, only in freshness.

## Single source of truth: `conf-template` repo

The `conf-template` repo (`OneOhCloud/conf-template`) owns all 4 template variants (`tun-rules`, `tun-global`, `mixed-rules`, `mixed-global`) across all supported sing-box versions (`1.12`, `1.13`, `1.13.8`, …). Only `conf/1.13.8/zh-cn/*.jsonc` is hand-edited; derived versions are produced by a generator in that repo. The generator also runs the static validator + `sing-box check` on every emitted file — invalid templates can never reach the CDN.

See `conf-template/CONVENTIONS.md` for the contract.

## Build-time path (bake a snapshot into the binary)

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

## Runtime read path (non-blocking, stale allowed)

`config/merger/main.ts::getConfigTemplate(mode)`:

1. Read the current-schema v2 key from the `tauri-plugin-store` file cache (`settings.json`).
2. If present → parse and return (stale content is acceptable).
3. If absent → call `getBuiltInTemplate` from `config/templates/index.ts` which looks up the build-time object in `BUILT_IN_TEMPLATE_OBJECTS[mode]`, runs `JSON.stringify` on it to get a string, writes that into the cache, then returns the string for the caller's subsequent `JSON.parse`. Seeding happens once; subsequent reads are pure cache hits.

`templates/index.ts` only stringifies on the cache-miss path, so the work happens at most four times per app launch (once per configType, in the fallback path). The caller's string-based store interface stays unchanged.

No network I/O on this path. `setTunConfig` / `setMixedConfig` / their `-global` variants all go through `getConfigTemplate` — the merge step's **only** template source is the cache.

The hand-written `TunRulesConfig` / `TunGlobalConfig` / `mixedRulesConfig` / `miexdGlobalConfig` (sic — typo preserved from the removed source so this sentence still matches `git log -S` / blame searches; don't "correct" it) object literals are gone. `getBuiltInTemplate` is a ~15-line dispatcher over `BUILT_IN_TEMPLATE_OBJECTS[mode]`; the old `config/version_1_12/` directory has been renamed to `config/merger/` (its historical name — "version_1_12" — no longer reflected the actual sing-box version) and the vestigial `zh-cn/config.ts` is gone.

## Runtime write path (background periodic refresh)

`hooks/useSwr.ts::primeAllConfigTemplateCaches` (invoked via a SWR hook in `App.tsx`):

1. For each `configType` in parallel, call `primeConfigTemplateCache(mode)`:
   - Try `fetch(remote URL)` → on success, write JSON string to the v2 key.
   - On any failure (network / non-HTTPS URL / parse error), write the build-time snapshot from `generated.ts` to the v2 key.
2. The write is unconditional — every prime overwrites the cache so it reflects the latest attempt.

The SWR hook uses `revalidateOnFocus: true` + `dedupingInterval: 30 min`. Cold start triggers one prime; focus and the 30-minute window trigger further refreshes. The prime path is completely independent of `getConfigTemplate` — the merger may read a stale cache while a prime is in flight, and that's fine.

## The two-path model in one picture

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

## Cache shape

- Key: `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-config-cache-v${TEMPLATE_CACHE_SCHEMA_VERSION}`
- `TEMPLATE_CACHE_SCHEMA_VERSION` is bumped whenever a sing-box upgrade makes prior cached templates unusable (e.g. 1.13.8 rejecting legacy `sniff` inbound fields).
- Value: JSON string (stringified sing-box config template).

## Legacy purge (scorched-earth)

`hooks/useSwr.ts::purgeLegacyTemplateCache` runs once at app mount (SWR with `dedupingInterval: Infinity`). It enumerates `store.keys()` rather than relying on a hardcoded list so every historical shape is cleaned in one pass:

- Any key containing `-template-config-cache` that isn't the current v2 key → delete. Covers old-major (`1.12`), suffix-less v1, and orphan naming (`-rules-template-config-cache`).
- Any `-template-path` override whose value points at a stale URL (e.g. `conf/1.13/zh-cn/` post-1.13.8) → delete the override **and** the sibling v2 content cache (which was poisoned by the stale URL). `getDefaultConfigTemplateURL` will then resolve to the migrated path.

Purge + prime run in parallel at mount. Order doesn't matter: if purge wipes a poisoned v2 cache, prime repopulates it from the new default URL; if prime lands first, purge detects the stale-override signature and still wipes it, and the next prime cycle re-seeds.

## What we deliberately DON'T do

- **Do not hand-edit `src/config/templates/generated.ts`.** It is `.gitignore`d and regenerated from `conf-template` by `scripts/sync-templates.ts` on every `predev` / `prebuild` hook and in the CI "Sync config templates" step. Any hand edit will be overwritten on the next dev/build and will silently diverge from upstream in the meantime.
- **Do not bake built-in templates as JSON-string literals embedded in TS.** Prior design did this and introduced double-escaping bugs on any unusual character. The generator now emits real TypeScript object literals (`export const X = { ... } as const`) so `tsc` catches malformed JSON at build time. If you find yourself reaching for `JSON.stringify` inside `sync-templates.ts`, you are re-introducing the bug class — the stringification must happen only on the cache-write path in `templates/index.ts::getBuiltInTemplate`.
- **Do not add network I/O to `getConfigTemplate` or any `set*Config` merger.** The read path is pure cache access by design so TUN toggle latency never depends on network. If a caller appears to "need fresh data", it should trigger a `primeConfigTemplateCache` via SWR and keep reading the cache, not synchronously fetch.
- **Do not gate `primeConfigTemplateCache` on "only write if stale".** Every prime overwrites the cache unconditionally so the write path reflects the latest attempt. A stale-check would re-introduce the "built-in fallback drifted from remote" class of bug (the `www.qq.com → overseas IP` regression was this).
- **Do not replace the scorched-earth `purgeLegacyTemplateCache` with an allowlist.** It enumerates `store.keys()` and deletes anything matching the legacy-shape signature — this is how it catches historical key shapes we no longer remember. An allowlist requires updating a hardcoded list every time the cache key shape changes and will silently fail to purge shapes added between releases.
- **Do not change the cache value type from JSON string to object.** Every reader and writer expects `string` at the `tauri-plugin-store` boundary — changing it breaks the `set*Config` mergers that `JSON.parse` it and the SWR primer that `JSON.stringify`s before writing.
- **Do not "correct" the typo `miexdGlobalConfig` in historical references.** See the preserved-typo note on the `TunRulesConfig` / `miexdGlobalConfig` line in the runtime-read-path section — `git log -S miexdGlobalConfig` and blame searches rely on the typo staying visible in tracked text.
- **Do not enhance the built-in snapshot with rules not present in the remote `conf-template` commit.** The single-source-of-truth invariant (both paths trace to the same upstream commit) is how "works in built-in fallback but not in live" is made structurally impossible. Any built-in-only rule re-opens that failure mode.

## Why this shape

- **Single source of truth removes a class of bugs.** Before the generator + sync, built-in fallbacks drifted away from remote templates (the `www.qq.com → overseas IP` regression was exactly this: remote dropped `dns.rules`, built-in still had it, only the runtime-cache-via-remote path was hit). Now both trace to the same `conf-template` commit, so "works in built-in fallback but not in live" is structurally impossible.
- **Decoupled read/write.** TUN toggle latency never depends on network. Users with flaky connectivity still get fast starts from the last-known-good cache.
- **Build-time fallback absorbs the "binary never updates" risk.** Clients that get one build and sit on it forever still have a frozen-but-valid template from ship day. Not ideal, but much better than hand-written fallbacks that ossify at first-commit time.
- **Schema version + scorched-earth purge.** Upgrades that invalidate old templates bump `TEMPLATE_CACHE_SCHEMA_VERSION`, and the purge sweeps everything that doesn't match the current key on next launch, so a client upgrade can never use a poisoned cache from a previous version.

## Files

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
