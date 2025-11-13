import { parse } from "jsonc-parser";
import { configType, getConfigTemplateCacheKey } from "../config/common";
import { getConfigTemplateURL, setStoreValue } from "../single/store";

async function setConfigTemplateCache(mode: configType, config: string) {
    const cacheKey = await getConfigTemplateCacheKey(mode);
    await setStoreValue(cacheKey, config);

}


async function syncRemoteConfig(mode: configType) {
    let url = await getConfigTemplateURL(mode);
    console.log("Fetched config template URL:", url);
    if (url.startsWith("https://")) {
        // 读取 url 的 jsonc 文件并转为 json 字符串
        let controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        const response = await fetch(url, { signal: controller.signal });
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
        console.log(`Successfully synced config template for mode ${mode} from ${url}`);
    } else {
        console.warn("Only HTTPS URLs are supported for remote config templates. Skipping sync for URL:", url);
    }

}
export async function syncAllConfigTemplates() {

    await Promise.all([
        syncRemoteConfig('mixed'),
        syncRemoteConfig('tun'),
        syncRemoteConfig('mixed-global'),
        syncRemoteConfig('tun-global'),
    ]);
    return "ok"
}
