import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { Menu, MenuOptions } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { type } from '@tauri-apps/plugin-os';
import { getClashApiSecret, getStoreValue } from './single/store';
import { DEVELOPER_TOGGLE_STORE_KEY } from './types/definition';
import { copyEnvToClipboard, initLanguage, t, vpnServiceManager } from './utils/helper';


const appWindow = getCurrentWindow();

let trayInstance: TrayIcon | null = null;

// 创建托盘菜单
async function createTrayMenu() {
    // 获取当前运行状态
    await initLanguage();
    let secret = await getClashApiSecret();
    const status = await invoke<boolean>("is_running", { secret: secret });

    document
        .getElementById('titlebar-minimize')
        ?.addEventListener('click', () => appWindow.minimize());
    document
        .getElementById('titlebar-maximize')
        ?.addEventListener('click', () => appWindow.toggleMaximize());
    document
        .getElementById('titlebar-close')
        ?.addEventListener('click', () => appWindow.hide());

    let baseMenu: MenuOptions = {
        items: [
            {
                id: 'show',
                text: t("menu_dashboard"),
            },
            {
                id: "enable",
                text: t("menu_enable_proxy"),
                checked: status,
                enabled: true,
                action: async () => {
                    if (status) {
                        await vpnServiceManager.stop();
                    } else {
                        await vpnServiceManager.syncConfig({});
                        await vpnServiceManager.start();
                    }
                    const newMenu = await createTrayMenu();
                    if (trayInstance) {
                        await trayInstance.setMenu(newMenu);
                    }
                },
            },

        ],
    }
    const developer_toggle_state: boolean = await getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false);
    if (developer_toggle_state) {
        baseMenu.items?.push(
            {
                id: 'open_log',
                text: t("menu_open_log"),
                action: async () => {
                    await invoke('create_window', {
                        app: appWindow,
                        title: "Log",
                        label: "sing-box-log",
                        windowTag: "sing-box-log",
                    })
                },
            },

            {
                id: 'devtools',
                text: t("menu_devtools"),
                action: async () => {
                    await invoke("open_devtools");
                },
            },


        );
    }

    baseMenu.items?.push(
        {
            id: 'copy_proxy',
            text: t("menu_copy_env"),
            action: async () => {
                await copyEnvToClipboard("127.0.0.1", "6789");
            },
        },
        {
            id: 'quit',
            text: t("menu_quit")
        },
    )

    return await Menu.new(baseMenu);
}

// 初始化托盘
export async function setupTrayIcon() {
    const osType = type()

    if (trayInstance) {
        return trayInstance;
    }

    try {
        const menu = await createTrayMenu();
        const tray_icon = await invoke<ArrayBuffer>('get_tray_icon', {
            app: appWindow
        });
        const defaultIcon = await defaultWindowIcon();

        if (osType == 'macos') {
            const options = {
                menu,
                icon: tray_icon || defaultIcon,
                tooltip: "OneBox"
            };
            trayInstance = await TrayIcon.new(options);
            trayInstance && trayInstance.setIconAsTemplate(true);

        } else {
            const options = {
                menu,
                icon: tray_icon || defaultIcon,
                tooltip: "OneBox"
            };
            trayInstance = await TrayIcon.new(options);
        }

        return trayInstance;
    } catch (error) {
        console.error('Error setting up tray icon:', error);
        console.error('OS Type:', osType);
        return null;
    }
}

export async function setupStatusListener() {
    await listen('status-changed', async (event) => {
        if (event == null) {
            return;
        }
        console.log("Received status-changed event:", event);
        // @ts-ignore
        if (event.payload && event.payload.code && event.payload.code === 1) {
            // await message(`${t('connect_failed')}`, { title: t('error'), kind: 'error' });
            //  连接失败，请稍等一分钟后重试。
            await message(
                t('connect_failed_retry'),
                { title: t('error'), kind: 'error' }
            )


        }
        const newMenu = await createTrayMenu();
        if (trayInstance) {
            await trayInstance.setMenu(newMenu);
        }
    });
}
