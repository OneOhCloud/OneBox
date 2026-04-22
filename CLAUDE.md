# OneBox — Project Notes for Claude

## Dispatch protocol (hard rule)

Dispatch protocol is mandatory. Main Claude does NOT edit production code directly — dispatch `implementer` (forward work) or `investigator` (root-cause) first. Inline work is allowed ONLY for the exhaustive exceptions listed in `~/.claude/orchestrator.md § orchestrator rules § rule 5 (exhaustive)` (meta-docs, read-only Q&A, standard-gate runs, ≤ 3-LOC typo/comment fixes, git inspection, user-facing summaries). No size-based escape hatch.

---

## Reading guide

**Table of contents**:

1. **User-visible text** — UI copy, toasts, CHANGELOG; never say "订阅" / "subscription"
2. **Hashed domain allowlist is a secret** — never write the pre-image in code, comments, docs, commits, or logs
3. **Reading third-party source** — clone upstream at the pinned version, don't rely on web search
4. **Deep link bug triage** — log-first checklist (Rust saw it? hot/cold? parsed? timing?)
5. **Logging discipline** — write logs anticipating triage (companion to §4)
6. **Release workflow triggers** — one workflow, four channels, `make bump` only
7. **Privileged helper version bump (macOS)** — editing `src-tauri/helper/` requires a manual `CFBundleVersion` bump; no auto-sync
8. **GitHub CLI access** — `gh` is the preferred interface for this repo
9. **Test-first cadence** — write fn → write test → run local → pass → next; CI runs both layers
10. **Verifying Linux from a macOS host** — `make linux-check`; commits are not transport
11. **Workflows that need my hands** — `scripts/tmp-*.sh` with manual gates + sanity checks
12. **Design Philosophy** — principles driving DNS / template subsystems
13. **Windows Platform Implementation Philosophy** — native Win32 over PowerShell
14. **Step-by-step semantic analysis** — expand every verb in a sequence before inserting adjacent to it
15. **Subsystem deep-dives** — DNS override, config templates, update argv suppression (in `docs/claude/`)

### Meta-rule: when rules tension against each other

**User-visible expression chases current; internal code identifiers chase stable.**

Concrete case: UI copy must move from `订阅` to `配置`, but the function `addSubscription()` stays — because renaming it touches dozens of call sites for zero user-facing benefit.

When in doubt: ask "what breaks if I change this?" If only a reader's eye is involved, follow the newer rule. If call sites or external references break, preserve the old shape.

### Meta-rule: what belongs in this file

**Belongs here**:
- Constraints re-learned through repeated pain (a bug root-caused the same way twice).
- Design decisions whose rationale is invisible from the code alone — especially *why we DON'T* have some plausible mechanism.
- Cross-platform or cross-subsystem principles that need one canonical statement.
- Workflow invariants the assistant can't derive from the repo (manual-gate procedures, VM hostnames, which command wraps what).

**Does NOT belong**:
- Single-point implementation details — a code comment is enough.
- Temporary workarounds — use a `TODO` at the site.
- Style preferences with no downstream consequence.
- Anything `rg` + a minute of reading would turn up reliably.
- Detailed subsystem walk-throughs — put those in `docs/claude/<name>.md` and link from the "Subsystem deep-dives" section.
- Rules that can be encoded as tooling — move the rule into the tool and delete the prose. Example: the "canonical Tailwind classes over arbitrary px" policy used to live here; it now lives in `scripts/check-tailwind-canonical.ts` + a `.husky/pre-commit` gate, so this doc no longer carries it.

Rule of thumb for sedimenting a new entry: if you catch yourself explaining the same thing across three different conversations, write it down. If it's a one-off, don't — this file's value is inverse to its length.

---

## User-visible text: shortest, plainest, product-accurate

Meta-rule: **whenever the user will read the string, use the shortest product-accurate wording — avoid developer jargon, implementation details, and SaaS/billing vocabulary that doesn't fit what OneBox actually is.** This applies to every user-facing surface: UI copy, toast/alert text, placeholders, labels, button captions, aria-labels, list fallback names, and `CHANGELOG.MD`.

### Never say "subscription" / "订阅"

Use **"配置"** (Chinese) and **"Config"** (English) when referring to the user's saved server configurations. Avoid every variant of:

