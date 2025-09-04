import {
    ChevronRight
} from 'react-bootstrap-icons';



interface SettingItemProps {
    icon: React.ReactNode;
    title: string;
    subTitle?: string;

    badge?: string | React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;

}

// 带开关的设置项接口定义
interface ToggleSettingProps {
    icon: React.ReactNode;
    title: string;
    subTitle?: string;
    isEnabled: boolean;
    onToggle: () => void;
}




// 设置项组件
export function SettingItem({
    icon,
    title,
    badge,
    onPress = () => { },
    disabled = false
}: SettingItemProps) {
    return (
        <div
            className="flex items-center justify-between p-4 hover:bg-gray-100 active:bg-gray-100 cursor-pointer transition-colors"
            onClick={() => {
                !disabled && onPress()
            }}
        >
            <div className="flex items-center">
                <div className="mr-4">{icon}</div>
                <span className="text-[#1C1C1E] capitalize">{title}</span>
            </div>
            <div className="flex items-center">
                {badge}
                <ChevronRight className="text-[#C7C7CC]" size={16} />
            </div>
        </div>
    );
}

// 带开关的设置项组件
export function ToggleSetting({
    icon,
    title,
    subTitle,
    isEnabled,
    onToggle
}: ToggleSettingProps) {


    return (
        <div className="flex items-center justify-between p-4  cursor-default transition-colors">
            <div className="flex items-center">
                <div className="mr-4">{icon}</div>
                <div>
                    <div className="text-[#1C1C1E] capitalize">{title}</div>
                    {subTitle && <div className="text-xs text-[#8E8E93]">{subTitle}</div>}
                </div>
            </div>
            <input
                type="checkbox"
                className="toggle toggle-sm	 bg-[#E9E9EB] border-[#E9E9EB] checked:text-white checked:bg-[#34C759] checked:border-[#34C759]"
                checked={isEnabled}
                onChange={onToggle}
            />
        </div>
    );
}
