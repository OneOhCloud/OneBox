import { fetch } from '@tauri-apps/plugin-http';
import { parse } from "jsonc-parser";
import { ALL_CONFIG_MODES, configType, getConfigTemplateCacheKey, isStaleTemplatePathOverride, TEMPLATE_CACHE_SCHEMA_VERSION } from "../config/common";
import { getBuiltInTemplate } from "../config/templates";
import { getConfigTemplateURL, setStoreValue, store } from "../single/store";

// Scorched-earth purge of every template-related store key that is NOT the
// current-schema content cache. Enumerates the store rather than relying on a
// hardcoded key list, so orphans from any historical naming scheme (old major
// version, `-rules-` infix, suffix-less v1, stale `-template-path` overrides
// pointing at legacy URLs) are all deleted in one pass.
export async function purgeLegacyTemplateCache(): Promise<void> {
    const currentCacheKeys = new Set(
        await Promise.all(ALL_CONFIG_MODES.map((m) => getConfigTemplateCacheKey(m))),
    );
    const schemaSuffix = `-v${TEMPLATE_CACHE_SCHEMA_VERSION}`;

    let allKeys: string[];
    try {
        allKeys = await store.keys();
    } catch (e) {
        console.warn('[migrate] store.keys() failed:', e);
        return;
    }

    const deletions: Promise<unknown>[] = [];
    for (const key of allKeys) {
        // 1. Any template-config-cache entry that isn't the current-schema key.
        //    Catches pre-v2 (`...-template-config-cache`), old-major (1.12),
        //    and orphan naming (`...-rules-template-config-cache`).
        if (key.includes('-template-config-cache') && !currentCacheKeys.has(key)) {
            deletions.push(
                store.delete(key)
                    .then(() => console.info(`[migrate] purged legacy template cache: ${key}`))
                    .catch((e) => console.warn(`[migrate] failed to purge ${key}:`, e)),
            );
            continue;
        }

        // 2. Template-path override whose value still points at the pre-1.13.8
        //    `conf/1.13/zh-cn/` URL (ships legacy `sniff` inbound fields the
        //    1.13.8 kernel rejects). Drop the override so getDefaultConfigTemplateURL
        //    resolves to the migrated path on next read. Also drop the matching
        //    content cache — even if it has the current schema suffix, its
        //    content was fetched from the stale URL.
        if (key.endsWith('-template-path') && !key.endsWith(schemaSuffix)) {
            deletions.push((async () => {
                try {
                    const stored = await store.get(key);
                    if (isStaleTemplatePathOverride(stored)) {
                        await store.delete(key);
                        console.info(`[migrate] dropped stale template-path override: ${key}`);
                        // derive sibling content cache key and blow it away
                        const mode = inferModeFromPathKey(key);
                        if (mode) {
                            const contentKey = await getConfigTemplateCacheKey(mode);
                            await store.delete(contentKey);
                            console.info(`[migrate] dropped content cache poisoned by stale override: ${contentKey}`);
                        }
                    }
                } catch (e) {
                    console.warn(`[migrate] failed to check template-path ${key}:`, e);
                }
            })());
        }
    }

    await Promise.all(deletions);

    try {
        await store.save();
    } catch (e) {
        console.warn('[migrate] failed to save store after purge:', e);
    }
}

// Extracts the mode segment from a `key-sing-box-{major}-{mode}-template-path`
// key. Returns null if the mode is not one of the known configType values
// (e.g. orphan shapes from earlier versions with different mode naming).
function inferModeFromPathKey(key: string): configType | null {
    const m = key.match(/-(mixed|tun|mixed-global|tun-global)-template-path$/);
    if (!m) return null;
    return m[1] as configType;
}

// Cache is the single intermediary between template sources and the config
// merger. Every prime attempt:
//   1. tries remote fetch — on success, writes JSON string to cache
//   2. on failure (network/parse/non-HTTPS URL), writes the build-time
//      template snapshot (see src/config/templates) to cache
// After prime, the cache is guaranteed populated and the merge step reads
// *only* from cache (see config/merger/main.ts::getConfigTemplate).
async function fetchRemoteTemplate(mode: configType): Promise<string | null> {
    const url = await getConfigTemplateURL(mode);
    if (!url.startsWith("https://")) {
        console.warn(`[prime] template URL for mode=${mode} is not HTTPS: ${url}`);
        return null;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await fetch(`${url}?_=${Date.now()}`, {
            signal: controller.signal,
            cache: "no-store",
        });
        if (!response.ok) {
            console.warn(`[prime] remote fetch failed for ${mode}: ${response.status} ${response.statusText}`);
            return null;
        }
        const text = await response.text();
        const jsonRes = parse(text);
        if (!jsonRes || typeof jsonRes !== 'object') {
            console.warn(`[prime] remote template parse failed for ${mode}`);
            return null;
        }
        return JSON.stringify(jsonRes);
    } catch (e) {
        console.warn(`[prime] remote fetch threw for ${mode}:`, e);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function primeConfigTemplateCache(mode: configType): Promise<void> {
    const cacheKey = await getConfigTemplateCacheKey(mode);
    let content = await fetchRemoteTemplate(mode);
    if (content === null) {
        content = getBuiltInTemplate(mode);
        console.info(`[prime] using build-time snapshot for mode=${mode}`);
    } else {
        console.debug(`[prime] cached remote template for mode=${mode}`);
    }
    await setStoreValue(cacheKey, content);
}

export async function primeAllConfigTemplateCaches(): Promise<"ok"> {
    await Promise.all(ALL_CONFIG_MODES.map(primeConfigTemplateCache));
    return "ok";
}
