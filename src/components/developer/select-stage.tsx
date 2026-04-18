import { useEffect, useState } from "react";
import { Git } from "react-bootstrap-icons";
import { StageVersionType } from "../../config/common";
import { useUpdate } from "../../components/settings/update-context";
import { getStoreValue, setStoreValue } from "../../single/store";
import { STAGE_VERSION_STORE_KEY } from "../../types/definition";
import { t } from "../../utils/helper";
import {
    RadioOption,
    RadioOptionList,
} from "../common/radio-option-list";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "./common";

export default function StageSetting() {
    const [stageVersion, setStageVersion] = useState<StageVersionType>("stable");
    const [selectedVersion, setSelectedVersion] =
        useState<StageVersionType>("stable");
    const [modalOpen, setModalOpen] = useState(false);
    const [allowDev, setAllowDev] = useState(false);
    const { triggerImmediateCheck } = useUpdate();

    const handleSave = async () => {
        try {
            await setStoreValue(STAGE_VERSION_STORE_KEY, selectedVersion);
            const channelChanged = selectedVersion !== stageVersion;
            setStageVersion(selectedVersion);
            setModalOpen(false);
            if (channelChanged) {
                triggerImmediateCheck();
            }
        } catch (error) {
            console.error("Failed to save stage version:", error);
        }
    };

    useEffect(() => {
        const loadState = async () => {
            try {
                const state: StageVersionType = await getStoreValue(
                    STAGE_VERSION_STORE_KEY,
                    "stable",
                );
                setStageVersion(state);
                setSelectedVersion(state);
            } catch (error) {
                console.warn(
                    "Error loading developer toggle state, defaulting to false.",
                );
            }
        };
        loadState();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            setAllowDev(localStorage.getItem("allowDev") === "true");
        }, 500);
        return () => clearInterval(interval);
    }, []);

    const options: RadioOption<StageVersionType>[] = [
        { key: "stable", label: t("stable_version") },
        { key: "beta", label: t("beta_version") },
        ...(allowDev
            ? [{ key: "dev" as StageVersionType, label: t("dev_version") }]
            : []),
    ];

    return (
        <>
            <SettingItem
                icon={<Git className="w-5 h-5" style={{ color: 'var(--onebox-label-secondary)' }} />}
                title={t("update_stage")}
                badge={<span>{t(`${stageVersion}_version`)}</span>}
                subTitle={t("update_stage_desc")}
                onPress={() => {
                    setModalOpen(true);
                    setSelectedVersion(stageVersion);
                }}
            />

            <SettingsModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={t("update_stage")}
                confirmLabel={t("confirm")}
                onConfirm={handleSave}
            >
                <div className="space-y-3">
                    <RadioOptionList
                        value={selectedVersion}
                        onChange={setSelectedVersion}
                        options={options}
                    />
                    {!allowDev && (
                        <p
                            className="text-[11px] text-center leading-snug px-1"
                            style={{
                                color: "var(--onebox-label-tertiary)",
                            }}
                        >
                            Set <code className="font-mono">allowDev=true</code>{" "}
                            in localStorage to enable developer version.
                        </p>
                    )}
                </div>
            </SettingsModal>
        </>
    );
}
