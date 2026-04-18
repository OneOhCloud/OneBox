import { useEffect, useState } from "react";
import { Tools } from "react-bootstrap-icons";
import { toast } from "sonner";
import { getUserAgent, setUserAgent } from "../../single/store";
import { t } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import {
    RadioOption,
    RadioOptionList,
} from "../common/radio-option-list";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "../settings/common";

type UAKey = "default" | "sfm_1_12" | "sfa_1_12" | "sfi_1_12" | "custom";

const UA_OPTIONS: { key: UAKey; label: string; value: string }[] = [
    {
        key: "default",
        label: t("ua_option_default", "default"),
        value: "default",
    },
    {
        key: "sfm_1_12",
        label: t("ua_option_sfm_1_12", "sfm 1.12"),
        value: "SFM/1.12.9 (Build 1; sing-box 1.12.12; language zh_CN)",
    },
    {
        key: "sfa_1_12",
        label: t("ua_option_sfa_1_12", "sfa 1.12"),
        value: "SFA/1.12.9 (Build 1; sing-box 1.12.12; language zh_CN)",
    },
    {
        key: "sfi_1_12",
        label: t("ua_option_sfi_1_12", "sfi 1.12"),
        value: "SFI/1.12.9 (Build 1; sing-box 1.12.12; language zh_CN)",
    },
    {
        key: "custom",
        label: t("ua_option_custom", "custom"),
        value: "",
    },
];

export default function UASettingsItem() {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedUA, setSelectedUA] = useState<UAKey>("default");
    const [customUA, setCustomUA] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) loadUA();
    }, [isOpen]);

    const loadUA = async () => {
        const ua = await getUserAgent();
        const option = UA_OPTIONS.find((opt) => opt.value === ua);
        if (option) {
            setSelectedUA(option.key);
        } else {
            setSelectedUA("custom");
            setCustomUA(ua);
        }
    };

    const handleSave = async () => {
        if (selectedUA === "custom" && !customUA.trim()) {
            toast.error(t("ua_cannot_empty", "User Agent cannot be empty"));
            return;
        }
        setIsLoading(true);
        try {
            const uaValue =
                selectedUA === "custom"
                    ? customUA
                    : UA_OPTIONS.find((opt) => opt.key === selectedUA)?.value ??
                      "default";
            await setUserAgent(uaValue);
            toast.success(t("ua_saved", "User Agent settings saved successfully"));
            setIsOpen(false);
        } catch {
            toast.error(t("ua_save_failed", "Failed to save User Agent settings"));
        } finally {
            setIsLoading(false);
        }
    };

    const radioOptions: RadioOption<UAKey>[] = UA_OPTIONS.map((o) => ({
        key: o.key,
        label: o.label,
        sublabel: o.key !== "default" && o.key !== "custom" ? o.value : undefined,
    }));

    return (
        <>
            <SettingItem
                icon={<Tools className="w-5 h-5" style={{ color: 'var(--onebox-label-secondary)' }} />}
                title={t("user_agent_settings", "User Agent Settings")}
                subTitle={t("open_user_agent", "Open user agent settings")}
                onPress={() => setIsOpen(true)}
            />
            <SettingsModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                title={t("user_agent_settings", "User Agent Settings")}
                confirmLabel={t("save")}
                onConfirm={handleSave}
                confirmLoading={isLoading}
            >
                <div className="space-y-3">
                    <RadioOptionList
                        value={selectedUA}
                        onChange={setSelectedUA}
                        options={radioOptions}
                    />
                    {selectedUA === "custom" && (
                        <IOSTextField
                            value={customUA}
                            onChange={setCustomUA}
                            placeholder={t(
                                "custom_ua_placeholder",
                                "Enter custom User Agent",
                            )}
                            monospace
                        />
                    )}
                    <p
                        className="text-[11px] ml-1 leading-snug"
                        style={{ color: "var(--onebox-label-secondary)" }}
                    >
                        {t(
                            "ua_hint",
                            "Select or enter a custom User Agent for requests",
                        )}
                    </p>
                </div>
            </SettingsModal>
        </>
    );
}
