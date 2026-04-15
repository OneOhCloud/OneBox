import { SING_BOX_MAJOR_VERSION } from "../types/definition";

export type StageVersionType = "stable" | "beta" | "dev";

export type configType = 'mixed' | 'tun' | 'mixed-global' | 'tun-global';

// Bump when a sing-box upgrade makes prior cached templates unusable (e.g. 1.13.8
// rejecting legacy `sniff` inbound fields). New clients read a versioned key;
// purgeLegacyTemplateCache physically deletes the old entries.
export const TEMPLATE_CACHE_SCHEMA_VERSION = 2;

export const ALL_CONFIG_MODES: configType[] = ['mixed', 'tun', 'mixed-global', 'tun-global'];

export async function getConfigTemplateCacheKey(mode: configType): Promise<string> {
    const cacheKey = `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-config-cache-v${TEMPLATE_CACHE_SCHEMA_VERSION}`;
    return cacheKey;
}

// Stale template-path URL overrides from pre-1.13.8 clients point at
// `conf/1.13/zh-cn/...` which still ships legacy `sniff` inbound fields.
// 1.13.8 kernel rejects those at startup, so we drop the override and let
// getDefaultConfigTemplateURL resolve to `conf/1.13.8/zh-cn/...`.
export function isStaleTemplatePathOverride(url: unknown): boolean {
    return typeof url === 'string' && /\/conf\/1\.13\/zh-cn\//.test(url);
}
