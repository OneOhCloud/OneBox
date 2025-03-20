import { SubscriptionConfig } from '../../types/SubscriptionConfig';

interface ConfigItemProps {
    config: SubscriptionConfig;
    onEdit: (config: SubscriptionConfig) => void;
    onDelete: (id: string) => void;
    isActive?: boolean; // 新增属性，表示该配置是否正在使用
}

export const ConfigItem = ({ config, onEdit, onDelete, isActive = false }: ConfigItemProps) => {
    // 生成随机浅色背景
    const colors = ['bg-blue-50', 'bg-indigo-50', 'bg-purple-50', 'bg-pink-50', 'bg-green-50'];
    const iconColors = ['text-blue-500', 'text-indigo-500', 'text-purple-500', 'text-pink-500', 'text-green-500'];

    const colorIndex = config.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    const bgColor = colors[colorIndex];
    const iconColor = iconColors[colorIndex];

    // 格式化剩余流量显示
    const formatDataUsage = (used: number, total: number) => {
        if (!total) return '无流量限制';

        const units = ['KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let usedFormatted = used || 0;
        let totalFormatted = total || 0;

        while (totalFormatted >= 1024 && unitIndex < units.length - 1) {
            usedFormatted /= 1024;
            totalFormatted /= 1024;
            unitIndex++;
        }

        return `${usedFormatted.toFixed(1)}/${totalFormatted.toFixed(1)} ${units[unitIndex]}`;
    };

    // 从配置中获取或模拟数据
    const lastUpdated = config.lastUpdated ? new Date(config.lastUpdated) : null;
    const expiry = config.expires ? new Date(config.expires) : null;
    const dataUsed = config.dataUsed || 0;
    const dataTotal = config.dataTotal || 0;

    return (

        <div
            onClick={() => onEdit(config)}
        className={`card bg-base-100  cursor-pointer card-xs   ${isActive ? 'border-1 border-blue-200' : 'border-1 border-blue-50'}`}>

            <div className="card-body">
                <h2 className={`card-title ${isActive ? 'text-blue-500' : ''}`}>
                    {config.name}
                </h2>
                <div className="justify-end card-actions">
                    <button>
                        1
                    </button>
                </div>
            </div>
        </div>

    );
};
