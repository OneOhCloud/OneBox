import { confirm } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { CloudArrowUpFill } from "react-bootstrap-icons";
import { t, vpnServiceManager } from "../../utils/helper";
import { useUpdate } from "./update-context";

/**
 * Home header capsule. Only rendered when a downloaded update is ready.
 * Tap → native confirm → stop VPN → install → relaunch.
 */
export default function UpdaterButton() {
    const { updateInfo, downloadComplete } = useUpdate();

    const handleInstall = async () => {
        if (!updateInfo || !downloadComplete) return;
        try {
            const confirmed = await confirm(t("update_downloaded"), {
                title: t("update_install"),
                kind: "info",
            });
            if (confirmed) {
                await vpnServiceManager.stop();
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await updateInfo.install();
                await relaunch();
            }
        } catch (error) {
            console.error("Installation error:", error);
        }
    };

    if (!downloadComplete || !updateInfo) return null;

    return (
        <button
            type="button"
            onClick={handleInstall}
            className="inline-flex items-center gap-1 h-[22px] px-2 rounded-full transition-all active:brightness-95"
            style={{
                background:
                    "linear-gradient(140deg, #4DA3FF 0%, #007AFF 100%)",
                color: "#FFFFFF",
                boxShadow:
                    "0 2px 6px -1px rgba(0, 122, 255, 0.4), 0 1px 2px rgba(0, 0, 0, 0.06)",
            }}
            aria-label={t("install_new_update")}
        >
            <CloudArrowUpFill size={11} />
            <span
                className="text-[10px] font-semibold tracking-[-0.005em]"
            >
                {t("update", "Update")}
            </span>
        </button>
    );
}
