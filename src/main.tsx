import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { store } from './single/store';
import { invoke } from "@tauri-apps/api/core";

const appWindow = getCurrentWindow();
let trayInstance: TrayIcon | null = null;




// 创建托盘的函数移到组件外部
async function createTrayMenu() {
  return await Menu.new({
    items: [
      {
        id: 'show',
        text: '显示主界面',
        action: async () => {
          await appWindow.show();
          await appWindow.setFocus();
        },
      },
      {
        id: 'quit',
        text: '退出',
        action: async () => {

          // sleep(1000);
          await new Promise((resolve) => {
            invoke("stop").then(() => {
              resolve(true);
            }
            );
          });
          await appWindow.destroy();
        },
      },
    ],
  });
}

// 初始化托盘的函数也移到组件外部
async function setupTrayIcon() {

  let trayID: string = await store.get('trayID') || '';
  if (trayID) {
    try{
     let t = await TrayIcon.getById(trayID)
      if(t){
       await t.close();
      }
    }catch (error) {
      console.error('Error removing tray icon:', error);
    }
  }

  // 使用标志变量防止多次初始化
  if (trayInstance) {
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
    console.log("托盘图标创建成功",trayInstance.id);
    
    await store.set('trayID', trayInstance.id);
    await store.save();

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
