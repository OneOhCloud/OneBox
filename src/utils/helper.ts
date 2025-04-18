import { invoke } from '@tauri-apps/api/core';
import * as path from '@tauri-apps/api/path';
import { arch, locale, type, version } from '@tauri-apps/plugin-os';
import { OsInfo, SING_BOX_VERSION } from '../types/definition';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { getEnableTun } from '../single/store';

const appWindow = getCurrentWindow();


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
        let mode: vpnServiceManagerMode = 'SystemProxy';
        if (tunMode) {
            mode = 'TunProxy';
        }
        await invoke("start", { app: appWindow, path: configPath, mode: mode })
    },
    stop: async () => await invoke("stop", { app: appWindow }),
};