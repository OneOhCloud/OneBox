import { invoke } from '@tauri-apps/api/core';
import * as path from '@tauri-apps/api/path';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { arch, locale, type, version } from '@tauri-apps/plugin-os';
import { OsInfo, RULE_MODE_STORE_KEY, SING_BOX_VERSION, SSI_STORE_KEY } from '../types/definition';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { setGlobalMixedConfig, setGlobalTunConfig, setMixedConfig, setTunConfig } from '../config/helper';
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

type SyncConfigProps = {
    onError?: (error: any) => void;
    onSuccess?: () => void;
    onRequirePrivileged?: () => void;
}



export const vpnServiceManager = {
    syncConfig: async (props: SyncConfigProps) => {
        try {
            const identifier = await getStoreValue(SSI_STORE_KEY);
            const useTun = await getEnableTun();

            //zh: 直接使用 getStoreValue(RULE_MODE_STORE_KEY) 代替 setStoreValue 来获取当前模式，这样不会读到旧的值
            //en: Directly use getStoreValue(RULE_MODE_STORE_KEY) instead of setStoreValue to get the current mode, so that the old value will not be read
            const currentMode = await getStoreValue(RULE_MODE_STORE_KEY)

            //zh: 在 linux 和 macOS 上使用 TUN 模式时需要输入超级管理员密码
            //en: When using TUN mode on linux and macOS, you need to enter the super administrator password
            if (useTun && (type() == 'linux' || type() == 'macos')) {
                console.log('在 Linux 或 macOS 上使用 TUN 模式，需要输入超级管理员密码');
                const privileged = await verifyPrivileged();
                console.log('是否有超级管理员权限:', privileged);
                if (!privileged) {
                    console.log('没有超级管理员权限，弹出授权对话框');
                    props.onRequirePrivileged?.();
                    props.onError?.(new Error("没有超级管理员权限"));
                } else {
                    console.log('有超级管理员权限，继续配置');
                    console.log('privileged:', privileged);
                }
                const fn = currentMode === 'global' ? setGlobalTunConfig : setTunConfig;
                await fn(identifier, SING_BOX_VERSION);
            } else if (useTun && type() == 'windows') {
                console.log('在 Windows 上使用 TUN 模式，无需密码');
                const fn = currentMode === 'global' ? setGlobalTunConfig : setTunConfig;
                await fn(identifier, SING_BOX_VERSION);
            } else {
                console.log('使用普通模式');
                const fn = currentMode === 'global' ? setGlobalMixedConfig : setMixedConfig;
                await fn(identifier, SING_BOX_VERSION);
            }
            props.onSuccess?.();
        } catch (error: any) {
            console.error('Failed to sync VPN config:', error);
            props.onError?.(error);
        }
    },
    start: async () => {
        try {
            const configPath = await getSingBoxConfigPath();
            const tunMode: boolean | undefined = await getEnableTun();
            let mode: vpnServiceManagerMode = tunMode ? 'TunProxy' : 'SystemProxy';
            console.log("启动VPN服务");
            console.log("模式:", mode);
            console.log("配置文件路径:", configPath);

            await invoke("start", { app: appWindow, path: configPath, mode: mode });

        } catch (error: any) {
            console.error('Failed to start VPN service:', error);
            // 如果是权限问题，抛出特定错误让上层处理
            if (error?.toString().includes('REQUIRE_PRIVILEGE')) {
                throw new Error('REQUIRE_PRIVILEGE');
            }
            await message('Failed to start VPN service', { title: 'error', kind: 'error' });
            throw error;
        }

    },
    stop: async () => await invoke("stop", { app: appWindow }),


};


export const verifyPrivileged = async () => {
    return await invoke<boolean>("is_privileged");

};

// 同步版本的翻译函数
export const t = (id: string, defaultMessage?: string): string => {
    const translation = languageOptions[currentLanguage][id];
    if (translation) {
        return translation;
    } else {
        console.warn(`Translation for "${id}" not found in "${currentLanguage}"`);
        return defaultMessage || id;
    }
}

// 当用户更改语言时，需要更新当前语言
export async function updateLanguage() {
    currentLanguage = await getLanguage() as "zh" | "en";
}

