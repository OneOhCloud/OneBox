import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();
// 使用全局变量来标记是否已经初始化
let trayInitialized = false;
let trayInstance: TrayIcon | null = null; // 托盘实例

// 创建托盘的函数移到组件外部
async function createTrayMenu() {
  return await Menu.new({
    items: [
      {
        id: 'show',
        text: '显示主界面',
        action: async () => {
          await appWindow.show();
        },
      },
      {
        id: 'quit',
        text: '退出',
        action: async () => {
          await appWindow.destroy()
        },
      },
    ],
  });
}

// 初始化托盘的函数也移到组件外部
async function setupTrayIcon() {
  // 使用标志变量防止多次初始化
  if (trayInitialized) {
    return trayInstance;
  }
  
  try {
    const menu = await createTrayMenu();
    const options = {
      menu,
      menuOnLeftClick: true,
      icon: (await defaultWindowIcon()) || 'None',
      tooltip: "OneBox"
    };
    
    trayInstance = await TrayIcon.new(options);
    trayInitialized = true;
    return trayInstance;
  } catch (error) {
    console.error('Error setting up tray icon:', error);
    return null;
  }
}
setupTrayIcon();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
