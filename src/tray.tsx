import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { Menu, MenuOptions } from '@tauri-apps/api/menu';
import { TrayIcon, TrayIconEvent } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { type } from '@tauri-apps/plugin-os';
import { getClashApiSecret, getStoreValue } from './single/store';
import { DEVELOPER_TOGGLE_STORE_KEY } from './types/definition';
import { copyEnvToClipboard, initLanguage, t, vpnServiceManager } from './utils/helper';

// 常量
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = "6789";
const STATUS_POLL_INTERVAL = 500;

const appWindow = getCurrentWindow();
let trayInstance: TrayIcon | null = null;
let lastStatus: boolean | null = null;
let statusPollerId: number | null = null;
let statusPollInFlight = false;

// 获取当前运行状态
async function getRunningStatus(): Promise<boolean> {
    const secret = await getClashApiSecret();
    return await invoke<boolean>("is_running", { secret });
}

// 设置窗口控制按钮事件
function setupWindowControls() {
    document
        .getElementById('titlebar-minimize')
        ?.addEventListener('click', () => appWindow.minimize());
    document
        .getElementById('titlebar-maximize')
        ?.addEventListener('click', () => appWindow.toggleMaximize());
    document
        .getElementById('titlebar-close')
        ?.addEventListener('click', () => appWindow.hide());
}

// 切换代理状态
async function toggleProxyStatus(status: boolean) {
    if (status) {
        await vpnServiceManager.stop();
    } else {
        await vpnServiceManager.syncConfig({});
        await vpnServiceManager.start();
    }
    await updateTrayMenu();
}

// 创建基础菜单项
function createBaseMenuItems(status: boolean): NonNullable<MenuOptions['items']> {
    return [
        {
            id: 'show',
            text: t("menu_dashboard"),
        },
        {
            id: "enable",
            text: t("menu_enable_proxy"),
            checked: status,
            enabled: true,
            action: () => toggleProxyStatus(status),
        },
        {
            id: 'copy_proxy',
            text: t("menu_copy_env"),
            action: () => copyEnvToClipboard(PROXY_HOST, PROXY_PORT),
        },
    ];
}

// 创建开发者菜单项
async function createDeveloperMenuItems(): Promise<NonNullable<MenuOptions['items']>[number] | null> {
    const isDeveloperMode = await getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false);
    if (!isDeveloperMode) return null;

    const appPaths = await invoke<{
        log_dir: string;
        data_dir: string;
        cache_dir: string;
        config_dir: string;
        local_data_dir: string;
    }>('get_app_paths');

    const openDirectory = (path: string) => async () => {
        try {
            await invoke('open_directory', { path });
        } catch (e) {
            console.error('Failed to open directory:', e);
        }
    };

    return {
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
                    });
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
                action: openDirectory(appPaths.log_dir),
            },
            {
                id: 'open_config_dir',
                text: t("menu_config_dir") || "Config Directory",
                action: openDirectory(appPaths.config_dir),
            },
        ],
    };
}

// 创建托盘菜单
async function createTrayMenu() {
    await initLanguage();

    const status = await getRunningStatus();
    lastStatus = status;

    setupWindowControls();

    const baseItems = createBaseMenuItems(status);
    const developerMenu = await createDeveloperMenuItems();

    const menuItems = [
        ...baseItems,
        ...(developerMenu ? [developerMenu] : []),
        {
            id: 'quit',
            text: t("menu_quit"),
        },
    ];

    return await Menu.new({ items: menuItems });
}

// 每秒轮询状态，如有变化则更新托盘菜单
function startStatusPolling() {
    if (statusPollerId !== null) return;

    statusPollerId = window.setInterval(async () => {
        if (statusPollInFlight) return;

        statusPollInFlight = true;
        try {
            const status = await getRunningStatus();
            if (lastStatus !== null && status !== lastStatus) {
                lastStatus = status;
                await updateTrayMenu();
            } else if (lastStatus === null) {
                lastStatus = status;
            }
        } catch (error) {
            console.error('Failed to poll running status:', error);
        } finally {
            statusPollInFlight = false;
        }
    }, STATUS_POLL_INTERVAL);
}

// 处理托盘图标事件
async function handleTrayIconAction(event: TrayIconEvent) {
    if (event.type === 'Leave') {
        await updateTrayMenu();
    }
}

// 创建托盘图标配置
async function createTrayIconOptions(menu: Menu) {
    const trayIconData = await invoke<ArrayBuffer>('get_tray_icon', { app: appWindow });
    const defaultIcon = await defaultWindowIcon();

    return {
        menu,
        icon: trayIconData || defaultIcon,
        tooltip: "OneBox",
        action: handleTrayIconAction,
    };
}

// 初始化托盘
export async function setupTrayIcon() {
    if (trayInstance) return trayInstance;

    try {
        const menu = await createTrayMenu();
        const options = await createTrayIconOptions(menu);

        trayInstance = await TrayIcon.new(options);

        // macOS 特殊处理
        if (type() === 'macos' && trayInstance) {
            trayInstance.setIconAsTemplate(true);
        }

        startStatusPolling();
        return trayInstance;
    } catch (error) {
        console.error('Error setting up tray icon:', error);
        return null;
    }
}

// 更新托盘菜单
export async function updateTrayMenu() {
    if (!trayInstance) return;

    const newMenu = await createTrayMenu();
    await trayInstance.setMenu(newMenu);
}

// 处理连接失败
async function handleConnectionError() {
    const [info, error] = await Promise.all([
        invoke<string>('read_logs', { isError: false }),
        invoke<string>('read_logs', { isError: true }),
    ]);

    console.info("Info logs:", info);
    console.error("Error logs:", error);

    await message(
        t('connect_failed_retry'),
        { title: t('error'), kind: 'error' }
    );
}

// 监听状态变化
export async function setupStatusListener() {
    await listen('status-changed', async (event) => {
        if (!event?.payload) return;

        console.log(event);

        // @ts-ignore
        if (event.payload.code === 1) {
            await handleConnectionError();
        }

        await updateTrayMenu();
    });
}

// 监听错误日志事件
export async function setupTauriLogListener() {
    await listen('tauri-log', async (event) => {
        if (!event?.payload) return;

        // @ts-ignore
        const isError = event.payload.code === 1;
        // @ts-ignore
        console[isError ? 'error' : 'log'](event);
    });
}