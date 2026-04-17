import { useEffect, useState } from "react";
import { HddRack } from "react-bootstrap-icons";
import { toast } from "sonner";
import { getDirectDNS, getUseDHCP, setDirectDNS } from "../../single/store";
import { t } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "../settings/common";

export default function DNSSettingsItem() {
    const [isOpen, setIsOpen] = useState(false);
    const [dnsServers, setDnsServers] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isUseDHCP, setIsUseDHCP] = useState(false);

    useEffect(() => {
        if (isOpen) loadDNS();
    }, [isOpen]);

    const loadDNS = async () => {
        const dns = await getDirectDNS();
        const state: boolean = await getUseDHCP();
        setIsUseDHCP(state);
        setDnsServers(dns);
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
            setIsOpen(false);
        } catch {
            toast.error(t("dns_save_failed", "Failed to save DNS settings"));
        } finally {
            setIsLoading(false);
        }
    };

    if (isUseDHCP) return null;

    return (
        <>
            <SettingItem
                icon={<HddRack className="w-5 h-5 text-gray-500" />}
                title={t("direct_dns_settings", "Direct DNS Settings")}
                subTitle={t("open_direct_dns", "Open direct DNS settings")}
                onPress={() => setIsOpen(true)}
            />
            <SettingsModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                title={t("direct_dns_settings", "Direct DNS Settings")}
                confirmLabel={t("save")}
                onConfirm={handleSave}
                confirmDisabled={!dnsServers.trim()}
                confirmLoading={isLoading}
            >
                <IOSTextField
                    value={dnsServers}
                    onChange={setDnsServers}
                    placeholder="119.29.29.29"
                    monospace
                    autoFocus
                />
                <p
                    className="text-[11px] mt-2 ml-1 leading-snug"
                    style={{ color: "var(--onebox-label-secondary)" }}
                >
                    {t(
                        "dns_hint",
                        "Enter DNS server address for direct connections",
                    )}
                </p>
            </SettingsModal>
        </>
    );
}
