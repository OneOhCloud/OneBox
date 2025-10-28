
import { useEffect, useState } from "react";
import { HddRack, Save, X } from "react-bootstrap-icons";
import { toast } from "sonner";
import { DEFAULT_SYSTEM_DNS } from "../../config/helper";
import { getDirectDNS, getUseDHCP, setDirectDNS } from "../../single/store";
import { t } from "../../utils/helper";
import { SettingItem } from "../settings/common";

export default function DNSSettingsItem() {
    const [isOpen, setIsOpen] = useState(false);
    const [dnsServers, setDnsServers] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isUseDHCP, setIsUseDHCP] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadDNS();

        }
    }, [isOpen]);

    const loadDNS = async () => {
        const dns = await getDirectDNS();
        const state: boolean = await getUseDHCP();
        setIsUseDHCP(state);
        setDnsServers(dns);
    };

    const handleOpen = () => {
        setIsOpen(true);
    };

    const handleClose = () => {
        setIsOpen(false);
    };

    const handleSave = async () => {
        if (!dnsServers.trim()) {
            toast.error(t("dns_cannot_empty", "DNS cannot be empty"));
            return;
        }
        setIsLoading(true);
        try {
            await setDirectDNS(dnsServers.trim());
            toast.success(t("dns_saved", "DNS settings saved successfully"));
            handleClose();
        } catch (error) {
            toast.error(t("dns_save_failed", "Failed to save DNS settings"));
        } finally {
            setIsLoading(false);
        }
    };

    if (isUseDHCP) {
        return <></>;
    }

    return (
        <>
            <SettingItem
                icon={<HddRack className="w-5 h-5 text-gray-500" />}
                title={t("direct_dns_settings", "Direct DNS Settings")}
                subTitle={t("open_direct_dns", "Open direct DNS settings")}
                disabled={false}
                onPress={handleOpen}
            />

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                    {/* 背景遮罩 */}
                    <div
                        className="absolute inset-0 bg-gray-400/60"
                        onClick={handleClose}
                    />

                    {/* 模态框内容 */}
                    <div className="relative bg-white rounded-lg p-3 w-80 max-w-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <HddRack size={14} className="text-gray-500" />
                                <h3 className="text-xs font-medium text-gray-700">
                                    {t("direct_dns_settings", "Direct DNS Settings")}
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
                                <input
                                    type="text"
                                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 outline-none transition-colors"
                                    placeholder={DEFAULT_SYSTEM_DNS}
                                    value={dnsServers}
                                    onChange={(e) => setDnsServers(e.target.value)}
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    {t("dns_hint", "Enter DNS server address for direct connections")}
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