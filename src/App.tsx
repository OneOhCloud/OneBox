import { motion } from 'framer-motion';
import { useState } from 'react';
import { GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import { Toaster } from 'react-hot-toast';
import "./App.css";
import ConfigurationPage from './page/config';
import Dev from './page/dev';
import HomePage from './page/home';
import SettingsPage from './page/settings';



const debug = true;



function App() {
  const [activeScreen, setActiveScreen] = useState<'home' | 'configuration' | 'settings'>('home');
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);



  // 通用的导航处理方法，接受屏幕名称作为参数
  const handleScreenChange = (screen: 'home' | 'configuration' | 'settings') => {
    setActiveScreen(screen);
  };

  if (debug) {
    return <Dev></Dev>
  }

  // 余下代码保持不变
  return (
    <main className="bg-gray-50 grid grid-rows-[auto_1fr_auto] h-dvh">
      <Toaster position="top-center" toastOptions={{ duration: 2000 }} containerClassName="mt-[32px]" />


      <div className=" mb-14  h-[472.8px] overflow-y-hidden">

        {activeScreen === 'home' && <div className="animate-fade-in h-full"><HomePage onNavigate={handleScreenChange} /></div>}
        {activeScreen === 'configuration' && <div className="animate-fade-in h-full"><ConfigurationPage /></div>}
        {activeScreen === 'settings' && <div className="animate-fade-in h-full"><SettingsPage /></div>}
      </div>

      <div className="dock  dock-sm  bg-gray-50/50 backdrop-blur-3xl  border-0 rounded-t-xs">
        <button
          onClick={() => handleScreenChange('home')}
          className={` ${activeScreen === 'home' ? 'text-blue-500' : ''}`}
        >
          <House />
          <span className='text-xs'>主页</span>
        </button>

        <button
          onClick={() => handleScreenChange('configuration')}
          className={`${activeScreen === 'configuration' ? 'text-blue-500' : ''}`}
        >
          <Layers />
          <span className='text-xs'>配置</span>
        </button>

        <button
          onClick={() => handleScreenChange('settings')}
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
          <span className='text-xs'>设置</span>
        </button>
      </div>
    </main>
  );
}

export default App;