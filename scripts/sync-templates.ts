#!/usr/bin/env bun
/**
 * Build-time sync of sing-box config templates from the conf-template repo.
 *
 * Contract:
 *   - `conf-template` is the single source of truth. This script pulls the
 *     latest snapshot at build time and bakes it into
 *     `src/config/templates/generated.ts` as string constants.
 *   - The runtime template loader (`getBuiltInTemplate` in
 *     `src/config/templates/index.ts`) reads from that file as its
 *     fallback when the user's template cache is empty.
 *   - The generated file is NOT committed (`.gitignore`d). Every fresh
 *     checkout re-runs this script via the `predev` / `prebuild` hooks.
 *
 * Why build-time (not runtime):
 *   - Clients that never update must still have a sane fallback — they get
 *     whatever snapshot was baked into the binary they installed.
 *   - Clients that can reach the network get live templates via SWR (see
 *     `src/hooks/useSwr.ts::primeAllConfigTemplateCaches`). Build-time
 *     snapshot and live-fetched content share the same source of truth, so
 *     they never diverge in shape — only in freshness.
 *
 * Version resolution mirrors `src/single/store.ts::getDefaultConfigTemplateURL`
 * — we pull from whichever `conf/<version>/zh-cn/` directory that URL resolver
 * would select at runtime, so the snapshot matches what the user's client
 * would fetch.
 *
 * Branch:
 *   - Defaults to `stable`. Override with `CONF_TEMPLATE_BRANCH=beta|dev` in
 *     CI workflows for non-stable release channels.
 *
 * Offline fallback:
 *   - If fetch fails but `generated.ts` already exists from a previous run,
 *     we keep it and exit 0 with a warning. This lets offline dev continue
 *     with a slightly stale snapshot. On fresh checkouts with no network,
 *     the build fails fast.
 */

import { parse as parseJsonc } from 'jsonc-parser';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SING_BOX_MAJOR_VERSION, SING_BOX_MINOR_VERSION, SING_BOX_VERSION } from '../src/types/definition';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO = 'OneOhCloud/conf-template';
const BRANCH = process.env.CONF_TEMPLATE_BRANCH ?? 'stable';

/**
 * Maps OneBox internal `configType` → the corresponding conf-template filename.
 * Mixed/TUN "rules" mode uses files suffixed `-rules.jsonc`; global uses `-global.jsonc`.
 * Keep in sync with `src/config/common.ts::configType` and
 * `src/single/store.ts::getDefaultConfigTemplateURL` (they must agree).
 */
const MODE_TO_FILE: Record<string, string> = {
    'mixed': 'mixed-rules.jsonc',
    'tun': 'tun-rules.jsonc',
    'mixed-global': 'mixed-global.jsonc',
    'tun-global': 'tun-global.jsonc',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/config/templates/generated.ts');

// ---------------------------------------------------------------------------
// Version path resolution
// ---------------------------------------------------------------------------

/**
 * Decide which `conf/<dir>/zh-cn/` to pull from, mirroring the runtime
 * URL resolver. 1.13.8+ pulls from `1.13.8/`; earlier 1.13 from `1.13/`;
 * 1.12 from `1.12/`.
 */
function resolveVersionPath(): string {
    const [majorStr, minorStr] = SING_BOX_MAJOR_VERSION.split('.');
    const patch = parseInt(SING_BOX_MINOR_VERSION, 10);
    if (!majorStr || !minorStr || Number.isNaN(patch)) {
        throw new Error(
            `invalid SING_BOX_VERSION: cannot parse "${SING_BOX_MAJOR_VERSION}.${SING_BOX_MINOR_VERSION}"`,
        );
    }
    if (majorStr === '1' && minorStr === '13' && patch >= 8) return '1.13.8';
    if (majorStr === '1' && minorStr === '13') return '1.13';
    if (majorStr === '1' && minorStr === '12') return '1.12';
    throw new Error(
        `unsupported sing-box version ${majorStr}.${minorStr}.${patch} — add a mapping in scripts/sync-templates.ts`,
    );
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string, label: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`${label}: HTTP ${res.status} ${res.statusText}`);
        }
        return await res.text();
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Best-effort fetch of the latest commit SHA on the target branch. Failure
 * is non-fatal — we still write `generated.ts`, just with an "unknown" SHA
 * in the metadata block. Used purely for traceability.
 */
