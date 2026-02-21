import { useEffect, useState } from "react";
import { Git } from "react-bootstrap-icons";
import { StageVersionType } from "../../config/common";
import { getStoreValue, setStoreValue } from "../../single/store";
import { STAGE_VERSION_STORE_KEY } from "../../types/definition";
import { t } from "../../utils/helper";
import { SettingItem } from "./common";



export default function StageSetting() {
    const [stageVersion, setStageVersion] = useState<StageVersionType>("stable");
    const [selectedVersion, setSelectedVersion] = useState<StageVersionType>("stable");
    const [modalOpen, setModalOpen] = useState(false);
    const [allowDev, setAllowDev] = useState(false);


    const handleSave = async () => {
        try {
            await setStoreValue(STAGE_VERSION_STORE_KEY, selectedVersion);
            setStageVersion(selectedVersion);
            setModalOpen(false);
        } catch (error) {
            console.error("Failed to save stage version:", error);
        }
    };

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: StageVersionType = await getStoreValue(STAGE_VERSION_STORE_KEY, "stable");
                setStageVersion(state);
                setSelectedVersion(state);
            } catch (error) {
                console.warn("Error loading developer toggle state, defaulting to false.");
            }
        };

        loadState();
    }, []);

    useEffect(() => {
        let interval = setInterval(() => {
            setAllowDev(localStorage.getItem("allowDev") === "true");
        }, 500);
        return () => clearInterval(interval);
    }, []);

    return (
        <>
            <SettingItem
                icon={<Git className="w-5 h-5 text-gray-500" />}
                title={t("update_stage")}
                badge={<span className="mx-2 text-sm">{t(`${stageVersion}_version`)}</span>}
                subTitle={t("update_stage_desc")}
                onPress={() => {
                    setModalOpen(true);
                    setSelectedVersion(stageVersion);
                }}
                disabled={false}
            />

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm h-[100.2dvh]">
                    <div className="flex flex-col justify-between bg-white  p-6 rounded-xl w-[95dvw] min-h-76 max-w-md shadow-xl border border-gray-200 ">
                        <h3 className="text-center text-lg font-medium mb-4 dark:text-white">{t("")}</h3>

                        <div className="bg-[#F2F2F7]  rounded-xl overflow-hidden ">
                            <label className="flex items-center px-4 py-3 cursor-pointer border-b border-gray-200 ">
                                <div className="flex-1 dark:text-white">{t("stable_version")}</div>
                                <input
                                    type="radio"
                                    name="stage-version"
                                    className="appearance-none w-5 h-5 rounded-full border-2 border-[#007AFF] checked:bg-[#007AFF] checked:border-[#007AFF] relative
                                    before:content-[''] before:absolute before:w-2 before:h-2 before:bg-white before:rounded-full before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100"
                                    checked={selectedVersion === "stable"}
                                    onChange={() => setSelectedVersion("stable")}
                                />
                            </label>

                            <label className="flex items-center px-4 py-3 cursor-pointer border-b border-gray-200 ">
                                <div className="flex-1 dark:text-white">{t("beta_version")}</div>
                                <input
                                    type="radio"
                                    name="stage-version"
                                    className="appearance-none w-5 h-5 rounded-full border-2 border-[#007AFF] checked:bg-[#007AFF] checked:border-[#007AFF] relative
                                    before:content-[''] before:absolute before:w-2 before:h-2 before:bg-white before:rounded-full before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100"
                                    checked={selectedVersion === "beta"}
                                    onChange={() => setSelectedVersion("beta")}
                                />
                            </label>

                            {allowDev && (
                                <label className="flex items-center px-4 py-3 cursor-pointer">
                                    <div className="flex-1 dark:text-white">{t("dev_version")}</div>
                                    <input
                                        type="radio"
                                        name="stage-version"
                                        className="appearance-none w-5 h-5 rounded-full border-2 border-[#007AFF] checked:bg-[#007AFF] checked:border-[#007AFF] relative
                                    before:content-[''] before:absolute before:w-2 before:h-2 before:bg-white before:rounded-full before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-0 checked:before:opacity-100"
                                        checked={selectedVersion === "dev"}
                                        onChange={() => setSelectedVersion("dev")}
                                    />
                                </label>
                            )}
                        </div>

                        {
                            !allowDev ? (
                                <div className=" p-3 text-xs font-medium text-gray-500/90 bg-gray-50/50 rounded-lg ">
                                    <span className="text-center">Set "allowDev" to true in localStorage to enable developer version</span>
                                </div>
                            ) : <div className="py-6"></div>
                        }

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
    )
}