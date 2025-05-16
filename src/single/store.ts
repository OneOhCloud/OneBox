import { locale } from '@tauri-apps/plugin-os';
import { LazyStore } from '@tauri-apps/plugin-store';
import { ALLOWLAN_STORE_KEY, ENABLE_TUN_STORE_KEY } from '../types/definition';

export const LANGUAGE_STORE_KEY = 'language';

export const store = new LazyStore('settings.json', {
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

export async function getStoreValue(key: string): Promise<any> {
    return await store.get(key);
}
export async function setStoreValue(key: string, value: any) {
    await store.set(key, value);
    await store.save();
}


// 获取当前语言设置
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
    return 'en'; // 默认为英文
};

// 设置语言
export const setLanguage = async (language: string) => {
    await setStoreValue(LANGUAGE_STORE_KEY, language);
};