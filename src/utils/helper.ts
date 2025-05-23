import { invoke } from '@tauri-apps/api/core';
import * as path from '@tauri-apps/api/path';
import { arch, locale, type, version } from '@tauri-apps/plugin-os';
import { OsInfo, PRIVILEGED_PASSWORD_STORE_KEY, SING_BOX_VERSION } from '../types/definition';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import en from '../lang/en.json';
import zh from '../lang/zh.json';
import { getEnableTun, getLanguage, getStoreValue } from '../single/store';
const appWindow = getCurrentWindow();
const enLang = en as Record<string, string>;
const zhLang = zh as Record<string, string>;
let currentLanguage: "zh" | "en" = "en";

const languageOptions = {
    en: enLang,
    zh: zhLang,

}
export async function initLanguage() {
    try {
        // 优先使用用户设置的语言
        const userLanguage = await getLanguage() as "zh" | "en";
        if (userLanguage) {
            currentLanguage = userLanguage;
        }


    } catch (error) {
        console.error('Failed to initialize language:', error);
        // 出错时使用默认语言
        currentLanguage = 'en';
    }
}


export async function getOsInfo() {
    const osType = type()
    const osArch = arch()
    const osVersion = version()
    const osLocale = await locale()
    const appVersion = await invoke('get_app_version') as string;

    return {
        appVersion,
        osType,
        osArch,
        osVersion,
        osLocale,
    } as OsInfo
}

export function formatOsInfo(osType: string, osArch: string) {
    let osName = osType;
    if (osType === 'windows') {
        osName = 'Windows';
    } else if (osType === 'linux') {
        osName = 'Linux';
    } else if (osType === 'macos') {
        osName = 'macOS';
    }
    return `${osName} ${osArch}`;
}

export async function getSingBoxUserAgent() {
    const osInfo = await getOsInfo()

    let prefix = 'SFW';
    if (osInfo.osType === 'linux') {
        prefix = 'SFL';
    } else if (osInfo.osType === 'macos') {
        prefix = 'SFM';
    }
    const version = SING_BOX_VERSION.replace('v', '');
    return `${prefix}/${osInfo.appVersion} (${osInfo.osType} ${osInfo.osArch} ${osInfo.osVersion}; sing-box ${version}; language ${osInfo.osLocale})`;
}


export async function getSingBoxConfigPath() {
    const appConfigPath = await path.appConfigDir();
    const filePath = await path.join(appConfigPath, 'config.json');
    return filePath;
}


type vpnServiceManagerMode = 'SystemProxy' | 'TunProxy'

export const vpnServiceManager = {
    start: async () => {
        const configPath = await getSingBoxConfigPath();
        const tunMode: boolean | undefined = await getEnableTun();
        let mode: vpnServiceManagerMode = tunMode ? 'TunProxy' : 'SystemProxy';
        let osType = type();
        let password = "";
        console.log("启动VPN服务");
        console.log("模式:", mode);
        console.log("配置文件路径:", configPath);


        // 在 linux 和 macOS 上使用 TUN 模式时需要输入超级管理员密码
        if (tunMode && (osType == 'linux' || osType == 'macos')) {
            let ok = await verifyPrivileged();
            if (!ok) {
                // 一般来说不会弹出这个提示，如果弹出此提示，说明之前的交互逻辑有问题。
                await message('致命错误：授权失败', { title: '提示', kind: 'error' });
            }
            password = await getStoreValue(PRIVILEGED_PASSWORD_STORE_KEY);
        }
        await invoke("start", { app: appWindow, path: configPath, mode: mode, password: password });
    },
    stop: async () => await invoke("stop", { app: appWindow }),


};


export const verifyPrivileged = async () => {
    const username = await invoke<string>("get_current_username");
    if (!username) {
        return false;
    }
    const password = await getStoreValue(PRIVILEGED_PASSWORD_STORE_KEY);
    if (!password) {
        return false;
    }

    const ok = await invoke<boolean>("is_privileged", {
        username,
        password,
    });

    return ok;

};

// 同步版本的翻译函数
export const t = (id: string): string => {
    const translation = languageOptions[currentLanguage][id];
    if (translation) {
        return translation;
    } else {
        console.warn(`Translation for "${id}" not found in "${currentLanguage}"`);
        return id;
    }
}

// 当用户更改语言时，需要更新当前语言
export async function updateLanguage() {
    currentLanguage = await getLanguage() as "zh" | "en";
}

