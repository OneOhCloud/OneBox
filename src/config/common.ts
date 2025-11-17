import { SING_BOX_MAJOR_VERSION } from "../types/definition";

export type StageVersionType = "stable" | "beta" | "dev";

export type configType = 'mixed' | 'tun' | 'mixed-global' | 'tun-global';


export async function getConfigTemplateCacheKey(mode: configType): Promise<string> {
    const cacheKey = `key-sing-box-${SING_BOX_MAJOR_VERSION}-${mode}-template-config-cache`;
    return cacheKey;
}