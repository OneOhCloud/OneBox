import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { Menu, MenuOptions } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { type } from '@tauri-apps/plugin-os';
import { getClashApiSecret, getStoreValue } from './single/store';
import { DEVELOPER_TOGGLE_STORE_KEY, StatusChangedPayload, TerminatedPayload } from './types/definition';
import { copyEnvToClipboard, initLanguage, t, vpnServiceManager } from './utils/helper';


const appWindow = getCurrentWindow();

let trayInstance: TrayIcon | null = null;
let lastStatus: boolean | null = null;
let statusPollerId: number | null = null;
let statusPollInFlight = false;

// 创建托盘菜单
async function createTrayMenu() {
    // 获取当前运行状态
    await initLanguage();
    let secret = await getClashApiSecret();
    const status = await invoke<boolean>("is_running", { secret: secret });
    lastStatus = status;

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
                    // 实时读取当前状态，避免使用闭包中已过期的 status
                    const secretNow = await getClashApiSecret();
                    const current = await invoke<boolean>("is_running", { secret: secretNow });
                    console.log("Toggling VPN status from tray menu. Current status:", current);
                    if (current) {
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
            {
                id: 'copy_proxy',
                text: t("menu_copy_env"),
                action: async () => {
                    await copyEnvToClipboard("127.0.0.1", "6789");
                },
            },

        ],
    }
    const developer_toggle_state: boolean = await getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false);
    if (developer_toggle_state) {
        // 获取应用路径
        const appPaths = await invoke<{
            log_dir: string,
            data_dir: string,
            cache_dir: string,
            config_dir: string,
            local_data_dir: string
        }>('get_app_paths');

        baseMenu.items?.push(
            {
                id: 'developer_menu',
                text: t("menu_developer") || "Developer",
                items: [
                    {
                        id: 'open_advanced_settings',
                        text: t("open_advanced_settings"),
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
                    {
                        id: 'open_log_dir',
                        text: t("menu_log_dir") || "Log Directory",
                        action: async () => {
                            try {
                                await invoke('open_directory', { path: appPaths.log_dir });
                            } catch (e) {
                                console.error('Failed to open log directory:', e);
                            }
                        },
                    },

                    {
                        id: 'open_config_dir',
                        text: t("menu_config_dir") || "Config Directory",
                        action: async () => {
                            try {
                                await invoke('open_directory', { path: appPaths.config_dir });
                            } catch (e) {
                                console.error('Failed to open config directory:', e);
                            }
                        },
                    }
                ],
            },


        );
    }

    baseMenu.items?.push(

        {
            id: 'quit',
            text: t("menu_quit")
        },
    )

    return await Menu.new(baseMenu);
}

// 每秒轮询状态
function startTrayStatusPolling() {
    if (statusPollerId !== null) {
        return;
    }

    statusPollerId = window.setInterval(async () => {
        if (statusPollInFlight) {
            return;
        }
        statusPollInFlight = true;
        try {
            const newMenu = await createTrayMenu();
            if (trayInstance) {
                await trayInstance.setMenu(newMenu);
            }
        } catch (error) {
            console.error('Failed to poll running status:', error);
        } finally {
            statusPollInFlight = false;
        }
    }, 1000);
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

        startTrayStatusPolling();
        return trayInstance;
    } catch (error) {
        console.error('Error setting up tray icon:', error);
        console.error('OS Type:', osType);
        return null;
    }
}

export async function updateTrayMenu() {
    const newMenu = await createTrayMenu();
    if (trayInstance) {
        await trayInstance.setMenu(newMenu);
    }
}


export async function setupStatusListener() {
    await listen<StatusChangedPayload>('status-changed', async (event) => {
        try {
            console.log('Status changed:', event);

            // 类型守卫：检查是否是 TerminatedPayload
            const isTerminated = (payload: unknown): payload is TerminatedPayload => {
                return payload != null
                    && typeof payload === 'object'
                    && 'code' in payload;
            };

            if (isTerminated(event.payload)) {
                const { code, signal } = event.payload;

                // 记录详细信息
                console.log(`Process terminated - Code: ${code}, Signal: ${signal}`);

                // 只在错误退出时显示消息
                if (code != null && code !== 0) {
                    try {
                        const [info, error] = await Promise.all([
                            invoke<string>('read_logs', { isError: false }),
                            invoke<string>('read_logs', { isError: true })
                        ]);

                        console.info("Info logs:", info);
                        console.error("Error logs:", error);

                        let msg = t('connect_failed_retry');

                        if (info && info.trim().length > 0) {
                            msg += `\n\n${info}`;
                        }

                        if (error && error.trim().length > 0) {
                            msg += `\n\n${error}`;
                        }



                        await message(
                            msg,
                            { title: t('error'), kind: 'error' }
                        );
                    } catch (err) {
                        console.error('Failed to read logs:', err);
                    }
                }
            }

            // 更新托盘菜单
            const newMenu = await createTrayMenu();
            if (trayInstance) {
                await trayInstance.setMenu(newMenu);
            }
        } catch (err) {
            console.error('Error in status listener:', err);
        }
    });
}

// 监听错误日志事件
export async function setupTauriLogListener() {
    await listen('tauri-log', async (event) => {
        if (event == null) {
            return;
        }
        // @ts-ignore
        if (event.payload && event.payload.code && event.payload.code === 1) {
            // @ts-ignore
            console.error(event);

        } else {
            // 普通日志处理（如果需要）
            // @ts-ignore
            console.log(event);
        }

    });
}
