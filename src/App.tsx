import { getCurrentWindow } from '@tauri-apps/api/window';
import {  useState } from 'react';
import { X, Dash, GearWideConnected, House, Layers } from 'react-bootstrap-icons';
import "./App.css";
import ConfigurationPage from './page/config';
import HomePage from './page/home';
import SettingsPage from './page/settings';
import { motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import Dev from './page/dev';



const appWindow = getCurrentWindow();
const debug = false



function App() {
  const [activeScreen, setActiveScreen] = useState<'home' | 'configuration' | 'settings'>('home');
  const [isSettingsHovered, setIsSettingsHovered] = useState(false);



  // 通用的导航处理方法，接受屏幕名称作为参数
  const handleScreenChange = (screen: 'home' | 'configuration' | 'settings') => {
    setActiveScreen(screen);
  };

  const handleClose = async () => {
    await appWindow.hide();
  };

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  if (debug) {
    return <Dev></Dev>
  }

  // 余下代码保持不变
  return (
    <main className="bg-gray-50 grid grid-rows-[auto_1fr_auto] h-dvh">
      <Toaster position="top-center" toastOptions={{ duration: 2000 }} containerClassName="mt-[32px]" />
      <div data-tauri-drag-region
        className={`px-4 py-2.5 flex items-center justify-betweenbg-white/80 backdrop-blur-lg  border-b border-gray-200`}>
        <div className="flex items-center">
          <div className="mr-3 flex items-center gap-1.5">
            <div onClick={handleClose}
              className="size-3 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-all cursor-pointer group"
              title="关闭">
              <X size={12} className="text-transparent group-hover:text-red-900" />
            </div>
            <div onClick={handleMinimize}
              className="size-3 bg-yellow-400 rounded-full flex items-center justify-center hover:bg-yellow-500 transition-all cursor-pointer group"
              title="最小化">
              <Dash size={12} className="text-transparent group-hover:text-yellow-900" />
            </div>
            <div className="size-3 bg-green-500 rounded-full flex opacity-50 cursor-default"></div>
          </div>

          <span className="ml-2 font-medium text-sm tracking-tight">OneBox</span>
        </div>
      </div>

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