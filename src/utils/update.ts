import { check } from "@tauri-apps/plugin-updater";
import { getStoreValue } from "../single/store";
import { STAGE_VERSION_STORE_KEY } from "../types/definition";

export const checkUpdate = async () => {

    let stage = await getStoreValue(STAGE_VERSION_STORE_KEY, "latest");

    if (stage === "stable") {
        stage = "latest"; // 稳定版直接使用最新版本
    }

    return await check({
        timeout: 5000, // 设置超时时间为5秒
        headers: {
            'Accept': 'application/json',
            'stage': stage,
        }
    });

}

