import { message } from '@tauri-apps/plugin-dialog';
import { useContext, useEffect, useRef, useState } from "react";
import { InfoCircle, Power } from 'react-bootstrap-icons';
import VPNBody from '../components/home/vpn-body';
import AuthDialog from '../components/settings/auth-dialog';

import { useSubscriptions } from '../hooks/useDB';
import { useIsRunning } from '../hooks/useVersion';
import { NavContext } from '../single/context';
import { getStoreValue, setStoreValue } from "../single/store";
import { RULE_MODE_STORE_KEY } from '../types/definition';
import { t, vpnServiceManager } from "../utils/helper";

type SelectedModeType = 'rules' | 'global';

export default function HomePage() {
  // 使用NavContext替代props
  const { setActiveScreen } = useContext(NavContext);

  // 状态管理
  const [isOperating, setIsOperating] = useState(false);
  const [operationStatus, setOperationStatus] = useState<'starting' | 'stopping' | 'idle'>('idle');
  const [selectedMode, setSelectedMode] = useState<SelectedModeType>('rules');
  const [isEmpty, setIsEmpty] = useState(false);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [privilegedDialog, setPrivilegedDialog] = useState(false);

  const modeButtonsRef = useRef<HTMLDivElement>(null);
  const { data } = useSubscriptions();
  const { isRunning, isLoading: serviceLoading, mutate } = useIsRunning()

  // 合并所有loading状态
  const isLoading = isOperating || serviceLoading;


  // 初始化检查
  useEffect(() => {
    mutate();
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


  const turnOff = async () => {
    setOperationStatus('stopping');
    await vpnServiceManager.stop();
    mutate();
    setOperationStatus('idle');
  }

  const turnOn = async () => {
    if (isEmpty) {
      setActiveScreen('configuration');
      return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
    }

    // 立即设置为操作中状态，给用户即时反馈
    setIsOperating(true);
    setOperationStatus('starting');

    vpnServiceManager.syncConfig({
      onSuccess: async () => {
        try {
          await vpnServiceManager.start();
          mutate(); // 确保服务启动后再更新状态
        } catch (error) {
          console.error('启动服务失败:', error);
          await message(t('connect_failed'), { title: t('error'), kind: 'error' });
        } finally {
          setIsOperating(false);
          setOperationStatus('idle');
        }
      },
      onError: async (error) => {
        console.error('同步配置失败:', error);
        await turnOff();
        setIsOperating(false);
        setOperationStatus('idle');
      },
      onRequirePrivileged: () => {
        setPrivilegedDialog(true);
        setIsOperating(false);
        setOperationStatus('idle');
      }
    });

  }

  const restart = async () => {
    setIsOperating(true);
    try {
      await turnOff();
      await turnOn();
    } catch (error) {
      console.error('重启服务失败:', error);
      await message(t('reconnect_failed'), { title: t('error'), kind: 'error' });
    } finally {
      setTimeout(() => setIsOperating(false), 1200);
    }
  }

  const handleToggle = async () => {
    if (isEmpty) {
      setActiveScreen('configuration');
      return message(t('please_add_subscription'), { title: t('tips'), kind: 'error' });
    }

    try {
      // 根据当前状态决定是开启还是关闭
      if (isRunning) {
        await turnOff(); // turnOff 内部会处理状态
      } else {
        await turnOn(); // turnOn 内部会处理 isOperating 状态
      }
    } catch (error) {
      console.error('连接失败:', error);
      await message(`${t('connect_failed')}: ${error}`, { title: t('error'), kind: 'error' });
      setIsOperating(false);
      setOperationStatus('idle');
    }
  };

  const handleModeChange = async (mode: SelectedModeType) => {

    // zh: 一定要先保存当前的模式！！
    // en: You must save the current mode first!!
    await setStoreValue(RULE_MODE_STORE_KEY, mode);
    setSelectedMode(mode);

    // zh: 然后重启服务
    // en: Then restart the service
    if (isLoading || isRunning) {
      await restart();
    }
  };

  return (
    <div className="bg-gray-50 flex flex-col items-center justify-center p-6  w-full">
      <AuthDialog onAuthSuccess={async () => {
        setPrivilegedDialog(false);
        await turnOn(); // turnOn 内部会处理 isOperating 状态
      }} open={privilegedDialog} onClose={() => { setPrivilegedDialog(false) }} />

      <label className={`cursor-pointer ${isLoading ? 'pointer-events-none' : ''}`}>
        <input type="checkbox" checked={isRunning} onChange={() => { }} className="hidden" />
        <div
          className="relative w-36 h-36 mb-6"
          onClick={!isLoading ? handleToggle : undefined}
        >
          <div className="absolute inset-0 bg-blue-100 rounded-full opacity-10"></div>
          <div className="absolute inset-2 bg-blue-100 rounded-full opacity-20"></div>
          <div className="absolute inset-4 bg-blue-100 rounded-full opacity-30"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={`
                bg-white rounded-full w-24 h-24 flex items-center justify-center
                shadow-md transition-all duration-300 ease-in-out
                ${isRunning ? 'ring-2 ring-blue-500' : ''}
              `}
            >
              <Power
                size={40}
                className={`
                  transition-colors duration-300
                  ${isRunning ? 'text-blue-500' : 'text-gray-400'}
                  ${isLoading ? ' opacity-70' : ''}
                `}
              />
            </div>
          </div>
        </div>
      </label>

      <div className="w-full text-center text-sm mb-2 flex items-center justify-center" style={{ color: isRunning ? '#3B82F6' : '#9CA3AF' }}>
        <InfoCircle size={16} className="mr-1.5 text-gray-300" />
        <span className="text-base capitalize">
          {operationStatus === 'starting' ? t('connecting') :
            operationStatus === 'stopping' ? t('switching') :
              isLoading ? t('switching') :
                isRunning ? t('connected') : t('not_connected')}
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

      <VPNBody isRunning={Boolean(isRunning)}></VPNBody>

    </div >
  )
}