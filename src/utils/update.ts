import { check, type Update } from "@tauri-apps/plugin-updater";
import { getStoreValue, setStoreValue } from "../single/store";
import { LAST_SIGNATURE_FAILURE_TIME_KEY, LAST_UPDATE_CHECK_TIME_KEY, STAGE_VERSION_STORE_KEY } from "../types/definition";
import { getSingBoxUserAgent } from "./helper";

export const SIGNATURE_FAILURE_COOLDOWN_MS = 1000 * 60 * 60; // 1 hour

export const checkUpdate = async () => {

    let stage = await getStoreValue(STAGE_VERSION_STORE_KEY, "latest");

    if (stage === "stable") {
        stage = "latest"; // 稳定版直接使用最新版本
    }
    const ua = await getSingBoxUserAgent()

    return await check({
        timeout: 5000, // 设置超时时间为5秒
        headers: {
            'Accept': 'application/json',
            'stage': stage,
            'User-Agent': ua
        }
    });

}

// Returns the update check interval in ms based on the current stage:
//   dev  → 15 min, beta → 1 hr, stable → 7 days
export const getUpdateInterval = async (): Promise<number> => {
    const stage = await getStoreValue(STAGE_VERSION_STORE_KEY, "stable");
    switch (stage) {
        case "dev": return 1000 * 60 * 15;          // 15 minutes
        case "beta": return 1000 * 60 * 60;          // 1 hour
        default: return 1000 * 60 * 60 * 24 * 7;    // 7 days (stable)
    }
};

export const getLastUpdateCheckTime = async (): Promise<number> => {
    const t = await getStoreValue(LAST_UPDATE_CHECK_TIME_KEY, 0);
    return typeof t === 'number' ? t : 0;
};

export const setLastUpdateCheckTime = async (time: number): Promise<void> => {
    await setStoreValue(LAST_UPDATE_CHECK_TIME_KEY, time);
};

export const getLastSignatureFailureTime = async (): Promise<number> => {
    const t = await getStoreValue(LAST_SIGNATURE_FAILURE_TIME_KEY, 0);
    return typeof t === 'number' ? t : 0;
};

export const setLastSignatureFailureTime = async (time: number): Promise<void> => {
    await setStoreValue(LAST_SIGNATURE_FAILURE_TIME_KEY, time);
};

// Updater plugin surfaces verifier mismatches as a string containing
// "signature verification failed". Stale CDN edges occasionally serve a
// `latest.json` that points at a binary whose .sig hasn't propagated yet —
// retrying within the same hour will keep failing, so we throttle.
export const isSignatureVerificationError = (error: unknown): boolean => {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    return /signature verification failed/i.test(msg);
};

// Returns the timestamp at which the throttle expires, or 0 if not throttled.
// Only stable is throttled — beta/dev publish too frequently for an hour-long
// cooldown to be useful, and a CDN miss there usually clears within minutes.
export const getSignatureThrottleUntil = async (): Promise<number> => {
    const stage = await getStoreValue(STAGE_VERSION_STORE_KEY, "stable");
    if (stage !== "stable") return 0;
    const last = await getLastSignatureFailureTime();
    if (last === 0) return 0;
    const until = last + SIGNATURE_FAILURE_COOLDOWN_MS;
    return until > Date.now() ? until : 0;
};

// Downloads the update and records the version in store.
// Calls onProgress with 0-100 during download.
// NOTE: Tauri's Update object has no cross-session state — .download() must be
// called every session before .install(). The store key is kept only so the UI
// can show "previously seen version" info; it does NOT skip the download.
export const downloadUpdateIfNeeded = async (
    update: Update,
    onProgress: (percent: number) => void,
): Promise<void> => {
    let downloaded = 0;
    let contentLength = 0;

    await update.download((event) => {
        switch (event.event) {
            case 'Started':
                contentLength = event.data.contentLength || 0;
                break;
            case 'Progress':
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                    onProgress(Math.round((downloaded / contentLength) * 100));
                }
                break;
        }
    });


};
