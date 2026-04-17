import { platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { Ethernet } from "react-bootstrap-icons";
import { getStoreValue, setStoreValue } from "../../single/store";
import { TUN_STACK_STORE_KEY } from "../../types/definition";
import { t } from "../../utils/helper";
import {
    RadioOption,
    RadioOptionList,
} from "../common/radio-option-list";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "./common";

type TunStackType = "system" | "gvisor" | "mixed";

const GvisorUnsupportedPlatforms: string[] = [
    // macOS 平台不支持 system stack
    "macos",
];

export default function TunStackSetting() {
    const [isSystemTunUnsupported, setIsSystemTunUnsupported] = useState(false);
    const defaultStack: TunStackType = isSystemTunUnsupported
        ? "gvisor"
        : "system";
    const [tunStack, setTunStack] = useState<TunStackType>(defaultStack);
    const [selectedStack, setSelectedStack] =
        useState<TunStackType>(defaultStack);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        setIsSystemTunUnsupported(
            GvisorUnsupportedPlatforms.includes(platform()),
        );
    }, []);

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: TunStackType = await getStoreValue(
                    TUN_STACK_STORE_KEY,
                    defaultStack,
                );
                if (isSystemTunUnsupported && state !== "gvisor") {
                    await setStoreValue(TUN_STACK_STORE_KEY, "gvisor");
                    setTunStack("gvisor");
                    setSelectedStack("gvisor");
                } else {
                    setTunStack(state);
                    setSelectedStack(state);
                }
            } catch {
                console.warn(
                    "Error loading tun stack state, using system default.",
                );
                if (isSystemTunUnsupported) {
                    setTunStack("gvisor");
                    setSelectedStack("gvisor");
                }
            }
        };
        loadState();
    }, []);

    const handleSave = async () => {
        try {
            const valueToSave = isSystemTunUnsupported
                ? "gvisor"
                : selectedStack;
            await setStoreValue(TUN_STACK_STORE_KEY, valueToSave);
            setTunStack(valueToSave);
            setModalOpen(false);
        } catch (error) {
            console.error("Failed to save tun stack:", error);
        }
    };

    if (isSystemTunUnsupported) return null;

    const options: RadioOption<TunStackType>[] = [
        {
            key: "system",
            label: t("system_stack"),
            disabled: isSystemTunUnsupported,
        },
        { key: "gvisor", label: t("gvisor_stack") },
        {
            key: "mixed",
            label: t("mixed_stack"),
            disabled: isSystemTunUnsupported,
        },
    ];

    return (
        <>
            <SettingItem
                icon={<Ethernet className="text-[#34C759]" size={22} />}
                title={t("tun_stack")}
                badge={<span>{t(`${tunStack}_stack`)}</span>}
                subTitle={t("tun_stack_desc")}
                onPress={() => {
                    setModalOpen(true);
                    setSelectedStack(tunStack);
                }}
                disabled={isSystemTunUnsupported}
            />

            <SettingsModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={t("select_tun_stack")}
                confirmLabel={t("confirm")}
                onConfirm={handleSave}
            >
                <RadioOptionList
                    value={selectedStack}
                    onChange={setSelectedStack}
                    options={options}
                />
            </SettingsModal>
        </>
    );
}
