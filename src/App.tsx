import "./App.css";

import { motion } from 'framer-motion';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import { Toaster } from 'react-hot-toast';

import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type } from '@tauri-apps/plugin-os';
import React from 'react';
import HomePage from './page/home';
import { ActiveScreenType, NavContext } from './single/context';
import { getClashApiSecret, getStoreValue } from './single/store';
import { DEVELOPER_TOGGLE_STORE_KEY } from './types/definition';
import { copyEnvToClipboard, initLanguage, t, vpnServiceManager } from './utils/helper';



const ConfigurationPage = React.lazy(() => import('./page/config'));
const DevPage = React.lazy(() => import('./page/developer'));
const SettingsPage = React.lazy(() => import('./page/settings'));
const UpdaterButton = React.lazy(() => import('./components/settings/updater-button'));

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

  let baseMenu = {
    items: [
      {
        id: 'show',
        text: t("menu_dashboard"),
      },
      {
        id: "enable",
        text: t("menu_enable_proxy"), // 根据状态设置文本
        checked: status, // 根据状态设置选中状态
        enabled: true, // 可根据需要设置是否启用
        action: async () => {
          if (status) {
            vpnServiceManager.stop(); // 停止服务
          } else {
            vpnServiceManager.start(); // 启动服务  
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
    console.log("开发者模式已启用，添加调试工具菜单项");
    baseMenu.items.push(
      {
        id: 'devtools',
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
      text: t("menu_quit")
    },

  )

  return await Menu.new(baseMenu);
}

// 初始化托盘
async function setupTrayIcon() {
  const osType = type()

  if (trayInstance) {
    return trayInstance;
  }

  try {
    const menu = await createTrayMenu();
    const tray_icon = await invoke<ArrayBuffer>('get_tray_icon', {
      app: appWindow
    });

    if (osType == 'macos') {
      const options = {
        menu,
        icon: tray_icon,
        tooltip: "OneBox"
      };
      trayInstance = await TrayIcon.new(options);
      trayInstance && trayInstance.setIconAsTemplate(true);
    } else {
      const options = {
        menu,
        icon: tray_icon || 'None',
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

async function setupStatusListener() {
  await listen('status-changed', async () => {
    const newMenu = await createTrayMenu();
    if (trayInstance) {
      await trayInstance.setMenu(newMenu);
    }
  });
}

// 
if (appWindow.label === "main") {
  setupTrayIcon();
  setupStatusListener();
}


type BodyProps = {
  lang: string;
  activeScreen: ActiveScreenType;
}

// 加载中的组件
const LoadingFallback = () => (
  <div className="flex flex-col items-center justify-center h-full space-y-4">
    <span className="loading loading-infinity loading-xl"></span>

  </div>
);

function Body({ lang, activeScreen }: BodyProps) {
  // Home 组件保活，只渲染一次
  const homeComponent = useMemo(() => <HomePage />, []); // 空依赖数组，只渲染一次

  // 其他组件的懒加载渲染
  const lazyComponent = useMemo(() => {
    switch (activeScreen) {
      case 'configuration':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <ConfigurationPage />
          </Suspense>
        );

      case 'settings':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <SettingsPage />
          </Suspense>
        );

      case 'developer_options':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DevPage />
          </Suspense>
        );

      default:
        return null;
    }
  }, [activeScreen]);

  return (
    <div className="flex-1 overflow-y-hidden">
      {/* Home 组件始终保持挂载，通过显示/隐藏控制 */}
      <div
        className={`h-full overflow-y-auto ${activeScreen === 'home' ? 'block' : 'hidden'}`}
      >
        {homeComponent}
      </div>

      {/* 其他组件的渲染 */}
      {activeScreen !== 'home' && (
        <div className="animate-fade-in h-full overflow-y-auto" key={`${activeScreen}-${lang}`}>
          {lazyComponent}
        </div>
      )}
    </div>
  );
}


function App() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreenType>('home');
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);
  const [dockLang, setDockLang] = useState({
    home: t("home"),
    configuration: t("configuration"),
    settings: t("settings"),
  })

  const [language, setLanguage] = useState('unknown');


  useEffect(() => {
    const handleLanguageChange = () => {
      setDockLang({
        home: t("home"),
        configuration: t("configuration"),
        settings: t("settings"),
      })
    };
    handleLanguageChange();
  }, [activeScreen, language]);

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
  }

  useEffect(() => {
    initLanguage().then(() => {
      setDockLang({
        home: t("home"),
        configuration: t("configuration"),
        settings: t("settings"),
      })
    })
  }, []);



  return (
    <NavContext.Provider value={{ activeScreen, setActiveScreen, handleLanguageChange }}>
      <Toaster position="top-center" toastOptions={{ duration: 2000 }} containerClassName="mt-[32px]" />

      <main className="relative bg-gray-50 flex flex-col h-screen">
        {activeScreen === 'home' &&
          <div className='absolute inset-0  z-2   max-h-max flex justify-end p-1'>
            <Suspense >
              <UpdaterButton />
            </Suspense>
          </div>
        }
        <Body activeScreen={activeScreen} lang={language} />

        <div className="dock  dock-sm  bg-gray-50 border-0">
          <button
            onClick={() => setActiveScreen('home')}
            className={` ${activeScreen === 'home' ? 'text-blue-500' : ''}`}
          >
            <House />
            <span className='text-xs capitalize'>{dockLang.home}</span>
          </button>

          <button
            onClick={() => setActiveScreen('configuration')}
            className={`${activeScreen === 'configuration' ? 'text-blue-500' : ''}`}
          >
            <Layers />
            <span className='text-xs capitalize'>{dockLang.configuration}</span>
          </button>

          <button
            onClick={() => setActiveScreen('settings')}
            className={`${activeScreen === 'settings' ? 'text-blue-500' : ''}`}
            onMouseEnter={() => setIsSettingsHovered(true)}
            onMouseLeave={() => setIsSettingsHovered(false)}
          >
            <motion.div
              animate={{ rotate: isSettingsHovered ? 180 : 0 }}
              transition={{ duration: 0.3 }}
            >
              <GearWideConnected />
            </motion.div>
            <span className='text-xs capitalize'>{dockLang.settings}</span>
          </button>
        </div>

      </main>
    </NavContext.Provider>
  );
}

export default App;