import { Moon } from 'react-bootstrap-icons';
import { useTheme } from '../../hooks/useTheme';
import { t } from '../../utils/helper';
import { ToggleSetting } from './common';

// Manual light/dark toggle. When off, preference is persisted as 'light'
// (explicit override — does not fall back to system, by design: a user
// who flipped the switch off expects it to stay off regardless of the
// OS toggling into dark mode at night).
export default function ThemeToggle() {
    const { resolved, setPref } = useTheme();
    const isDark = resolved === 'dark';

    return (
        <ToggleSetting
            icon={<Moon className="w-5 h-5" style={{ color: 'var(--onebox-label-secondary)' }} />}
            title={t('dark_mode')}
            subTitle={t('dark_mode_desc')}
            isEnabled={isDark}
            onToggle={() => setPref(isDark ? 'light' : 'dark')}
        />
    );
}
