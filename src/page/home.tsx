import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { message } from '@tauri-apps/plugin-dialog';
import { type } from '@tauri-apps/plugin-os';
import { useContext, useEffect, useRef, useState } from "react";
import { InfoCircle, Power } from 'react-bootstrap-icons';
import VPNBody from '../components/home/vpn-body';
import AuthDialog from '../components/settings/auth-dialog';

import { setGlobalMixedConfig, setGlobalTunConfig, setMixedConfig, setTunConfig } from '../config/helper';
import { useSubscriptions } from '../hooks/useDB';
import { NavContext } from '../single/context';
import { getClashApiSecret, getEnableTun, getStoreValue, setStoreValue } from "../single/store";
import { RULE_MODE_STORE_KEY, SING_BOX_VERSION, SSI_STORE_KEY } from '../types/definition';
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
    getClashApiSecret().then(async (secret) => {
      const status = await invoke<boolean>("is_running", { secret: secret });
      setIsOn(status);
    })

    // 获取当前规则模式
    getStoreValue(RULE_MODE_STORE_KEY).then((v: SelectedModeType) => {
      if (v) {
        setSelectedMode(v);
      } else {
        setStoreValue(RULE_MODE_STORE_KEY, 'rules');
        setSelectedMode('rules');
      }

    }).catch((error) => {
      console.error('获取规则模式发生错误:', error);
      setStoreValue(RULE_MODE_STORE_KEY, 'rules');
      setSelectedMode('rules');

    });
  }, []);

  //事件监听 
  useEffect(() => {
    const unsubscribe = listen('status-changed', async (_) => {
      let secret = await getClashApiSecret();

      setIsOn(await invoke<boolean>('is_running', { secret: secret }));
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

    //zh: 直接使用 getStoreValue(RULE_MODE_STORE_KEY) 代替 setStoreValue 来获取当前模式，这样不会读到旧的值
    //en: Directly use getStoreValue(RULE_MODE_STORE_KEY) instead of setStoreValue to get the current mode, so that the old value will not be read
    const currentMode = await getStoreValue(RULE_MODE_STORE_KEY)

    //zh: 在 linux 和 macOS 上使用 TUN 模式时需要输入超级管理员密码
    //en: When using TUN mode on linux and macOS, you need to enter the super administrator password
    if (useTun && (type() == 'linux' || type() == 'macos')) {
      console.log('在 Linux 或 macOS 上使用 TUN 模式，需要输入超级管理员密码');
      const privileged = await verifyPrivileged();
      console.log('是否有超级管理员权限:', privileged);
      if (!privileged) {
        console.log('没有超级管理员权限，弹出授权对话框');
        setPrivilegedDialog(true);
        return false;
      } else {
        console.log('有超级管理员权限，继续配置');
        console.log('privileged:', privileged);
      }
      const fn = currentMode === 'global' ? setGlobalTunConfig : setTunConfig;
      await fn(identifier, SING_BOX_VERSION);
    } else if (useTun && type() == 'windows') {
      console.log('在 Windows 上使用 TUN 模式，无需密码');
      const fn = currentMode === 'global' ? setGlobalTunConfig : setTunConfig;
      await fn(identifier, SING_BOX_VERSION);
    } else {
      console.log('使用普通模式');
      const fn = currentMode === 'global' ? setGlobalMixedConfig : setMixedConfig;
      await fn(identifier, SING_BOX_VERSION);
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
    if (!ok) {
      await turnOff();
    } else {
      await vpnServiceManager.start();
    }
  }

  const restart = async () => {
    setIsOnLoading(true);
    try {
      await turnOff();
      await turnOn();
    } catch (error) {
      console.error('重启服务失败:', error);
      await message(t('reconnect_failed'), { title: t('error'), kind: 'error' });
    } finally {
      setTimeout(() => setIsOnLoading(false), 1200);
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
      console.error('连接失败:', error);
      await message(`${t('connect_failed')}: ${error}`, { title: t('error'), kind: 'error' });
    } finally {
      setTimeout(() => setIsOnLoading(false), 1200);
    }
  };

  const handleModeChange = async (mode: SelectedModeType) => {

    // zh: 一定要先保存当前的模式！！
    // en: You must save the current mode first!!
    await setStoreValue(RULE_MODE_STORE_KEY, mode);
    setSelectedMode(mode);

    // zh: 然后重启服务
    // en: Then restart the service
    if (isOnLoading || isOn) {
      await restart();
    }
  };

  return (
    <div className="bg-gray-50 flex flex-col items-center justify-center p-6  w-full">
      <AuthDialog onAuthSuccess={async () => {
        setPrivilegedDialog(false);
        setIsOnLoading(true);
        await turnOn();
        setTimeout(() => {
          setIsOnLoading(false);
        }, 1200);

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
        <span className="text-base capitalize">
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
          <div key={mode} className='tooltip text-xs' >
            <div className="tooltip-content">
              <div className="text-xs max-w-[220px] whitespace-normal">
                {t(`${mode}_tip`)}
              </div>
            </div>
            <button
              data-mode={mode}
              className={`capitalize relative px-4 py-1 rounded-lg transition-colors duration-300 ${selectedMode === mode ? 'text-black' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => handleModeChange(mode as SelectedModeType)}
            >

              {t(mode)}
            </button>
          </div>
        ))}
      </div>

      <VPNBody isRunning={isOn}></VPNBody>

    </div >
  )
}