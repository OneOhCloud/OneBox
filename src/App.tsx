import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import { Toaster } from 'react-hot-toast';
import "./App.css";

import ConfigurationPage from './page/config';
import DevPage from './page/developer';
import HomePage from './page/home';
import SettingsPage from './page/settings';
import { ActiveScreenType, NavContext } from './single/context';
import { initLanguage, t } from './utils/helper';




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

      <main className="bg-gray-50 flex flex-col h-screen">

        <div className="flex-1 overflow-y-hidden ">
          {activeScreen === 'home' &&
            <div className="animate-fade-in h-full">
              <HomePage />
            </div>
          }
          {activeScreen === 'configuration' &&
            <div className="animate-fade-in h-full">
              <ConfigurationPage />
            </div>
          }
          {activeScreen === 'settings' &&
            <div className="animate-fade-in h-full">
              <SettingsPage />
            </div>
          }
          {activeScreen === 'developer_options' &&
            <div className="animate-fade-in h-full">
              <DevPage />
            </div>}
        </div>

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