- `订阅` / `订阅管理` / `订阅列表` / `订阅链接` / `订阅文件`
- `配置文件` (use the shorter `配置` instead)
- `subscription` / `subscriptions` / `Subscription(s)`

Shortest possible term wins: `配置` (2 chars) beats `配置文件` (4 chars) beats `订阅配置` (4 chars). English: `Config` beats `Configuration` beats `Subscription`.

Why: it's a local config store, not a SaaS service — "subscription" misleads users into expecting billing / account flows that don't exist.

**Boundary**: this only governs **display text**. Code identifiers (`addSubscription`, `GET_SUBSCRIPTIONS_LIST_SWR_KEY`, i18n keys like `add_subscription`) keep legacy names to avoid a disruptive rename.

### CHANGELOG entries

`CHANGELOG.MD` is written for **end users**, not developers. Each entry should be a single sentence describing what the user can observe. Do not include implementation details, file paths, config field names, code-level terms (e.g. `route_exclude_address`, `inbound`, `hijack-dns`), root-cause analysis, RFC terminology, or emoji. Provide both English and Simplified Chinese entries.

Bad: `Fixed bypass-router mode where the Mixed inbound listened on 127.0.0.1, making LAN hosts unreachable`
Good: `Fixed bypass-router mode not handling DNS and traffic from other devices on the LAN`

## Hashed domain allowlist is a secret

The compile-time hash lists (`KNOWN_HOST_SHA256_LIST` in
`src-tauri/src/commands/whitelist.rs`, the mirror arrays in OneBoxRN's
`profile-loader.ts` / `domain-verification.ts` / `BackgroundConfigWorker.kt` /
`BackgroundConfigRefresh.swift`) are SHA256 digests **precisely because
the pre-image must not be visible in source**. The digest is the full
public surface; revealing which domain or suffix it corresponds to
defeats the purpose.

Rules:

- Never write the plaintext domain/suffix in any comment, docstring,
  variable name, test case, commit message, PR description, or log
  line — whether in this repo or in OneBoxRN.
- Never grep-test by echoing "sha256 of X is Y" in conversation or in
  commit bodies; compute offline, paste only the hex.
- CHANGELOG entries that add a new approved host must describe the
  user-visible change ("expanded config import to additional servers")
  without naming the host.
- If you catch yourself writing a hint like `// sha256("example.com")`,
  strip it. The hash already documents what it does — it approves some
  subtree; which subtree is intentionally opaque from the code.

Why: the hash allowlist is the only thing between an attacker with a
OneBox build and the set of domains we trust enough to auto-apply. Any
leak of the pre-image turns the hash check into a publicly-documented
string comparison.

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

Runtime log location:

