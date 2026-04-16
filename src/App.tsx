import "./App.css";

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { motion } from 'framer-motion';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import { Toaster } from 'sonner';

import React from 'react';
import useSWR from "swr";
import { UpdateProvider } from './components/settings/update-context';
import { deduplicateSubscriptionsByUrl } from "./action/db";
import { primeAllConfigTemplateCaches, purgeLegacyTemplateCache } from "./hooks/useSwr";
import { EngineStateContext, useEngineStateRoot } from "./hooks/useEngineState";
import HomePage from "./page/home";
import { ActiveScreenType, NavContext } from './single/context';
import { getStoreValue } from "./single/store";
import { DEVELOPER_TOGGLE_STORE_KEY } from "./types/definition";
import { initLanguage, t } from './utils/helper';

const ConfigurationPage = React.lazy(() => import('./page/config'));
const DevPage = React.lazy(() => import('./page/developer'));
const SettingsPage = React.lazy(() => import('./page/settings'));
const RouterSettingsPage = React.lazy(() => import('./page/router'));
const UpdaterButton = React.lazy(() => import('./components/settings/updater-button'));




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

  const lazyComponent = useMemo(() => {
    switch (activeScreen) {
      case 'home':
        return (
          <HomePage />
        );
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

      case 'router_settings':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <RouterSettingsPage />
          </Suspense>
        );

      default:
        return null;
    }
  }, [activeScreen]);

  return (
    <div className="flex-1 overflow-y-hidden">
      {activeScreen && (
        <div className="animate-fade-in h-full overflow-y-auto" key={`${activeScreen}-${lang}`}>
          {lazyComponent}
        </div>
      )}
    </div>
  );
}



function App() {
  const engineState = useEngineStateRoot();
  const [activeScreen, setActiveScreen] = useState<ActiveScreenType>('home');
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);
  const [dockLang, setDockLang] = useState({
    home: t("home"),
    configuration: t("configuration"),
    settings: t("settings"),
  })
  useSWR('swr-purgeLegacyTemplateCache-key', async () => {
    await purgeLegacyTemplateCache();
    return 'ok';
  }, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    dedupingInterval: Infinity,
  });

  // Periodic background refresh of the template cache. Non-blocking — merges
  // read directly from cache (stale allowed) and this hook just keeps the
  // cache fresh. Revalidates on focus and at most every 30 minutes.
  useSWR('swr-primeAllConfigTemplateCaches-key', primeAllConfigTemplateCaches, {
    revalidateOnFocus: true,
    dedupingInterval: 60000 * 30,
  })

  const [language, setLanguage] = useState('unknown');
  const [deepLinkUrl, setDeepLinkUrl] = useState<string>('');
  const [deepLinkApplyUrl, setDeepLinkApplyUrl] = useState<string>('');

  useEffect(() => {
    // 统一入口：从 Rust 拉取并消费 pending deep link（take() 保证幂等）
    const processPending = () => {
      invoke<{ data: string; apply: boolean } | null>('get_pending_deep_link').then((payload) => {
        if (!payload) return;
        try {
          const decoded = atob(payload.data);
          if (payload.apply) {
            setActiveScreen('home');
            setDeepLinkApplyUrl(decoded);
          } else {
            setDeepLinkUrl(decoded);
            setActiveScreen('configuration');
          }
        } catch (e) {
          console.error('Failed to decode pending deep link:', e);
        }
      });
    };

    // 冷启动：前端就绪后立即拉取一次
    processPending();

    // 热启动信号：on_open_url 存入 pending 后发出，WebView 就绪时收到
    const unlistenSignal = listen('deep_link_pending', () => processPending());

    // 兜底：窗口获焦时再拉一次（信号在 WebView 从隐藏恢复过程中可能丢失）
    const unlistenFocus = getCurrentWindow().listen('tauri://focus', () => processPending());

    return () => {
      unlistenSignal.then(fn => fn());
      unlistenFocus.then(fn => fn());
    };
  }, []);


  useEffect(() => {
    let isDeveloperMode = false;

    // 初始化时获取一次
    getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false).then((val) => {
      isDeveloperMode = val;
    });

    const handler = (e: MouseEvent) => {
      if (!isDeveloperMode) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handler);

    // 清理事件
    return () => {
      document.removeEventListener('contextmenu', handler);
    };
  }, []);

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
    deduplicateSubscriptionsByUrl();
    initLanguage().then(() => {
      setDockLang({
        home: t("home"),
        configuration: t("configuration"),
        settings: t("settings"),
      })
    })
  }, []);




  return (
    <NavContext.Provider value={{ activeScreen, setActiveScreen, handleLanguageChange, deepLinkUrl, setDeepLinkUrl, deepLinkApplyUrl, setDeepLinkApplyUrl }}>
      <EngineStateContext.Provider value={engineState}>
      <UpdateProvider>
        <Toaster position="top-center" toastOptions={{ duration: 2000 }} />

        <main className="relative bg-gray-50 flex flex-col h-screen">
          {activeScreen === 'home' &&
            <div className='absolute inset-0  z-2   max-h-max flex justify-end p-1'>
              <Suspense >
                <UpdaterButton />
              </Suspense>
            </div>
          }
          <Body activeScreen={activeScreen} lang={language} />

          <div className="dock  dock-sm  bg-gray-50 border-0 ">
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
      </UpdateProvider>
      </EngineStateContext.Provider>
    </NavContext.Provider>
  );
}

export default App;