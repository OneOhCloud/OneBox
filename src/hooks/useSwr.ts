import { fetch } from '@tauri-apps/plugin-http';
import { parse } from "jsonc-parser";
import { configType, getConfigTemplateCacheKey } from "../config/common";
import { getConfigTemplateURL, setStoreValue } from "../single/store";

async function setConfigTemplateCache(mode: configType, config: string) {
    const cacheKey = await getConfigTemplateCacheKey(mode);
    await setStoreValue(cacheKey, config);

}


async function fetchSyncRemoteConfig(mode: configType) {
    let url = await getConfigTemplateURL(mode);
    console.debug("Fetched config template URL:", url);
    if (url.startsWith("https://")) {
        // 读取 url 的 jsonc 文件并转为 json 字符串
        let controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        const response = await fetch(`${url}?_=${Date.now()}`, {
            signal: controller.signal,
            cache: "no-store"
        });
        if (!response.ok) {
            console.error(`Failed to fetch config template from ${url}:`, response.statusText);
            clearTimeout(timeoutId);
            return;
        }
        const text = await response.text();
        clearTimeout(timeoutId);
        const jsonRes = parse(text);
        const jsonString = JSON.stringify(jsonRes);
        setConfigTemplateCache(mode, jsonString);
        console.debug(`Successfully synced config template for mode ${mode} from ${url}`);
    } else {
        console.warn(`Config template URL for mode ${mode} is not a valid HTTPS URL: ${url}`);
    }

}
export async function syncAllConfigTemplates() {

    await Promise.all([
        fetchSyncRemoteConfig('mixed'),
        fetchSyncRemoteConfig('tun'),
        fetchSyncRemoteConfig('mixed-global'),
        fetchSyncRemoteConfig('tun-global'),
    ]);
    return "ok"
}
