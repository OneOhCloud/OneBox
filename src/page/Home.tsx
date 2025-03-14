import { message } from '@tauri-apps/plugin-dialog';
import { Info, Power, Shield } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export default function Home() {

  const [isOn, setIsOn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setIsLoading(true);
    setError(null);

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
      // 失败时显示错误消息
      setError(err instanceof Error ? err.message : '发生未知错误');
      // 不改变isOn状态 - 保持原有状态
    } finally {
      setIsLoading(false);
    }
  };

  const [selectedMode, setSelectedMode] = useState('规则');
  const [selectedNode, setSelectedNode] = useState('自动选择');
  const [selectedSubscription, setSelectedSubscription] = useState('订阅配置1');

  // 添加动画参考元素
  const modeButtonsRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({
    left: 0,
    width: 0,
  });

  const handleNodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedNode(e.target.value);
  };

  // 处理订阅选择变更
  const handleSubscriptionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSubscription(e.target.value);

  }
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

      <label className={`cursor-pointer ${isLoading ? 'pointer-events-none' : ''}`}>
        <input type="checkbox" checked={isOn} onChange={() => { }} className="hidden" />
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
                ${isOn ? 'ring-2 ring-blue-500' : ''}
          
              `}
            >
              <Power
                size={40}
                className={`
                  transition-colors duration-300
                  ${isOn ? 'text-blue-500' : 'text-gray-400'}
                  ${isLoading ? ' opacity-70' : ''}
                `}
              />
            </div>
          </div>
        </div>
      </label>

      <div className="w-full text-center text-sm mb-2 flex items-center justify-center" style={{ color: isOn ? '#3B82F6' : '#9CA3AF' }}>
        <Info size={16} className="mr-1.5 text-gray-300" />
        <span className="text-base">
          {isLoading ? '正在切换...' : isOn ? '已连接' : '未连接'}
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
      <div className='w-full bg-white p-4 rounded-xl shadow-sm'>

        <fieldset className="fieldset w-full">
          <legend className="fieldset-legend">节点选择</legend>
          <div className="relative">
            <select
              value={selectedNode}
              onChange={handleNodeChange}
              className="select w-full pl-4 pr-10 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none"
            >
              <option disabled={true} className="text-gray-400">不可用节点</option>
              <option className="py-1">自动选择</option>
              <option className="py-1">FireFox</option>
              <option className="py-1">Safari</option>
              {Array.from({ length: 20 }, (_, i) => (
                <option key={i} className="py-1">Option {i + 1}</option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="fieldset w-full">
          <legend className="fieldset-legend">选中订阅</legend>
          <div className="relative">
            <select
              value={selectedSubscription}
              onChange={handleSubscriptionChange}
              className="select w-full pl-4 pr-10 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none hover:border-blue-300 transition-colors"
            >
              <option disabled={true} className="text-gray-400">Pick a browser</option>
              <option className="py-1">订阅配置1</option>
              <option className="py-1">FireFox</option>
              <option className="py-1">Safari</option>
              {Array.from({ length: 20 }, (_, i) => (
                <option key={i} className="py-1">Option {i + 1}</option>
              ))}
            </select>
          </div>
        </fieldset>
      </div>


      <div className="w-full flex items-center justify-center mt-4 mb-2">
        <Shield size={14} className="text-gray-400 mr-1" />
        <span className="text-xs text-gray-400">当前订阅 </span>
        <span className="text-xs text-blue-500 ml-1">有效至 2025年3月13日</span>
      </div>
    </div>
  )
}