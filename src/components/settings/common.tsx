import { ChevronRight } from 'react-bootstrap-icons';

interface SettingItemProps {
    icon: React.ReactNode;
    title: string;
    subTitle?: string;
    badge?: string | React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
}

interface ToggleSettingProps {
    icon: React.ReactNode;
    title: string;
    subTitle?: string;
    isEnabled: boolean;
    onToggle: () => void;
}

// iOS Settings row. 52px minimum height (Apple HIG minimum touch target).
// Icon column is a fixed 28px tile to align multi-row cells vertically.
// Hover/active states use Apple tinted-label colours, not Tailwind greys.
export function SettingItem({
    icon,
    title,
    subTitle,
    badge,
    onPress = () => { },
    disabled = false,
}: SettingItemProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => { !disabled && onPress(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-[rgba(60,60,67,0.025)] active:bg-[rgba(60,60,67,0.06)]'
            }`}
        >
            <div className="size-7 flex items-center justify-center shrink-0">
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div
                    className="text-[15px] tracking-[-0.005em] truncate capitalize"
                    style={{ color: 'var(--onebox-label)' }}
                >
                    {title}
                </div>
                {subTitle && (
                    <div
                        className="text-[12px] truncate mt-0.5"
                        style={{ color: 'var(--onebox-label-secondary)' }}
                    >
                        {subTitle}
                    </div>
                )}
            </div>
            {badge && (
                <div
                    className="text-[13px] tracking-[-0.005em] shrink-0"
                    style={{ color: 'var(--onebox-label-secondary)' }}
                >
                    {badge}
                </div>
            )}
            <ChevronRight
                size={13}
                className="shrink-0"
                style={{ color: 'rgba(60, 60, 67, 0.28)' }}
            />
        </button>
    );
}

export function ToggleSetting({
    icon,
    title,
    subTitle,
    isEnabled,
    onToggle,
}: ToggleSettingProps) {
    return (
        <label className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer">
            <div className="size-7 flex items-center justify-center shrink-0">
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div
                    className="text-[15px] tracking-[-0.005em] truncate capitalize"
                    style={{ color: 'var(--onebox-label)' }}
                >
                    {title}
                </div>
                {subTitle && (
                    <div
                        className="text-[12px] truncate mt-0.5"
                        style={{ color: 'var(--onebox-label-secondary)' }}
                    >
                        {subTitle}
                    </div>
                )}
            </div>
            <input
                type="checkbox"
                className="toggle toggle-sm onebox-toggle shrink-0"
                checked={isEnabled}
                onChange={onToggle}
            />
        </label>
    );
}
