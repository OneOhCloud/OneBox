import { platform } from '@tauri-apps/plugin-os';
import { useEffect, useState } from "react";
import { Ethernet } from "react-bootstrap-icons";
import { getStoreValue, setStoreValue } from "../../single/store";
import { TUN_STACK_STORE_KEY } from '../../types/definition';
import { t } from "../../utils/helper";
import { SettingItem } from "./common";

type TunStackType = "system" | "gvisor" | "mixed";

export default function TunStackSetting() {
    const isMacOS = platform() === "macos";
    const defaultStack: TunStackType = isMacOS ? "gvisor" : "system";
    const [tunStack, setTunStack] = useState<TunStackType>(defaultStack);
    const [selectedStack, setSelectedStack] = useState<TunStackType>(defaultStack);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: TunStackType = await getStoreValue(TUN_STACK_STORE_KEY, defaultStack);
                if (isMacOS && state !== "gvisor") {
                    // 在 macOS 上强制使用 gvisor
                    await setStoreValue(TUN_STACK_STORE_KEY, "gvisor");
                    setTunStack("gvisor");
                    setSelectedStack("gvisor");
                } else {
                    setTunStack(state);
                    setSelectedStack(state);
                }
            } catch (error) {
                console.warn("Error loading tun stack state, using system default.");
                if (isMacOS) {
                    setTunStack("gvisor");
                    setSelectedStack("gvisor");
                }
            }
        };

        loadState();
    }, []);

    const handleSave = async () => {
        try {
            // 在 macOS 上阻止保存非 gvisor 的选项
            const valueToSave = isMacOS ? "gvisor" : selectedStack;
            await setStoreValue(TUN_STACK_STORE_KEY, valueToSave);
            setTunStack(valueToSave);
            setModalOpen(false);
        } catch (error) {
            console.error("Failed to save tun stack:", error);
        }
    };

    return (
        <>
            <SettingItem
                icon={<Ethernet className="text-[#34C759]" size={22} />}
                title={t("tun_stack")}
                badge={<span className="mx-2 text-sm">{t(`${tunStack}_stack`)}</span>}
                subTitle={t("tun_stack_desc")}
                onPress={() => {
                    if (!isMacOS) {
                        setModalOpen(true);
                        setSelectedStack(tunStack);
                    }
                }}
                disabled={isMacOS}
            />

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                    <div className="bg-white dark:bg-[#2C2C2E] p-6 rounded-xl w-80 max-w-md shadow-xl border border-gray-200 dark:border-[#3A3A3C]">
                        <h3 className="text-center text-lg font-medium mb-4 dark:text-white">{t("select_tun_stack")}</h3>

                        <div className="bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-xl overflow-hidden mb-6">
                            <label className="flex items-center px-4 py-3 cursor-pointer border-b border-gray-200 dark:border-[#3A3A3C]">
                                <div className={`flex-1 dark:text-white ${isMacOS ? "text-gray-400 dark:text-gray-500" : ""}`}>{t("system_stack")}</div>
                                <input
                                    type="radio"
                                    name="tun-stack"
                                    className="appearance-none w-5 h-5 rounded-full border-2 border-[#007AFF] checked:bg-[#007AFF] checked:border-[#007AFF] relative
                                    before:content-[''] before:absolute before:w-2 before:h-2 before:bg-white before:rounded-full before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100 disabled:opacity-50 disabled:border-gray-400 disabled:cursor-not-allowed"
                                    checked={selectedStack === "system"}
                                    onChange={() => setSelectedStack("system")}
                                    disabled={isMacOS}
                                />
                            </label>

                            <label className="flex items-center px-4 py-3 cursor-pointer border-b border-gray-200 dark:border-[#3A3A3C]">
                                <div className="flex-1 dark:text-white">{t("gvisor_stack")}</div>
                                <input
                                    type="radio"
                                    name="tun-stack"
                                    className="appearance-none w-5 h-5 rounded-full border-2 border-[#007AFF] checked:bg-[#007AFF] checked:border-[#007AFF] relative
                                    before:content-[''] before:absolute before:w-2 before:h-2 before:bg-white before:rounded-full before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100"
                                    checked={selectedStack === "gvisor"}
                                    onChange={() => setSelectedStack("gvisor")}
                                />
                            </label>

                            <label className="flex items-center px-4 py-3 cursor-pointer">
                                <div className={`flex-1 dark:text-white ${isMacOS ? "text-gray-400 dark:text-gray-500" : ""}`}>{t("mixed_stack")}</div>
                                <input
                                    type="radio"
                                    name="tun-stack"
                                    className="appearance-none w-5 h-5 rounded-full border-2 border-[#007AFF] checked:bg-[#007AFF] checked:border-[#007AFF] relative
                                    before:content-[''] before:absolute before:w-2 before:h-2 before:bg-white before:rounded-full before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100 disabled:opacity-50 disabled:border-gray-400 disabled:cursor-not-allowed"
                                    checked={selectedStack === "mixed"}
                                    onChange={() => setSelectedStack("mixed")}
                                    disabled={isMacOS}
                                />
                            </label>
                        </div>

                        <div className="flex justify-between gap-4">
                            <button
                                className="flex-1 py-2.5 rounded-full text-[#007AFF] font-medium hover:bg-[#F2F2F7] dark:hover:bg-[#3A3A3C] transition-colors"
                                onClick={() => setModalOpen(false)}
                            >
                                {t("cancel")}
                            </button>
                            <button
                                className="flex-1 py-2.5 rounded-full bg-[#007AFF] text-white font-medium hover:bg-[#0071EB] transition-colors"
                                onClick={handleSave}
                            >
                                {t("confirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
