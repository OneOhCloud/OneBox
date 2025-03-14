import { Plus, Link } from 'react-bootstrap-icons';
import { ConfigItem } from './ConfigItem';
import { SubscriptionConfig } from '../../types/SubscriptionConfig';

interface ConfigListProps {
    configs: SubscriptionConfig[];
    onAddConfig: () => void;
    onEditConfig: (config: SubscriptionConfig) => void;
    onDeleteConfig: (id: string) => void;
}

export const ConfigList = ({ configs, onAddConfig, onEditConfig, onDeleteConfig }: ConfigListProps) => {
    return (
        <div className="bg-gray-50 min-h-screen pt-4">
            <div className="container mx-auto px-4 max-w-md">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-[#1C1C1E]">订阅配置</h1>
                    <button
                        className="btn   btn-ghost btn-circle hover:bg-white  border-0"
                        onClick={onAddConfig}
                    >
                        <Plus className="size-8 text-blue-500" /> 
                    </button>
                </div>

                {configs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-60 bg-white rounded-xl shadow-sm p-6">
                        <Link size={40} className="text-[#8E8E93]" />
                        <p className="mt-2 text-[#8E8E93]">暂无订阅配置</p>
                        <button
                            className="btn bg-[#007AFF] hover:bg-blue-600 text-white border-none mt-4"
                            onClick={onAddConfig}
                        >
                            添加配置
                        </button>
                    </div>
                ) : (
                    <div className="rounded-xl overflow-hidden bg-white shadow-sm mb-6">
                        {configs.map((config, index) => (
                            <div key={config.id}>
                                <ConfigItem 
                                    config={config} 
                                    onEdit={onEditConfig} 
                                    onDelete={onDeleteConfig} 
                                />
                                {index < configs.length - 1 && <div className="border-b border-gray-100"></div>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
