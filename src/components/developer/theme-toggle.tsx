import { useState } from 'react';
import { CircleHalf, Moon, Sun } from 'react-bootstrap-icons';
import { ThemePref, useTheme } from '../../hooks/useTheme';
import { t } from '../../utils/helper';
import { SettingsModal } from '../common/settings-modal';
import { RadioOption, RadioOptionList } from '../common/radio-option-list';
import { SettingItem } from './common';

// Three-state Appearance picker. Mirrors iOS Settings → Display & Brightness:
// a tappable row exposing System / Light / Dark. A plain toggle wouldn't
// express the "follow system" state — once flipped it pins to an explicit
// value and the app stops responding to OS prefers-color-scheme changes.
// This row always lets users return to the follow-system contract.
export default function ThemeToggle() {
    const { pref, setPref } = useTheme();
    const [open, setOpen] = useState(false);

    const iconFor = (p: ThemePref) => {
        // systemIndigo matches the rest of the dev-page generic option
        // colour, so Appearance reads as "one of the dev tools" rather
        // than a special-cased row.
        switch (p) {
            case 'light': return <Sun className="text-[#5856D6]" size={22} />;
            case 'dark': return <Moon className="text-[#5856D6]" size={22} />;
            default: return <CircleHalf className="text-[#5856D6]" size={22} />;
        }
    };

    const options: RadioOption<ThemePref>[] = [
        { key: 'system', label: t('theme_system') },
        { key: 'light', label: t('theme_light') },
        { key: 'dark', label: t('theme_dark') },
    ];

    return (
        <>
            <SettingItem
                icon={iconFor(pref)}
                title={t('appearance')}
                subTitle={t('appearance_desc')}
                badge={<span>{t(`theme_${pref}`)}</span>}
                onPress={() => setOpen(true)}
            />
            <SettingsModal
                isOpen={open}
                onClose={() => setOpen(false)}
                title={t('appearance')}
            >
                <RadioOptionList
                    value={pref}
                    onChange={(v) => {
                        setPref(v);
                        setOpen(false);
                    }}
                    options={options}
                />
            </SettingsModal>
        </>
    );
}
