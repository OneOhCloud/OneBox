import { Pencil, Trash } from 'react-bootstrap-icons';
import { SubscriptionConfig } from '../../types/SubscriptionConfig';

interface ConfigItemProps {
    config: SubscriptionConfig;
    onEdit: (config: SubscriptionConfig) => void;
    onDelete: (id: string) => void;
}

export const ConfigItem = ({ config, onEdit, onDelete }: ConfigItemProps) => (
    <div className="divide-y divide-gray-100">
        <div className="flex items-center justify-between p-4 group active:bg-gray-100 cursor-pointer transition-colors">
            <div className="flex-1" onClick={() => onEdit(config)}>
                <div className="flex items-center justify-between">
                    <div className='text-[#1C1C1E] font-medium'>{config.name}</div>
                    <div className="flex invisible group-hover:visible items-center">
                        <button
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors mr-1"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(config);
                            }}
                            title="编辑"
                        >
                            <Pencil className="text-[#007AFF]" size={16} />
                        </button>
                        <button
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(config.id);
                            }}
                            title="删除"
                        >
                            <Trash className="text-[#FF3B30]" size={16} />
                        </button>
                    </div>
                </div>
                <div className="text-xs text-[#8E8E93] truncate mt-1">{config.url}</div>
                <div className="flex justify-between text-xs text-[#8E8E93] mt-1">
                    <div>自动更新: {config.updateInterval} 分钟</div>
                    <div>过期时间: {config.expires ? new Date(config.expires).toLocaleString() : '-'}</div>
                </div>
            </div>
        </div>
    </div>
);
