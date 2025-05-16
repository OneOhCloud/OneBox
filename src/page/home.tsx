import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { message } from '@tauri-apps/plugin-dialog';
import { type } from '@tauri-apps/plugin-os';
import { useContext, useEffect, useRef, useState } from "react";
import { InfoCircle, Power } from 'react-bootstrap-icons';
import SettingsBody from '../components/home/settings-body';
import AuthDialog from '../components/settings/auth-dialog';
import setGlobalMixedConfig from '../config/global-mixed-config';
import setGlobalTunConfig from '../config/global-tun-config';
import setMixedConfig from "../config/mixed-config";
import setTunConfig from "../config/tun-config";
import { useSubscriptions } from '../hooks/useDB';
import { NavContext } from '../single/context';
import { getEnableTun, getStoreValue, setStoreValue } from "../single/store";
import { RULE_MODE_STORE_KEY, SSI_STORE_KEY } from '../types/definition';
import { t, verifyPrivileged, vpnServiceManager } from "../utils/helper";

type SelectedModeType = 'rules' | 'global';

export default function HomePage() {
  // 使用NavContext替代props
  const { setActiveScreen } = useContext(NavContext);

  // 状态管理
  const [isOn, setIsOn] = useState(false);
  const [isOnLoading, setIsOnLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<SelectedModeType>('rules');
  const [isEmpty, setIsEmpty] = useState(false);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [privilegedDialog, setPrivilegedDialog] = useState(false);

  const modeButtonsRef = useRef<HTMLDivElement>(null);
  const { data } = useSubscriptions();

  // 初始化检查
  useEffect(() => {
    //  检查是否正在运行
    invoke<boolean>('is_running').then(setIsOn).catch((error) => {
      console.error('Error checking VPN status:', error);
      setIsOn(false);
    });

    // 获取当前规则模式
    getStoreValue(RULE_MODE_STORE_KEY).then((s) => {
      if (s === '规则') {
        setSelectedMode('rules');
      } else if (s === '全局') {
        setSelectedMode('global');
      } else {
        setSelectedMode('rules');
      }
    }).catch((error) => {
      console.error('获取规则模式发生错误:', error);
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

  // 抽取配置逻辑
  const configureProxy = async (identifier: string) => {
    const useTun = await getEnableTun();

    // 在 linux 和 macOS 上使用 TUN 模式时需要输入超级管理员密码
    if (useTun && (type() == 'linux' || type() == 'macos')) {
      console.log('在 Linux 或 macOS 上使用 TUN 模式，需要输入超级管理员密码');
      const privileged = await verifyPrivileged();
      console.log('是否有超级管理员权限:', privileged);
      if (!privileged) {
        console.log('没有超级管理员权限，弹出授权对话框');
        setPrivilegedDialog(true);
        return false;
      }
      const fn = selectedMode === 'global' ? setGlobalTunConfig : setTunConfig;
      await fn(identifier);
    } else if (useTun && type() == 'windows') {
      console.log('在 Windows 上使用 TUN 模式，无需密码');
      const fn = selectedMode === 'global' ? setGlobalTunConfig : setTunConfig;
      await fn(identifier);
    } else {
      console.log('使用普通模式');
      const fn = selectedMode === 'global' ? setGlobalMixedConfig : setMixedConfig;
      await fn(identifier);
    }
    return true;
  };

  const turnOff = async () => {
    await vpnServiceManager.stop();
  }

  const turnOn = async () => {
    if (isEmpty) {
      setActiveScreen('configuration');
      return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
    }
    const identifier = await getStoreValue(SSI_STORE_KEY);
    const ok = await configureProxy(identifier);
    if (!ok) return;
    await vpnServiceManager.start();
  }

  const restart = async () => {
    setIsOnLoading(true);
    try {
      await turnOff();
      await turnOn();
    } catch (error) {
      await message(t('reconnect_failed'), { title: t('error'), kind: 'error' });
    } finally {
      setTimeout(() => setIsOnLoading(false), 1600);
    }
  }

  const handleToggle = async () => {
    if (isEmpty) {
      setActiveScreen('configuration');
      return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
    }
    setIsOnLoading(true);
    try {
      // 根据当前状态决定是开启还是关闭
      isOn ? await turnOff() : await turnOn();
      setIsOn(prev => !prev);
    } catch (error) {
      await message(t('connect_failed'), { title: t('error'), kind: 'error' });
    } finally {
      setTimeout(() => setIsOnLoading(false), 1200);
    }
  };

  const handleModeChange = async (mode: SelectedModeType) => {
    if (isOnLoading || isOn) {
      await restart();
    }
    // 转换回中文存储
    const storeMode = mode === 'rules' ? '规则' : '全局';
    await setStoreValue(RULE_MODE_STORE_KEY, storeMode);
    setSelectedMode(mode);
  };

  return (
    <div className="bg-gray-50 flex flex-col items-center justify-center p-6 h-full w-full">
      <AuthDialog onAuthSuccess={() => {
        setPrivilegedDialog(false);
      }} open={privilegedDialog} onClose={() => { setPrivilegedDialog(false) }} />

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
          {isOnLoading ? t('switching') : isOn ? t('connected') : t('not_connected')}
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

        {['rules', 'global'].map((mode) => (
          <button
            key={mode}
            data-mode={mode}
            className={`relative px-4 py-1 rounded-lg transition-colors duration-300 ${selectedMode === mode ? 'text-black' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => handleModeChange(mode as SelectedModeType)}
          >
            {t(mode)}
          </button>
        ))}
      </div>

      <SettingsBody isRunning={isOn}></SettingsBody>

    </div >
  )
}