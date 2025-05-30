import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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

  let baseMenu = {
    items: [
      {
        id: 'show',
        // text: '仪表盘',
        text: t("menu_dashboard"),
      },
      {
        id: "enable",
        // text: "启用代理", // 根据状态设置文本
        text: t("menu_enable_proxy"), // 根据状态设置文本
        checked: status, // 根据状态设置选中状态
        enabled: true, // 可根据需要设置是否启用
        action: async () => {
          if (status) {
            vpnServiceManager.stop(); // 停止服务
          } else {
            vpnServiceManager.start(); // 启动服务  
          }
          // 更新托盘菜单以反映新状态
          const newMenu = await createTrayMenu();
          if (trayInstance) {
            await trayInstance.setMenu(newMenu);
          }
        },
      },
      {
        id: 'copy_proxy',
        // text: '复制环境变量',
        text: t("menu_copy_env"),
        action: async () => {
          await copyEnvToClipboard("127.0.0.1", "6789");
        },
      },

    ],
  }
  const developer_toggle_state: boolean = await getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false);

  if (developer_toggle_state) {
    console.log("开发者模式已启用，添加调试工具菜单项");
    baseMenu.items.push(
      {
        id: 'devtools',
        // text: '调试工具',
        text: t("menu_devtools"),
        action: async () => {
          await invoke("open_devtools");
        },
      },
    );

  }

  baseMenu.items.push(
    {
      id: 'quit',
      // text: '退出程序',
      text: t("menu_quit"),
      action: async () => {
        await invoke("stop");
        await appWindow.close();
        await appWindow.destroy();
      },
    },

  )

  return await Menu.new(baseMenu);
}

// 初始化托盘
async function setupTrayIcon() {
  if (trayInstance) {
    return trayInstance;
  }

  try {
    const menu = await createTrayMenu();
    const options = {
      menu,
      icon: (await defaultWindowIcon()) || 'None',
      tooltip: "OneBox"

    };
    trayInstance = await TrayIcon.new(options);
    return trayInstance;
  } catch (error) {
    console.error('Error setting up tray icon:', error);
    return null;
  }
}

async function setupStatusListener() {
  await listen('status-changed', async () => {
    const newMenu = await createTrayMenu();
    if (trayInstance) {
      await trayInstance.setMenu(newMenu);
    }
  });
}

setupTrayIcon();
setupStatusListener();


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);