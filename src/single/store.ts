import { locale, type } from '@tauri-apps/plugin-os';
import { LazyStore } from '@tauri-apps/plugin-store';
import { toast } from 'sonner';
import { ALLOWLAN_STORE_KEY, ENABLE_BYPASS_ROUTER_STORE_KEY, ENABLE_TUN_STORE_KEY, USE_DHCP_STORE_KEY } from '../types/definition';

const OsType = type();
export const LANGUAGE_STORE_KEY = 'language';
export const CLASH_API_SECRET = 'clash_api_secret_key';



export async function getStoreValue(key: string, val?: any): Promise<any> {
    let value = await store.get(key);

    // zh: 如果 val 存在且 value 为 undefined、null 或空字符串，则返回 val
    // en: If val exists and value is undefined, null, or an empty string, return val
    if (val && (value === undefined || value === null || value === '')) {
        return val;
    }
    return value;
}
export async function setStoreValue(key: string, value: any) {
    await store.set(key, value);
    await store.save();
}


export const store = new LazyStore('settings.json', {
    defaults: {},
    autoSave: true
});


export async function getEnableTun(): Promise<boolean> {
    let b = await store.get(ENABLE_TUN_STORE_KEY);
    return Boolean(b);
}



export async function setEnableTun(value: boolean) {
    await store.set(ENABLE_TUN_STORE_KEY, value);
    await store.save();
}
export async function getAllowLan(): Promise<boolean> {
    let b = await store.get(ALLOWLAN_STORE_KEY);
    return Boolean(b);
}

export async function setAllowLan(value: boolean) {
    await store.set(ALLOWLAN_STORE_KEY, value);
    await store.save();
}




/**
 * Retrieves or generates a Clash API secret from the store.
 * 
 * @returns A Promise that resolves to the Clash API secret string.
 * If a secret exists in the store, returns that secret.
 * If no secret exists, generates a new random secret, saves it to the store, and returns it.
 */
export async function getClashApiSecret(): Promise<string> {
    const secret = await store.get(CLASH_API_SECRET);
    if (secret) {
        return secret as string;
    } else {
        const randomSecret = Math.random().toString(36).substring(2, 18);
        await store.set(CLASH_API_SECRET, randomSecret);
        await store.save();
        return randomSecret;
    }
}


export const getLanguage = async () => {
    const language = await getStoreValue(LANGUAGE_STORE_KEY) as string | undefined;
    if (language) {
        return language;
    }
    const osLocale = await locale();
    if (osLocale) {
        if (osLocale.startsWith('zh')) {
            return 'zh';

        } else {
            return 'en';
        }
    }
    return 'en';
};

export const setLanguage = async (language: string) => {
    await setStoreValue(LANGUAGE_STORE_KEY, language);
};


export async function isBypassRouterEnabled(): Promise<boolean> {
    let b = await store.get(ENABLE_BYPASS_ROUTER_STORE_KEY);
    return Boolean(b);

}

export async function setBypassRouterEnabled(value: boolean) {
    if (OsType !== "macos") {
        toast.error("旁路由模式仅 macOS 支持");
        return;
    }
    await store.set(ENABLE_BYPASS_ROUTER_STORE_KEY, value);
    await store.save();
}


export async function getUseDHCP(): Promise<boolean> {
    let b = await store.get(USE_DHCP_STORE_KEY);
    if (b === undefined) {
        return false;
    }
    return Boolean(b);
}

export async function setUseDHCP(value: boolean) {
    await store.set(USE_DHCP_STORE_KEY, value);
    await store.save();
}