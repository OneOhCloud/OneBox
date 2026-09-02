import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect, useState } from 'react';
import { LightningCharge, Power } from "react-bootstrap-icons";
import { toast } from 'sonner';
import { getAutoConnect, setAutoConnect } from "../../single/store";
import { t } from "../../utils/helper";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem, ToggleSetting } from "./common";

/**
 * Both launch-time behaviours live in one sheet so the settings list carries a
 * single startup entry. They stay independent switches — connect on launch
 * applies to every launch, not just the login item — and apply immediately,
 * because neither write is expensive enough to justify a staged Save.
 */
export default function AutoStartSetting() {
    const [isOpen, setIsOpen] = useState(false);
    const [autoStart, setAutoStart] = useState(false);
    const [autoConnect, setAutoConnectState] = useState(false);

    const loadState = async () => {
        try {
            // Autostart state lives in the OS, not the store, so it can change
            // behind our back — re-read it every time the sheet opens.
            setAutoStart(await isEnabled());
        } catch (error) {
            console.error("检查自动启动状态失败:", error);
            toast.error(t("auto_start_failed"));
        }
        try {
            setAutoConnectState(await getAutoConnect());
        } catch (error) {
            console.error("Failed to load auto connect state:", error);
        }
    };

    useEffect(() => {
        loadState();
    }, []);

    useEffect(() => {
        if (isOpen) loadState();
    }, [isOpen]);

    const handleToggleAutoStart = async () => {
        const next = !autoStart;
        setAutoStart(next);
        try {
            await (next ? enable() : disable());
        } catch (error) {
            setAutoStart(!next);
            console.error("切换自动启动设置失败:", error);
            toast.error(t("auto_start_failed_1"));
        }
    };

    const handleToggleAutoConnect = async () => {
        const next = !autoConnect;
        setAutoConnectState(next);
        try {
            await setAutoConnect(next);
        } catch (error) {
            setAutoConnectState(!next);
            console.error("Failed to save auto connect state:", error);
            toast.error(t("auto_connect_failed"));
        }
    };

    return (
        <>
            <SettingItem
                icon={<Power className="text-[#FF9500]" size={22} />}
                title={t("auto_start")}
                subTitle={t("auto_start_desc")}
                badge={autoStart ? t("on") : t("off")}
                onPress={() => setIsOpen(true)}
            />
            <SettingsModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                title={t("auto_start")}
            >
                <div className="onebox-grouped-list">
                    <ToggleSetting
                        icon={<Power className="text-[#FF9500]" size={22} />}
                        title={t("auto_start")}
                        subTitle={t("auto_start_desc")}
                        isEnabled={autoStart}
                        onToggle={handleToggleAutoStart}
                    />
                    <ToggleSetting
                        icon={<LightningCharge className="text-[#FF9500]" size={22} />}
                        title={t("auto_connect")}
                        subTitle={t("auto_connect_desc")}
                        isEnabled={autoConnect}
                        onToggle={handleToggleAutoConnect}
                    />
                </div>
            </SettingsModal>
        </>
    );
}
