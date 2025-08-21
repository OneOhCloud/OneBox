import "./App.css";

import { motion } from 'framer-motion';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import { Toaster } from 'sonner';

import React from 'react';
import HomePage from "./page/home";
import { ActiveScreenType, NavContext } from './single/context';
import { initLanguage, t } from './utils/helper';

const ConfigurationPage = React.lazy(() => import('./page/config'));
const DevPage = React.lazy(() => import('./page/developer'));
const SettingsPage = React.lazy(() => import('./page/settings'));
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