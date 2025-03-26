import { message } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from "react";
import SettingsBody from '../components/home/settings-body';
import { InfoCircle, Power } from 'react-bootstrap-icons';

export default function Home() {

  const [isOn, setIsOn] = useState(false);
  const [isOnLoading, setIsOnLoading] = useState(false);
  const handleToggle = async () => {
    setIsOnLoading(true);

    try {
      // 模拟异步操作，随机成功或失败
      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          // 80%的概率成功，20%的概率失败
          if (Math.random() > 0.2) {
            resolve(true);
          } else {
            await message('连接失败，请检查网络', { title: '错误', kind: 'error' });

            reject(new Error('连接失败，请检查网络'));
          }
        }, 800); // 800ms延迟模拟网络请求
      });

      // 成功时切换状态
      setIsOn(!isOn);
    } catch (err) {
      // 不改变isOn状态 - 保持原有状态
    } finally {
      setIsOnLoading(false);
    }
  };

  const [selectedMode, setSelectedMode] = useState('规则');

  // 添加动画参考元素
  const modeButtonsRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({
    left: 0,
    width: 0,
  });




  // 处理模式选择
  const handleModeChange = (mode: string) => {
    setSelectedMode(mode);
  };

  // 更新指示器位置的效果
  useEffect(() => {
    if (modeButtonsRef.current) {
      const container = modeButtonsRef.current;
      const activeButton = container.querySelector(`button[data-mode="${selectedMode}"]`);

      if (activeButton) {
        const containerRect = container.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();

        setIndicatorStyle({
          left: buttonRect.left - containerRect.left,
          width: buttonRect.width,
        });
      }
    }
  }, [selectedMode]);

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
            key={mode}
            data-mode={mode}
            className={` cursor-pointer px-6 py-1.5 text-sm font-medium transition-all duration-300 relative
              ${selectedMode === mode
                ? 'text-gray-800'
                : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => handleModeChange(mode)}
          >
            <span className="relative z-10">{mode}</span>
          </button>
        ))}
      </div>
      <SettingsBody></SettingsBody>


    
    </div>
  )
}