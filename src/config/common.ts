import { SING_BOX_TEMPLATE_VERSION } from "../types/definition";

export type StageVersionType = "stable" | "beta" | "dev";

const STAGE_VERSIONS: readonly StageVersionType[] = ['stable', 'beta', 'dev'];

export function isStageVersion(value: unknown): value is StageVersionType {
    return typeof value === 'string' && STAGE_VERSIONS.includes(value as StageVersionType);
}

export type configType = 'mixed' | 'tun' | 'mixed-global' | 'tun-global';

// Bump when a sing-box upgrade makes prior cached templates unusable (e.g. 1.13.8
// rejecting legacy `sniff` inbound fields). New clients read a versioned key;
// purgeLegacyTemplateCache physically deletes the old entries.
export const TEMPLATE_CACHE_SCHEMA_VERSION = 2;

export const ALL_CONFIG_MODES: configType[] = ['mixed', 'tun', 'mixed-global', 'tun-global'];

export async function getConfigTemplateCacheKey(mode: configType): Promise<string> {
    const cacheKey = `key-sing-box-${SING_BOX_TEMPLATE_VERSION}-${mode}-template-config-cache-v${TEMPLATE_CACHE_SCHEMA_VERSION}`;
    return cacheKey;
}

// Stale template-path URL overrides from pre-1.13.8 clients point at
// `conf/1.13/zh-cn/...` which still ships legacy `sniff` inbound fields.
// Drop the override so the current version resolver selects a compatible
// bucket instead.
export function isStaleTemplatePathOverride(url: unknown): boolean {
    return typeof url === 'string' && /\/conf\/1\.13\/zh-cn\//.test(url);
}
