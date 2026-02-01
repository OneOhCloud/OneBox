import clsx from 'clsx';

import { useEffect } from "react";
import { InfoCircle, Power } from 'react-bootstrap-icons';
import Body from '../components/home/body';
import { ProxyMode, useModeIndicator, useProxyMode, useVPNOperations } from "../components/home/hooks";
import AuthDialog from '../components/settings/auth-dialog';
import { useSubscriptions } from '../hooks/useDB';
import { t } from "../utils/helper";

import './home.css';

export default function HomePage() {
  // 使用自定义hooks管理状态和逻辑
  const { data: subscriptions } = useSubscriptions();
  const { selectedMode, initializeMode, changeMode } = useProxyMode();
  const {
    isLoading,
    isRunning,
    operationStatus,
    privilegedDialog,
    setPrivilegedDialog,
    startService,
    toggleService,
    restartService,
    mutate
  } = useVPNOperations();
  const { indicatorStyle, modeButtonsRef } = useModeIndicator(selectedMode);

  // 派生状态
  const isEmpty = !subscriptions?.length;

  // 初始化效果
  useEffect(() => {
    mutate();
    initializeMode();

  }, []);

  /**
   * 处理模式切换
   */
  const handleModeChange = async (mode: ProxyMode) => {
    // 必须先保存当前的模式
    await changeMode(mode);

    // 如果服务正在运行或加载中，需要重启服务
    if (isLoading || isRunning) {
      await restartService(isEmpty);
    }
  };

  const handleUpdate = async () => {
    await restartService(isEmpty);
  }



  /**
   * 获取状态文本显示
   */
  const getStatusText = () => {
    switch (operationStatus) {
      case 'starting':
        return t('connecting');
      case 'stopping':
        return t('switching');
      default:
        return isLoading ? t('switching') : isRunning ? t('connected') : t('not_connected');
    }
  };

  return (
    <div className="bg-gray-50 flex flex-col items-center justify-center p-6 w-full  h-[calc(100dvh-56px)]">
      {/* 权限认证对话框 */}
      <AuthDialog
        onAuthSuccess={async () => {
          setPrivilegedDialog(false);
          await startService(isEmpty);
        }}
        open={privilegedDialog}
        onClose={() => setPrivilegedDialog(false)}
      />

      {/* 主开关按钮 */}
      <label className={`cursor-pointer ${isLoading ? 'pointer-events-none' : ''}`}>
        <input type="checkbox" checked={isRunning} onChange={() => { }} className="hidden" />
        <div
          className="relative w-36 h-36 mb-6"
          onClick={!isLoading ? () => toggleService(isEmpty) : undefined}
        >
          {/* 背景圆环动画 */}
          <div className="absolute inset-0 bg-blue-100 rounded-full opacity-10"></div>
          <div className="absolute inset-2 bg-blue-100 rounded-full opacity-20"></div>
          <div className="absolute inset-4 bg-blue-100 rounded-full opacity-30"></div>

          {/* 中心按钮 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={
                clsx(
                  "bg-white rounded-full w-24 h-24 flex items-center justify-center shadow-md transition-all duration-300 ease-in-out",
                  isRunning ? "ring-2 ring-blue-500" : "",
                  isLoading ? "ring-1 ring-blue-500  opacity-80" : "hover:scale-105"
                )
              }
            >
              <Power
                size={40}
                className={
                  clsx(
                    "transition-colors duration-300",
                    isLoading || isRunning ? "text-blue-500" : "text-gray-400"
                  )
                }
              />
            </div>
          </div>
        </div>
      </label>

      {/* 状态文本显示 */}
      <div

        className={
          clsx(
            "w-full text-center text-sm mb-2 flex items-center justify-center ",
            isLoading || isRunning ? "text-blue-500" : "text-gray-400",
          )
        }

      >
        <InfoCircle size={16} className="mr-1.5 text-gray-300" />
        <span className="text-base capitalize">
          {getStatusText()}
        </span>
      </div>

      {/* 模式切换器 */}
      <div className="bg-gray-100 p-1 rounded-xl mb-4 inline-flex relative" ref={modeButtonsRef}>
        {/* 动画指示器 */}
        <span
          className="absolute top-1 bottom-1 bg-white rounded-lg shadow-sm transition-all duration-300 ease-in-out"
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`
          }}
        />

        {/* 模式按钮 */}
        {(['rules', 'global'] as const).map((mode) => (
          <div key={mode} className='tooltip text-xs  tooltip-delayed'>
            <div className="tooltip-content">
              <div className="text-xs max-w-55 whitespace-normal">
                {t(`${mode}_tip`)}
              </div>
            </div>
            <button
              data-mode={mode}
              className={`
                capitalize relative px-4 py-1 rounded-lg transition-colors duration-300 
                ${selectedMode === mode ? 'text-black' : 'text-gray-500 hover:text-gray-700'}
              `}
              onClick={() => handleModeChange(mode)}
            >
              {t(mode)}
            </button>
          </div>

        ))}
      </div>

      {/* 主体内容 */}
      <Body isRunning={Boolean(isRunning)} onUpdate={handleUpdate} />
    </div>
  );
}