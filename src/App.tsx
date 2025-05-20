import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import { Toaster } from 'react-hot-toast';
import "./App.css";

import ConfigurationPage from './page/config';
import Dev from './page/dev';
import HomePage from './page/home';
import SettingsPage from './page/settings';
import { NavContext } from './single/context';
import { t } from './utils/helper';

const debug = false;



function App() {
  const [activeScreen, setActiveScreen] = useState<'home' | 'configuration' | 'settings'>('home');
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);
  const [dockLang, setDockLang] = useState({
    home: t("home"),
    configuration: t("configuration"),
    settings: t("settings"),
  })

  const [language, setLanguage] = useState('unknown');

  if (debug) {
    return <Dev></Dev>
  }

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

  return (
    <NavContext.Provider value={{ activeScreen, setActiveScreen, handleLanguageChange }}>
      <main className="bg-gray-50 grid grid-rows-[auto_1fr_auto] h-dvh">
        <Toaster position="top-center" toastOptions={{ duration: 2000 }} containerClassName="mt-[32px]" />

        <div className="max-h-[488px] overflow-y-hidden ">
          {activeScreen === 'home' && <div className="animate-fade-in h-full"><HomePage /></div>}
          {activeScreen === 'configuration' && <div className="animate-fade-in h-full"><ConfigurationPage /></div>}
          {activeScreen === 'settings' && <div className="animate-fade-in h-full"><SettingsPage /></div>}
        </div>

        {language && (
          <div className="dock  dock-sm  bg-gray-50 backdrop-blur-xl  border-0 rounded-t-xs">
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
        )}
      </main>
    </NavContext.Provider>
  );
}

export default App;