import { LazyStore } from '@tauri-apps/plugin-store';
import { ALLOWLAN_STORE_KEY, ENABLE_TUN_STORE_KEY } from '../types/definition';


export const store = new LazyStore('settings.json', {
    autoSave: true
});


export async function getEnableTun(): Promise<boolean> {
    let b =  await store.get(ENABLE_TUN_STORE_KEY);
    return Boolean(b);
}

export async function setEnableTun(value: boolean) {
    await store.set(ENABLE_TUN_STORE_KEY, value);
    await store.save();
}
export async function getAllowLan(): Promise<boolean> {
    let b =  await store.get(ALLOWLAN_STORE_KEY);
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