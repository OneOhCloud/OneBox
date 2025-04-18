import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { message } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from "react";
import { InfoCircle, Power } from 'react-bootstrap-icons';
import SettingsBody from '../components/home/settings-body';
import setMixedConfig from "../config/mixed-config";
import setTunConfig from "../config/tun-config";
import { useSubscriptions } from '../hooks/useDB';
import { getEnableTun, getStoreValue } from "../single/store";
import { vpnServiceManager } from "../utils/helper";



type HomeProps = {
  onNavigate: (screen: 'home' | 'configuration' | 'settings') => void;
}




export default function Home({ onNavigate }: HomeProps) {
  // 状态管理
  const [isOn, setIsOn] = useState(false);
  const [isOnLoading, setIsOnLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState('规则');
  const [isEmpty, setIsEmpty] = useState(false);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const modeButtonsRef = useRef<HTMLDivElement>(null);
  const { data } = useSubscriptions();

  // 初始化检查
  useEffect(() => {
    invoke<boolean>('is_running').then(setIsOn).catch((error) => {
      console.error('Error checking VPN status:', error);
    });
  }, []);




  //事件监听 
  useEffect(() => {
    const unsubscribe = listen('status-changed', async (_) => {
      setIsOn(await invoke<boolean>('is_running'));
    });

    return () => {
      unsubscribe.then(fn => fn());
    };
  }, []);

  // 订阅数据监听
  useEffect(() => {
    setIsEmpty(!data?.length);
  }, [data]);


  // 模式指示器位置更新
  useEffect(() => {
    const container = modeButtonsRef.current;
    const activeButton = container?.querySelector(`button[data-mode="${selectedMode}"]`);

    if (container && activeButton) {
      const containerRect = container.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();

      setIndicatorStyle({
        left: buttonRect.left - containerRect.left,
        width: buttonRect.width,
      });
    }
  }, [selectedMode]);

  const handleToggle = async () => {
    if (isEmpty) {
      onNavigate('configuration');
      await message('请先添加订阅配置', { title: '提示', kind: 'error' });
      return;
    }

    setIsOnLoading(true);
    try {
      // await (isOn ? vpnServiceManager.stop : vpnServiceManager.start)();
      if (isOn) {
        await vpnServiceManager.stop();
      }
      else {
        const identifier = await getStoreValue('selected_subscription_identifier');
        const tunMode = await getEnableTun();
        await (tunMode ? setTunConfig : setMixedConfig)(identifier);
        await vpnServiceManager.start();
      }

      setIsOn(!isOn);
    } catch (error) {
      await message('连接失败，请检查网络', { title: '错误', kind: 'error' });
    } finally {
      setIsOnLoading(false);
    }
  };

  const handleModeChange = (mode: string) => {
    setSelectedMode(mode);
  };

  return (
    <div className="bg-gray-50 flex flex-col items-center justify-center p-6 h-full w-full">

      <label className={`cursor-pointer ${isOnLoading ? 'pointer-events-none' : ''}`}>
        <input type="checkbox" checked={isOn} onChange={() => { }} className="hidden" />
        <div
          className="relative w-36 h-36 mb-6"
          onClick={!isOnLoading ? handleToggle : undefined}
        >
          <div className="absolute inset-0 bg-blue-100 rounded-full opacity-10"></div>
          <div className="absolute inset-2 bg-blue-100 rounded-full opacity-20"></div>
          <div className="absolute inset-4 bg-blue-100 rounded-full opacity-30"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={`
                bg-white rounded-full w-24 h-24 flex items-center justify-center
                shadow-md transition-all duration-300 ease-in-out
                ${isOn ? 'ring-2 ring-blue-500' : ''}
          
              `}
            >
              <Power
                size={40}
                className={`
                  transition-colors duration-300
                  ${isOn ? 'text-blue-500' : 'text-gray-400'}
                  ${isOnLoading ? ' opacity-70' : ''}
                `}
              />
            </div>
          </div>
        </div>
      </label>

      <div className="w-full text-center text-sm mb-2 flex items-center justify-center" style={{ color: isOn ? '#3B82F6' : '#9CA3AF' }}>
        <InfoCircle size={16} className="mr-1.5 text-gray-300" />
        <span className="text-base">
          {isOnLoading ? '正在切换...' : isOn ? '已连接' : '未连接'}
        </span>
      </div>

      <div className="bg-gray-100 p-1 rounded-xl mb-4 inline-flex relative" ref={modeButtonsRef}>
        {/* 动画指示器 */}
        <span
          className="absolute top-1 bottom-1 bg-white rounded-lg shadow-sm transition-all duration-300 ease-in-out"
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`
          }}
        />

        {['规则', '全局', '直连'].map((mode) => (
          <button
            disabled={!isOn}
            key={mode}
            data-mode={mode}
            className={`  px-6 py-1.5 text-sm font-medium transition-all duration-300 relative
              ${selectedMode === mode
                ? 'text-gray-800'
                : 'text-gray-500 hover:text-gray-700'}
              ${isOn ? 'cursor-pointer' : 'cursor-not-allowed'}
                `}
            onClick={() => handleModeChange(mode)}
          >
            <span className="relative z-10">{mode}</span>
          </button>

        ))}

      </div>
      <SettingsBody isRunning={isOn}></SettingsBody>



    </div>
  )
}