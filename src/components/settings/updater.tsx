import { confirm, message } from "@tauri-apps/plugin-dialog";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { type Update } from "@tauri-apps/plugin-updater";
import clsx from "clsx";
import { useState } from "react";
import {
    CheckCircleFill,
    ChevronRight,
    CloudArrowDownFill,
    CloudArrowUpFill,
    CloudCheckFill,
} from "react-bootstrap-icons";
import { t, vpnServiceManager } from "../../utils/helper";
import { useUpdate } from "./update-context";

type UpdaterPhase = "idle" | "available" | "downloading" | "ready";

/**
 * Single updater row that morphs between four states. The outer cell
 * stays in the grouped-card; only the inner title/subtitle/badge/progress
 * swap out. Inline progress bar lives in the row body rather than below
 * the card so users see activity where their eyes already are.
 */
function UpdaterRow({
    phase,
    version,
    progress,
    disabled,
    onPress,
}: {
    phase: UpdaterPhase;
    version?: string;
    progress: number;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { Icon, iconColor, iconBg, title, subtitle, badge } = renderCopy(
        phase,
        version,
    );

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onPress()}
            className={clsx(
                "relative w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "active:bg-[rgba(60,60,67,0.06)] hover:bg-[rgba(60,60,67,0.025)]",
            )}
        >
            <div
                className="size-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: iconBg }}
            >
                <Icon size={18} style={{ color: iconColor }} />
            </div>

            <div className="flex-1 min-w-0">
                <div
                    className="text-[15px] tracking-[-0.005em] truncate"
                    style={{ color: "var(--onebox-label)" }}
                >
                    {title}
                </div>
                {subtitle && (
                    <div
                        className="text-[12px] truncate mt-0.5"
                        style={{ color: "var(--onebox-label-secondary)" }}
                    >
                        {subtitle}
                    </div>
                )}
            </div>

            {phase === "downloading" ? (
                <span
                    className="shrink-0 text-[13px] font-medium tabular-nums min-w-8.5 text-right"
                    style={{ color: "var(--onebox-blue)" }}
                >
                    {Math.floor(progress)}%
                </span>
            ) : (
                badge && <div className="shrink-0">{badge}</div>
            )}

            {phase !== "downloading" && (
                <ChevronRight
                    size={13}
                    className="shrink-0"
                    style={{ color: "rgba(60, 60, 67, 0.28)" }}
                />
            )}

            {phase === "downloading" && (
                <div
                    className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
                    style={{ background: "rgba(60, 60, 67, 0.1)" }}
                >
                    <div
                        className="h-full"
                        style={{
                            width: `${Math.min(progress, 100)}%`,
                            background: "var(--onebox-blue)",
                            transition:
                                "width 300ms cubic-bezier(0.32, 0.72, 0, 1)",
                        }}
                    />
                </div>
            )}
        </button>
    );
}

function renderCopy(
    phase: UpdaterPhase,
    version: string | undefined,
) {
    switch (phase) {
        case "available":
            return {
                Icon: CloudArrowDownFill,
                iconColor: "var(--onebox-blue)",
                iconBg: "rgba(0, 122, 255, 0.1)",
                title: t("update_available", "Update available"),
                subtitle: version ? `v${version}` : undefined,
                badge: <NewBadge />,
            };
        case "downloading":
            return {
                Icon: CloudArrowDownFill,
                iconColor: "var(--onebox-blue)",
                iconBg: "rgba(0, 122, 255, 0.1)",
                title: t("downloading", "Downloading"),
                subtitle: version ? `v${version}` : undefined,
                badge: null,
            };
        case "ready":
            return {
                Icon: CloudCheckFill,
                iconColor: "#34C759",
                iconBg: "rgba(52, 199, 89, 0.12)",
                title: t("install_new_update", "Install New Update"),
                subtitle: version
                    ? t("update_ready_hint", `v${version} ready to install`)
                    : undefined,
                badge: (
                    <CheckCircleFill
                        size={18}
                        style={{ color: "#34C759" }}
                    />
                ),
            };
        case "idle":
        default:
            return {
                Icon: CloudArrowUpFill,
                iconColor: "var(--onebox-label-secondary)",
                iconBg: "rgba(118, 118, 128, 0.12)",
                title: t("update", "Update"),
                subtitle: undefined,
                badge: null,
            };
    }
}

function NewBadge() {
    return (
        <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
            style={{
                background: "#FF3B30",
                color: "#FFFFFF",
                boxShadow: "0 1px 2px rgba(255, 59, 48, 0.3)",
            }}
        >
            NEW
        </span>
    );
}

// ---- Business logic (unchanged) -----------------------------------------

function useUpdateInstallation(isSimulating: boolean) {
    const confirmInstallation = async (updateInfo: Update) => {
        const confirmed = await confirm(t("update_downloaded"), {
            title: t("update_install"),
            kind: "info",
        });
        if (confirmed) {
            try {
                if (isSimulating) {
                    await exit();
                    return;
                }
                await vpnServiceManager.stop();
                setTimeout(async () => {
                    await updateInfo.install();
                    await relaunch();
                }, 2000);
            } catch (error) {
                console.error("Installation error:", error);
                await message(t("update_install_failed"), {
                    title: t("error"),
                    kind: "error",
                });
            }
        }
    };
    return { confirmInstallation };
}

function useUpdateHandler() {
    const { updateInfo, downloadComplete, downloading, checkAndDownloadUpdate } =
        useUpdate();
    const [isUpdating, setIsUpdating] = useState(false);

    const handleUpdateClick = async (
        confirmInstallation: (u: Update) => Promise<void>,
    ) => {
        if (isUpdating) return;
        setIsUpdating(true);
        try {
            if (downloadComplete && updateInfo) {
                await confirmInstallation(updateInfo);
                return;
            }
            if (downloading) return;
            const result = await checkAndDownloadUpdate();
            if (!result) {
                await message(t("no_update_available"), {
                    title: t("update"),
                    kind: "info",
                });
            }
        } catch (error) {
            console.error("Error during update:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    return { isUpdating, handleUpdateClick };
}

// ---- Main export --------------------------------------------------------

export default function UpdaterItem() {
    const {
        updateInfo,
        downloadComplete,
        downloading,
        downloadProgress,
        signatureThrottleUntil,
        isSimulating,
    } = useUpdate();
    const { confirmInstallation } = useUpdateInstallation(isSimulating);
    const { isUpdating, handleUpdateClick } = useUpdateHandler();

    const phase: UpdaterPhase = downloadComplete && updateInfo
        ? "ready"
        : downloading
            ? "downloading"
            : updateInfo
                ? "available"
                : "idle";

    // Throttle disables the click only for click paths that would re-trigger
    // a download; an already-finished download is still safe to install.
    const throttled = signatureThrottleUntil > Date.now() && phase !== "ready";

    return (
        <UpdaterRow
            phase={phase}
            version={updateInfo?.version}
            progress={downloadProgress}
            disabled={(isUpdating && phase === "idle") || throttled}
            onPress={() => handleUpdateClick(confirmInstallation)}
        />
    );
}
