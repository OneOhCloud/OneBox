import { invoke } from '@tauri-apps/api/core';
import * as path from '@tauri-apps/api/path';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { arch, locale, type, version } from '@tauri-apps/plugin-os';
import { OsInfo, SING_BOX_VERSION } from '../types/definition';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import en from '../lang/en.json';
import zh from '../lang/zh.json';
import { getEnableTun, getLanguage } from '../single/store';
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

export async function copyEnvToClipboard(proxy_host: string, proxy_port: string) {
    const osType = type()
    let proxyConfig = "";

    if (osType === 'windows') {
        proxyConfig = `$env:HTTP_PROXY="http://${proxy_host}:${proxy_port}"; $env:HTTPS_PROXY="http://${proxy_host}:${proxy_port}"`;
    } else {
        proxyConfig = `export https_proxy=http://${proxy_host}:${proxy_port} \n export http_proxy=http://${proxy_host}:${proxy_port} \n export all_proxy=socks5://${proxy_host}:${proxy_port}`;
    }

    try {
        await writeText(proxyConfig);
        console.log('Proxy configuration copied to clipboard');
    } catch (error) {
        console.error('Failed to copy proxy configuration:', error);
    }

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
        }
        await invoke("start", { app: appWindow, path: configPath, mode: mode });
    },
    stop: async () => await invoke("stop", { app: appWindow }),


};


export const verifyPrivileged = async () => {
    return await invoke<boolean>("is_privileged");

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