async function fetchLatestSha(): Promise<string> {
    try {
        const res = await fetch(
            `https://api.github.com/repos/${REPO}/branches/${BRANCH}`,
            { headers: { 'User-Agent': 'onebox-sync-templates' } },
        );
        if (!res.ok) return 'unknown';
        const json = (await res.json()) as { commit?: { sha?: string } };
        return json?.commit?.sha ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

// ---------------------------------------------------------------------------
// Emit — write parsed templates as real TS object literals, not as
// JSON-strings-inside-TS. The advantage is that the generated file is
// parsed by `tsc` as normal TypeScript code: syntax errors trip the build
// immediately, and the runtime consumer can import the objects directly
// without a JSON.parse round-trip.
// ---------------------------------------------------------------------------

type FetchedMode = { mode: string; parsed: unknown };

function emitGeneratedFile(
    versionPath: string,
    commitSha: string,
    fetched: FetchedMode[],
): string {
    // Map mode -> TS identifier for the exported constant. Keeps dashes out
    // of exported names (TS disallows them in identifiers).
    const identFor: Record<string, string> = {
        'mixed': 'MIXED_TEMPLATE',
        'tun': 'TUN_TEMPLATE',
        'mixed-global': 'MIXED_GLOBAL_TEMPLATE',
        'tun-global': 'TUN_GLOBAL_TEMPLATE',
    };

    const constants = fetched
        .map((r) => {
            const body = JSON.stringify(r.parsed, null, 4);
            return `export const ${identFor[r.mode]} = ${body} as const;`;
        })
        .join('\n\n');

    const mapEntries = fetched
        .map((r) => `    '${r.mode}': ${identFor[r.mode]},`)
        .join('\n');

    return `// AUTO-GENERATED by scripts/sync-templates.ts — do not commit, do not edit.
// Regenerate: bun run sync-templates
//
// Source:  https://github.com/${REPO}/tree/${BRANCH}/conf/${versionPath}/zh-cn
// Branch:  ${BRANCH}
// Commit:  ${commitSha}
// Built:   ${new Date().toISOString()}
// sing-box: ${SING_BOX_VERSION}

import type { configType } from '../common';

export const BUILD_TIME_TEMPLATE_SOURCE = {
    repo: '${REPO}',
    branch: '${BRANCH}',
    commit: '${commitSha}',
    versionPath: '${versionPath}',
    singBoxVersion: '${SING_BOX_VERSION}',
    generatedAt: '${new Date().toISOString()}',
} as const;

${constants}

/**
 * Built-in template fallbacks, baked at build time from a snapshot of the
 * conf-template repo. Values are real JS objects — the runtime consumer
 * (\`src/config/templates/index.ts::getBuiltInTemplate\`) stringifies them
 * when seeding the cache, so the store sees the same JSON-string form
 * every other read path does.
 *
 * Clients that can reach the network pick up fresher templates via the
 * SWR prime hook in \`hooks/useSwr.ts\`, so this snapshot is the floor,
 * not the ceiling — its age matches the app binary's ship date.
 */
export const BUILT_IN_TEMPLATE_OBJECTS: Record<configType, unknown> = {
${mapEntries}
};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const versionPath = resolveVersionPath();
    const modes = Object.keys(MODE_TO_FILE);

    console.log(`[sync-templates] ${SING_BOX_VERSION} → conf/${versionPath}/zh-cn/  (branch: ${BRANCH})`);

    // Kick all fetches in parallel, including the optional SHA metadata lookup.
    let commitSha: string;
    let fetched: FetchedMode[];
    try {
        const results = await Promise.all([
            fetchLatestSha(),
            ...modes.map(async (mode): Promise<FetchedMode> => {
                const file = MODE_TO_FILE[mode];
                const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/conf/${versionPath}/zh-cn/${file}`;
                const text = await fetchText(url, file);
                const errors: any[] = [];
                const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
                if (errors.length > 0) {
                    throw new Error(
                        `${file}: jsonc parse errors\n` +
                            errors.map((e) => `  ${e.error} @offset ${e.offset}`).join('\n'),
                    );
                }
                if (!parsed || typeof parsed !== 'object') {
                    throw new Error(`${file}: did not parse as object`);
                }
                console.log(`[sync-templates]   ↓ ${file}`);
                return { mode, parsed };
            }),
        ]);
        commitSha = results[0] as string;
        fetched = results.slice(1) as FetchedMode[];
    } catch (e: any) {
        // Offline fallback: keep any existing generated.ts from a prior run.
        if (existsSync(OUTPUT_PATH)) {
            console.warn(
                `[sync-templates] fetch failed (${e?.message ?? e}); keeping existing snapshot at ${OUTPUT_PATH}`,
            );
            return;
        }
        throw e;
    }

    const content = emitGeneratedFile(versionPath, commitSha, fetched);
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, content, 'utf-8');

    console.log(`[sync-templates] wrote ${OUTPUT_PATH}`);
    console.log(`[sync-templates] done (commit: ${commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 8)})`);
}

main().catch((e) => {
    console.error(`[sync-templates] failed: ${e?.message ?? e}`);
    process.exit(1);
});
