import { useEffect, useState } from "react";
import { Save, Tools, X } from "react-bootstrap-icons";
import { toast } from "sonner";
import { t } from "../../utils/helper";
import { SettingItem } from "../settings/common";

const UA_OPTIONS = [
    {
        key: "default",
        label: t("ua_option_default", "default"),
        value: "default"
    },
    {
        key: "sfm_1_12",
        label: t("ua_option_sfm_1_12", "sfm 1.12"),
        value: "SFM/1.12.9 (Build 1; sing-box 1.12.12; language zh_CN)"
    },
    {
        key: "sfa_1_12",
        label: t("ua_option_sfa_1_12", "sfa 1.12"),
        value: "SFA/1.12.9 (Build 1; sing-box 1.12.12; language zh_CN)"
    },
    {
        key: "sfi_1_12",
        label: t("ua_option_sfi_1_12", "sfi 1.12"),
        value: "SFI/1.12.9 (Build 1; sing-box 1.12.12; language zh_CN)"
    },
    {
        key: "custom",
        label: t("ua_option_custom", "custom"),
        value: ""
    }
];

import { getUserAgent, setUserAgent } from "../../single/store";

export default function UASettingsItem() {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedUA, setSelectedUA] = useState("default");
    const [customUA, setCustomUA] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadUA();
        }
    }, [isOpen]);

    const loadUA = async () => {
        const ua = await getUserAgent();
        const option = UA_OPTIONS.find(opt => opt.value === ua);
        if (option) {
            setSelectedUA(option.key);
        } else {
            setSelectedUA("custom");
            setCustomUA(ua);
        }
    };

    const handleOpen = () => {
        setIsOpen(true);
    };

    const handleClose = () => {
        setIsOpen(false);
    };

    const handleSave = async () => {
        setIsLoading(true);
        try {
            const uaValue = selectedUA === "custom"
                ? customUA
                : UA_OPTIONS.find(opt => opt.key === selectedUA)?.value || "default";

            if (selectedUA === "custom" && !customUA.trim()) {
                toast.error(t("ua_cannot_empty", "User Agent cannot be empty"));
                return;
            }

            await setUserAgent(uaValue);
            toast.success(t("ua_saved", "User Agent settings saved successfully"));
            handleClose();
        } catch (error) {
            toast.error(t("ua_save_failed", "Failed to save User Agent settings"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <SettingItem
                icon={<Tools className="w-5 h-5 text-gray-500" />}
                title={t("user_agent_settings", "User Agent Settings")}
                subTitle={t("open_user_agent", "Open user agent settings")}
                disabled={false}
                onPress={handleOpen}
            />

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                    <div
                        className="absolute inset-0 bg-gray-400/60"
                        onClick={handleClose}
                    />

                    <div className="relative bg-white rounded-lg p-3 w-80 max-w-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Tools size={14} className="text-gray-500" />
                                <h3 className="text-xs font-medium text-gray-700">
                                    {t("user_agent_settings", "User Agent Settings")}
                                </h3>
                            </div>
                            <button
                                onClick={handleClose}
                                className="hover:bg-gray-100 rounded p-1 transition-colors"
                            >
                                <X size={14} className="text-gray-500" />
                            </button>
                        </div>

                        <div className="flex flex-col gap-6">
                            <div>
                                <select
                                    className="select select-sm  select-ghost border-[0.8px] border-gray-200 "

                                    value={selectedUA}
                                    onChange={(e) => setSelectedUA(e.target.value)}
                                >
                                    {UA_OPTIONS.map(option => (
                                        <option key={option.key} value={option.key}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>

                                {selectedUA === "custom" && (
                                    <input
                                        type="text"
                                        className="w-full px-3 py-2  mt-6 text-xs rounded border border-gray-300 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 outline-none transition-colors "
                                        placeholder={t("custom_ua_placeholder", "Enter custom User Agent")}
                                        value={customUA}
                                        onChange={(e) => setCustomUA(e.target.value)}
                                    />
                                )}

                                <p className="text-xs text-gray-500 mt-2">
                                    {t("ua_hint", "Select or enter a custom User Agent for requests")}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                className="px-3 py-1 text-xs rounded bg-transparent hover:bg-gray-100 text-gray-600 transition-colors"
                                onClick={handleClose}
                            >
                                {t("cancel", "Cancel")}
                            </button>
                            <button
                                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-gray-600 text-white hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                                onClick={handleSave}
                                disabled={isLoading}
                            >
                                <Save size={14} />
                                {isLoading ? t("saving", "Saving...") : t("save", "Save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}