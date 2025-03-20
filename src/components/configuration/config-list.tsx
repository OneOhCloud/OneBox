import { useEffect, useState } from 'react';
import { Link, Plus } from 'react-bootstrap-icons';
import { SubscriptionConfig } from '../../types/SubscriptionConfig';
import { ConfigItem } from './config-item';

interface ConfigListProps {
    configs: SubscriptionConfig[];
    activeConfigId?: string; // 新增属性，表示当前正在使用的配置ID
    onAddConfig: () => void;
    onEditConfig: (config: SubscriptionConfig) => void;
    onDeleteConfig: (id: string) => void;
}

export const ConfigList = ({ 
    configs, 
    activeConfigId, 
    onAddConfig, 
    onEditConfig, 
    onDeleteConfig 
}: ConfigListProps) => {
    const [isLoaded, setIsLoaded] = useState(false);
    
    useEffect(() => {
        setIsLoaded(true);
    }, []);

    return (
        <div className="bg-gray-50 min-h-screen pt-3 pb-6">
            <div className={`container mx-auto px-4 max-w-xl transform transition-all duration-500 ${isLoaded ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-xl font-bold text-[#1C1C1E]">订阅配置</h1>
                    <button
                        className="btn btn-sm btn-circle bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow-md border-0 hover:scale-105 transition-all duration-300"
                        onClick={onAddConfig}
                        aria-label="添加配置"
                    >
                        <Plus className="size-4" /> 
                    </button>
                </div>
                
                {configs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-60 bg-white rounded-xl shadow-sm p-6 transform transition-all duration-300 hover:shadow-md">
                        <div className="p-3 bg-blue-50 rounded-full mb-3">
                            <Link size={28} className="text-blue-500" />
                        </div>
                        <p className="text-base font-semibold text-[#1C1C1E] mt-1">暂无订阅配置</p>
                        <p className="text-[#8E8E93] text-sm text-center mt-1 mb-4 max-w-sm">
                            添加您的第一个订阅配置开始体验
                        </p>
                        <button
                            className="btn btn-sm bg-blue-500 hover:bg-blue-600 text-white border-none px-4 transition-all duration-300 hover:scale-105 shadow-sm hover:shadow-md gap-1 rounded-lg"
                            onClick={onAddConfig}
                        >
                            <Plus size={16} />
                            添加配置
                        </button>
                    </div>
                ) : (
                    <>
                        <h2 className="text-sm font-medium text-[#8E8E93] mb-2">全部配置</h2>
                        <div className="grid grid-cols-1  gap-4 mb-6">
                            {configs.map((config, index) => (
                                <div 
                                    key={config.id} 
                                    className={`transition-all duration-300 transform ${isLoaded ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`} 
                                    style={{ transitionDelay: `${index * 50}ms` }}
                                >
                                    <ConfigItem 
                                        config={config} 
                                        onEdit={onEditConfig} 
                                        onDelete={onDeleteConfig} 
                                        isActive={config.id === activeConfigId}
                                    />
                                </div>
                            ))}
                            
                            <div 
                                className="bg-white rounded-lg shadow-sm hover:shadow-md flex flex-col items-center justify-center p-4 h-[120px] transition-all duration-300 cursor-pointer border border-gray-100"
                                onClick={onAddConfig}
                            >
                                <div className="p-2 bg-blue-50 rounded-full mb-2">
                                    <Plus size={18} className="text-blue-500" />
                                </div>
                                <p className="text-blue-500 font-medium text-sm">添加新配置</p>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