- macOS: `~/Library/Logs/cloud.oneoh.onebox/OneBox.log`
- Linux: `~/.config/cloud.oneoh.onebox/logs/`
- Windows: `%APPDATA%\cloud.oneoh.onebox\logs\`

For **any** deep-link report ("doesn't auto-import", "opens the app but does nothing", "sometimes works, sometimes doesn't"), open this file **before** reading Rust or TS source. Key markers are all produced by `src-tauri/src/app/setup.rs`.

Triage checklist — run in order, stop at the first step that answers the question:

1. **Did Rust see the URL at all?** Grep for `Received deep link: [Url { ... }]` near the failure timestamp.
   - Absent → the bug is on the **OS / plugin side** (URL scheme registration, file association, browser handoff). Not in OneBox's TS/apply logic. Stop reading Rust source.
   - Present → continue.

2. **Hot start or cold start?** Look at the line immediately preceding the deep-link entry.
   - `[engine-state] ... (epoch=N)` right above → **hot start** (app was already running). The frontend listener is guaranteed registered; failures from here on are almost always payload-parsing or apply-logic bugs, not races.
   - `Copying database files` above with no prior state line → **cold start**. First-install cold start is the scenario most likely to race the frontend's `listen('deep_link_pending', ...)` registration.

3. **Windows/Linux cold-start fallback marker.** On Windows/Linux, `on_open_url` can fire before the plugin is fully registered; `deep_link().get_current()` then catches it and logs:
   - `Cold-start deep link config data: ... apply=<bool>`.
   - If step 1 was absent on Windows/Linux but *this* marker is present, the cold-start fallback is working as intended.

4. **Did the payload parse?** Look for `Received config data: <base64> apply=<bool>`. If steps 1/3 succeeded but this is absent, the payload itself (URL shape, base64 encoding) is malformed — not a timing bug.

5. **Timing relative to app setup progress.** Compare the deep-link timestamp to `Copying database files`, `User-Agent:`, and `captive.oneoh.cloud status:` — these mark `app_setup()` progress. A deep link arriving *before* the webview is ready is a different bug from one arriving after, and the fix lands in a different place.

If the log doesn't contain the failure reproduction, **ask the user to reproduce and attach fresh logs** before speculating. The source has several plausible race windows; the log pins down which one actually fired.

## Logging discipline: write logs anticipating triage

The deep-link triage checklist above works because the logs carry **stable grep markers**. Every new subsystem that mutates runtime state (engine lifecycle, helpers, DNS, updates, deep links) must ship with the same property — not as a retrofit after someone reports a bug.

This is the project-scoped restatement of the global `Logging Discipline` rule in `~/.claude/CLAUDE.md`. Kept here because OneBox's failure-triage workflow is almost entirely log-driven (GUI app, signed-build-only, TCC-gated helper — attaching a debugger is rarely an option), so every log-level mistake has an amplified cost.

### Level discipline

- `info!` — state transitions (something actually changed) and lifecycle heartbeats (thread spawned / run loop entered / watcher died). Anything a reader would list when asked "what did this subsystem do in the last minute?".
- `debug!` — per-call preambles, hot-path **no-op branches**, value traces. Anything that fires on unrelated system twitches (DHCP renew, Bonjour update, Wi-Fi scan, cache invalidation). At info these turn the log into noise and bury real transitions.
- `warn!` / `error!` — failures with actionable context (what failed, what input, what was expected).

Concrete case that bit this project: the SCDynamicStore DNS watcher (`engine/macos/dns_watcher.rs`) fires on every external DNS twitch, including round-trips from our own writes. The first version put the "already set to gateway, nothing to do" branch in `reapply_on_active_primary` at info — one external write produced 9–13 info lines, drowning the 3 that actually recorded the state change. Demoted to debug; the round-trip is now detectable only when the log level is raised.

### Stable `[subsystem]` prefix

Every log line carries a short, stable prefix so triage reduces to a pipeline of `grep` commands. Currently in use (not exhaustive — run `grep -Eo '\[[a-z-]+\]' OneBox.log | sort -u` to enumerate):

- `[engine-state]` — lifecycle state machine transitions, with `epoch=N`.
- `[dns]` / `[dns-watch]` — DNS override state machine and SCDynamicStore watcher.
- `[helper]` / `[helper-bridge]` — macOS privileged XPC helper install / ping / exit bridging.
- `[network]` — lifecycle NetworkUp / NetworkDown + debounced engine restart.
- `[reload]` — config reload (SIGHUP + DNS cache flush).
- `[start]` / `[stop]` — `core::start` / `core::stop` entry with `action=N`, a `ProcessManager` snapshot (child pid + liveness + mode), and a `:6789_listener=bool` probe. Each top-level lifecycle call issues a fresh `action=N` token (monotonic), so overlapping calls from independent triggers (user click + Wi-Fi switch + reload) can be disentangled by grepping on the token.
- `[sing-box]` — process-level events about the sing-box sidecar: `spawned pid=N`, `monitor attached`, `BIND FAILED: ...` (EADDRINUSE echo from stderr), and `terminated runtime=Xs code=C signal=S`.
- `[dns] phase 1` / `[dns] phase 2` — the two restore phases straddling `stop_sing_box` (see `docs/claude/dns-override.md`).

**Port-6789 occupation triage recipe** (for "reload / Wi-Fi switch leaves :6789 bound" reports):

```bash
# Which action tokens overlapped at the failure moment?
grep -E '\[(start|stop|reload)\] action=' OneBox.log
# Was :6789 already listening when a [start] entered, or unbound after [reload] sent SIGHUP?
grep -E ':6789(_listener|_NOT_LISTENING)' OneBox.log
# Did sing-box emit EADDRINUSE on stderr?
grep -E '\[sing-box\] pid=[0-9]+ BIND FAILED' OneBox.log
# All sing-box PIDs in this session, and how long each lived:
grep -E '\[sing-box\] (spawned|terminated)' OneBox.log
# How many sing-box processes were alive when reload fired?
grep -E '\[reload\] pgrep pre-pkill' OneBox.log
```

New subsystems pick one short, stable prefix and stick with it. Renaming silently invalidates every playbook / deep-dive / triage checklist that greps for it, including this file and `docs/claude/*.md`.

### The heartbeat exception

A log line that prints on every event even when nothing changed is redundant by construction — **unless** it's the only external evidence the subsystem is alive. OneBox keeps `[dns-watch] change event` at info for exactly that reason: a silent watcher thread that exits `CFRunLoop::run_current` unexpectedly would otherwise be undetectable until DNS drifts and a user complains. Accept low-level info redundancy in exchange for observability — it's cheaper than a periodic timer-based heartbeat.

### Ship-day checklist

Before merging a new subsystem that writes a log line:

1. List the plausible failure modes (never fires / fires but wrong branch / silently dies / races another subsystem).
2. Write the `grep` recipe that distinguishes each from the others. Example: *"watcher dead"* → `grep '\[dns-watch\] CFRunLoop exited'`; *"watcher alive but decision wrong"* → `grep '\[dns-watch\] change event'` followed by checking for a subsequent `[dns] apply: (fresh|external write detected|primary switched)`.
3. If any failure mode has no distinguishing marker, add one before merging.
4. Put the recipe table in the subsystem's deep-dive (`docs/claude/<name>.md`) alongside the code references. Commit messages rot; `docs/claude/*.md` is the durable home.

## Release workflow triggers

All four release channels (dev, beta, stable, manual) are served by a **single workflow**: `release.yml`. It is triggered by:

1. A `push` that modifies `src-tauri/tauri.conf.json` on the channel's own branch (dev: `feature/dev`, beta: `feature/beta`, stable: `main`), or
2. A manual `workflow_dispatch` from the Actions tab, where the operator picks the channel.

The workflow's `resolve` job maps the trigger to a channel, then derives all channel-specific parameters (tag name, prerelease flag, template branch, etc.). Beta and stable have a `check-reuse` job that can skip the full build by copying artifacts from the upstream channel (dev→beta, beta→stable) when the version matches.

Do **not** split this back into per-channel workflow files. The earlier multi-file design wasted GitHub Actions cache (each workflow had its own Rust cache namespace) and required every build-step change to be replicated four times. Do **not** chain releases with `workflow_run` triggers — an earlier design caused an automatic dev→beta→stable cascade on every dev push. If you see a reason to re-introduce either pattern, treat it as a design change that needs explicit discussion, not a "missing feature" to patch back in.

The canonical way to cut a release on any channel is `make bump` on that channel's branch, then push. Nothing else.

## Privileged helper version bump (macOS)

**Whenever you touch anything under `src-tauri/helper/` (`Sources/main.m`, `Info.plist`, `Launchd.plist`), manually bump `CFBundleVersion` in `src-tauri/helper/Info.plist` in the same commit.** `CFBundleShortVersionString` is user-visible; keep it loosely in sync but it's not the upgrade trigger. Forgetting the `CFBundleVersion` bump means the new helper silently never reaches end-user machines.

### Why: the whole upgrade path hinges on this one integer

`ensure_helper_installed` in `src-tauri/src/engine/macos/mod.rs` reads the `CFBundleVersion` string from **both** the bundled helper (`/Applications/OneBox.app/Contents/Library/LaunchServices/cloud.oneoh.onebox.helper`) and the installed helper (`/Library/PrivilegedHelperTools/cloud.oneoh.onebox.helper`) by scanning each binary's `__TEXT,__info_plist` section for the `<key>CFBundleVersion</key>` marker. Mismatch → `SMJobBless` → authorization prompt → new helper replaces old. Match → skip.

That string is the **only** signal. The privileged helper is a launchd-managed root daemon that keeps running across app updates — it answers XPC pings from the old code even after the user installs a new OneBox.app. Without a deliberate bump, the new helper bytes inside `Contents/Library/LaunchServices/` just sit there; `ensure_helper_installed` sees matching versions and moves on.

### What we deliberately DON'T do

- **No auto-sync from `tauri.conf.json` / the app version.** Every app release would flip the helper binary (the embedded `__info_plist` bytes change) and re-authorize SMJobBless on every update, including releases where helper code didn't move. Users would see the admin-password prompt on every bump — poor UX and desensitizes them to the prompt.
- **No SHA256 hash comparison.** Same failure mode: any embedded-plist edit (version, comments, anything) flips the hash even when the helper source is semantically identical. The version string is the narrower, intent-carrying signal.
- **No second source of truth (no helper-side constant, no app-side const).** `Info.plist` is the only place `CFBundleVersion` lives. The Rust runtime reads it from the on-disk binaries; the developer reads it from the plist when editing. One file to update, zero risk of drift.

The bump is the declaration "I changed helper source; existing users should pick it up on their next launch." Reserve it for real changes.

### Checklist when extending the helper XPC protocol

Every new parameter on a helper method touches 6 files in strict order — drift here is silent until a user hits the new path: (1) `src-tauri/helper/Sources/protocol.m` (interface) → (2) `helper.m` validator + method impl → (3) `helper/Info.plist` `CFBundleVersion` bump (see below) → (4) Rust FFI decl in `src-tauri/src/engine/macos/helper.rs` → (5) Obj-C shim in same file → (6) call site in `mod.rs`. Verify with `scripts/build-helper.sh` + `otool -s __TEXT __info_plist <helper-bin>`. Skipping any step = new code silently runs against old helper after install.

### Format

Apple spec: both fields are **period-separated non-negative integers**, no suffixes, no letters.
- `CFBundleShortVersionString` — exactly three components (`1.0.1`, never `1.0`, never `1.0.1-beta`).
- `CFBundleVersion` — one to three components (`2`, `1.5`, `1.0.1` all valid; `1` is equivalent to `1.0.0`). `make bump` does NOT touch either field — they are helper-local, not project-version-linked.

String comparison in `ensure_helper_installed` is literal byte equality on the extracted plist value, not numeric ordering. `"2"` ≠ `"1.0.0"` even though Apple treats them as equivalent — don't rely on Apple's equivalence rule when bumping; pick a monotonically increasing string that's textually different from the prior value.

### On release, what users see

- Helper source unchanged across a release → same `CFBundleVersion` on disk as already installed → no prompt, silent launch.
- Helper source bumped → versions differ → single SMJobBless authorization prompt ("OneBox wants to install a helper tool") on the first app launch after upgrade → new helper active from that point on.

### Covered by

`src-tauri/src/engine/macos/mod.rs::version_extract_tests` — four unit tests covering: minimal plist extraction, `CFBundleShortVersionString` substring safety, missing marker, missing file. These exercise `read_helper_cfbundle_version` directly; the `ensure_helper_installed` glue is not unit-tested (depends on SMJobBless + filesystem state in `/Library/PrivilegedHelperTools/`) and is exercised via manual install verification after a bump.

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

## Test-first cadence

Project restatement of the global "Write-test-first cadence" rule in `~/.claude/CLAUDE.md` § Testing. Kept here because OneBox ships pure helpers in both Rust and TS (hostname-suffix verification, URL parsers, state reducers, config mergers) where the cost of a unit test is near-zero and the bug classes caught would otherwise only surface on a specific platform at runtime — exactly the bugs that are most expensive to debug after shipping.

**Harnesses available in this repo:**

| Layer | How to run locally | Where CI runs it |
|---|---|---|
| Rust (`src-tauri`) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | `.github/workflows/test.yml` → `rust` job |
| Frontend (Vite + React) | `bun run test` (vitest) | `.github/workflows/test.yml` → `frontend` job |

Both jobs run on every push and PR and block merges on red. When authoring a new test worth keeping, wire it into the matching layer so CI exercises it automatically on the next push; disposable `scripts/tmp-*.sh` harnesses stay disposable and get deleted in the same merge cycle.

**Cadence**: write function → write test → run locally → pass → next step. Applies to all new pure helpers (parsers, decoders, hash glue, state transitions); skip is allowed for UI/view code with no business logic, but must be declared rather than silent.

**Escape hatch**: when a function's effect is only observable via TCC prompts, system authorization dialogs, `/Applications`-installed signed builds, or live DNS state, raise it up per the global escape-hatch rule — ask whether to ship a `scripts/tmp-*.sh` manual-gate harness, defer to human review, or record the gap. Never claim "tested" when you only eyeballed the change.

**End-of-session curation**: after the task is complete, list every new test and propose which belong in the permanent pipeline (`test.yml` vs. one-off `tmp-*.sh`). Wait for my explicit call before wiring anything new into shared CI.

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

**CWD reminder**: every `Bash` call starts from the project root; shell state does NOT persist between calls (per global CLAUDE.md). Use absolute paths (`cargo check --manifest-path src-tauri/Cargo.toml`, `bash /abs/path/to/scripts/build-helper.sh`) instead of `cd src-tauri && …` — chaining `cd` breaks the next tool call's assumptions and wastes rounds re-locating files.

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

## Design Philosophy

These principles drive the template-cache and DNS-override subsystems. Apply them to new code that touches system state or long-lived caches.

**Overarching trade-off** — *accept small edge-case data loss for crash-safety and simplicity.*
A scorched-earth purge might delete a fringe store key or reset a Windows adapter OneBox didn't care about — these are acceptable. What is **not** acceptable: leaving the system in a half-applied state because replay logic couldn't unwind it correctly. macOS DNS restore is the documented exception — it tracks per-service originals because user complaints about losing manual DNS outweighed scorched-earth's simplicity *in that specific case*. That exception's shape (a concrete user-visible harm, not abstract elegance) is the template all future exceptions should follow.

**1. State belongs to ground truth, not to our code that manipulates it.**
If the OS / filesystem / store already holds the canonical state, don't shadow it with a snapshot. We are thin orchestrators of system-native operations, not state managers.

**2. Operations are idempotent — no guards, no "only call if needed" checks.**
Every mutation can be run repeatedly without harm. Callers never track "did I already do X?"; crash-recovery paths call operations unconditionally.

**3. Reads and writes are decoupled. Stale reads are allowed.**
The read path is fast, local, never blocks on network. The write path refreshes in the background. The two don't synchronize — reads may return old data while writes are mid-flight, and that's fine.

**4. System-native semantics > reinvented state.**
Each platform has its own "revert to default" primitive (macOS `networksetup empty`, Linux `resolvectl revert`, Windows `-ResetServerAddresses`, `store.delete`). Use them. Don't re-implement their effect with our own snapshot/replay logic.

**Corollary of #1 + #4** — cross-platform cleanup shape follows the native primitive. Targeted where per-unit revert is cheap (macOS/Linux DNS: reapply captured originals). Scorched-earth where state tracking would be expensive (Windows per-adapter `HKLM\...\NameServer`: blank the whole category and let DHCP repopulate). See [`docs/claude/dns-override.md`](docs/claude/dns-override.md) § "What we deliberately DON'T do" for the macOS-specific history of *why* it's no longer scorched-earth on that platform.

**One-liner**: *Tell the system to start and stop; let the system decide what "stopped" means.*

---

## Windows Platform Implementation Philosophy

**1. Native Win32 over PowerShell.**
PowerShell pulls in a runtime, breaks under restricted execution policies, leaves transcript files behind, and forces escape-hell for paths with spaces. Direct API calls are deterministic and depend only on the OS itself.

**2. Demo-then-integrate for unsafe Win32 work.**
Build a small CLI binary that exposes each Win32 entry point as a subcommand, with unit tests for the pure helpers. Validate signatures, permissions, and real-machine behavior in isolation before touching production code paths.

---

## Step-by-step semantic analysis for sequential code

Cross-cuts every subsystem in this project. When inserting, reordering, or removing a step in a sequence (app startup, shutdown, lifecycle hooks, state transitions, request pipelines), **expand each verb into the concrete system-state change it causes** before deciding where the new step goes:

- "stop the X process" → tears down a virtual NIC? releases a listening port? invalidates a cache?
- "register the plugin" → appears in the plugin registry immediately, or on the next event-loop tick?
- "probe Y" → what packet, from which process context, through which routing layer?

Then verify the new step's semantic preconditions hold at its insertion point, and its postconditions stay valid for every subsequent step that depends on them.

**Inability to expand a verb is a signal, not a speedbump.** Stop and read the code, or write a minimal probe. Do NOT route around the gap with "it probably works" or "I'll handle edge cases later".

Where this has bitten in OneBox:

- **TUN lifecycle** — see the probe-after-kill walkthrough in [`docs/claude/dns-override.md`](docs/claude/dns-override.md) § "Methodology reminder". The bug came from treating `stop_sing_box` as "stop a process" rather than "take down the virtual NIC that's still capturing this process's UDP probes".
- **Deep-link registration timing** — `on_open_url` can fire before the plugin is fully registered; the Windows/Linux cold-start fallback in `app/setup.rs` exists because we expanded "plugin register" and found a race window.
- **`app_setup` ordering** — deep links arriving before vs. after the webview is ready produce different failure modes; see the triage checklist § "Timing relative to app setup progress".

Project-scoped restatement of the global `Step-by-step Semantic Analysis` rule in `~/.claude/CLAUDE.md`, kept here because OneBox's bugs cluster at sequence boundaries — always worth re-reading before editing a lifecycle path.

---

## Subsystem deep-dives

Three subsystems have their own design documents in [`docs/claude/`](docs/claude/). They are **not** loaded into the default CLAUDE.md context — you must fetch them explicitly.

**Everything in `docs/claude/` is Claude-facing, not human-facing.** Style, mandatory structure, and "Do not X" conventions are specified in [`docs/claude/README.md`](docs/claude/README.md). Read that file before creating or editing any doc in that directory — especially do not add human-flavoured prose (scenic examples, motivational framing, tutorial narration) to docs there.

**Trigger to fetch a deep-dive**: (a) you are about to edit a file in that section's *Read before editing* list, or (b) the user's report describes behaviour that subsystem covers (DNS leaks / stale DNS after stop, template-cache drift between built-in and remote, deep-link re-imports after an update). When either triggers, Read the linked file *before* proposing a fix.

Each deep-dive is self-contained and linkable from PR descriptions.

### DNS override flow → [`docs/claude/dns-override.md`](docs/claude/dns-override.md)

**Read before editing**: `src-tauri/src/engine/macos/mod.rs`, `engine/linux/mod.rs`, `engine/windows/native.rs`, `commands/dns.rs`, `tun-service/src/dns.rs`, `core/monitor.rs::handle_process_termination`.

System DNS is pointed at the TUN gateway IP on TUN start, because `mDNSResponder` / `systemd-resolved` / Windows `Dnscache` would otherwise bypass the route table via direct socket bindings. Restore is **targeted on macOS/Linux** (reapply captured originals) and **scorched-earth on Windows** (blank `NameServer` on every non-TUN adapter). **Trap** — macOS restore intentionally straddles `stop_sing_box`: the "obvious" all-before-kill ordering is wrong, and any edit to the TUN-stop sequence without reading the deep-dive will likely re-introduce the probe-after-kill bug. The deep-dive also covers the `DNS_CAPTURED` invariants, the verify-and-fallback pass, and everything the module deliberately does NOT do.

### Config template loading flow → [`docs/claude/config-template-loading.md`](docs/claude/config-template-loading.md)

**Read before editing**: `scripts/sync-templates.ts`, `src/config/merger/*`, `src/config/templates/*`, `src/hooks/useSwr.ts`, `src/single/store.ts`, or when bumping sing-box version / the cache schema.

Templates come from one source of truth (`OneOhCloud/conf-template`); both the build-time snapshot (`src/config/templates/generated.ts`, produced by `scripts/sync-templates.ts` via the pre-build hook and an explicit CI step) and the SWR-refreshed runtime cache (`tauri-plugin-store`) are snapshots of that same upstream. The read path never blocks on network; the write path refreshes in the background. A schema-versioned cache key plus a scorched-earth legacy-purge at mount prevents poisoned caches from surviving a client upgrade.

### Update-driven relaunch: deep-link argv suppression → [`docs/claude/update-argv-suppression.md`](docs/claude/update-argv-suppression.md)

**Read before editing**: `src-tauri/src/app/setup.rs` deep-link handling, `src/components/settings/updater*.tsx`, `src/utils/update.ts`.

`tauri-plugin-updater` on Windows/Linux forwards the process's argv to the newly-installed binary on relaunch. If the app was launched via `onebox-networktools://...`, the URL re-appears in argv and the deep-link plugin re-imports it on every update. Suppression uses a 5-minute timestamped marker in the settings store, with a closed write path and a TTL that must never be extended — both invariants, if broken, make the suppression silently wrong. macOS is unaffected (its deep links come through Cocoa `application:openURLs:`, not argv).
