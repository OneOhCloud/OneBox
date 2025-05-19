import { emit } from '@tauri-apps/api/event';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Globe } from "react-bootstrap-icons";
import { NavContext } from '../../single/context';
import { getLanguage, setLanguage } from '../../single/store';
import { t, updateLanguage } from '../../utils/helper';
import { ToggleSetting } from "./common";

export default function LanguageSwitch() {
    const [isZh, setIsZh] = useState(false);

    const { handleLanguageChange } = useContext(NavContext);

    // 初始化时加载语言设置
    useEffect(() => {
        const loadLanguageSetting = async () => {
            const language = await getLanguage();
            setIsZh(language === 'zh');
        };
        loadLanguageSetting();

    }, []);

    // 切换语言
    const handleToggle = useCallback(async () => {
        const newValue = !isZh;
        setIsZh(newValue);
        await setLanguage(newValue ? 'zh' : 'en');
        await updateLanguage();
        // zh: 提交这个事件是为了更新托盘菜单语言
        // en: This event is submitted to update the tray menu language
        emit('status-changed');
        handleLanguageChange(newValue ? 'zh' : 'en');
        // setActiveScreen('home');
    }, [isZh]);

    return (
        <ToggleSetting
            icon={<Globe className="text-[#5856D6] " size={22} />}
            title={t('language')}
            subTitle={t('language_description')}
            isEnabled={isZh}
            onToggle={handleToggle}
        />
    );
}