import { useEffect, useMemo } from "react";
import Body from "../components/home/body";
import {
    ProxyMode,
    useModeIndicator,
    useProxyMode,
    useVPNOperations,
} from "../components/home/hooks";
import { ModeSwitcher } from "../components/home/mode-switcher";
import { PowerToggle } from "../components/home/power-toggle";
import { PrestartRepairModal } from "../components/home/prestart-repair-modal";
import { StatusDisplay } from "../components/home/status-display";
import { useSubscriptions } from "../hooks/useDB";
import { t } from "../utils/helper";

import "./home.css";

// Layout targets the actual available area: 371×514 px
// (600 window - 30 titlebar - 56 tab bar). Everything is vertically
// rhythmed against that budget so there's no scrolling.
export default function HomePage() {
    const { data: subscriptions } = useSubscriptions();
    const { selectedMode, initializeMode, changeMode } = useProxyMode();
    const {
        isLoading,
        isRunning,
        operationStatus,
        toggleService,
        restartService,
        repairState,
        onRepairSuccess,
    } = useVPNOperations();
    const { indicatorStyle, modeButtonsRef } = useModeIndicator(selectedMode);

    const isEmpty = !subscriptions?.length;

    useEffect(() => {
        initializeMode();
    }, []);

    const handleModeChange = async (mode: ProxyMode) => {
        await changeMode(mode);
        if (isLoading || isRunning) {
            await restartService(isEmpty);
        }
    };

    const handleUpdate = async () => {
        await restartService(isEmpty);
    };

    const statusText = useMemo(() => {
        switch (operationStatus) {
            case "starting":
                return t("connecting");
            case "stopping":
                return t("switching");
            default:
                return isRunning ? t("connected") : t("not_connected");
        }
    }, [operationStatus, isRunning]);

    const phase: "idle" | "connecting" | "on" = isLoading
        ? "connecting"
        : isRunning
            ? "on"
            : "idle";

    return (
        <div
            className="onebox-home relative w-full h-[calc(100dvh-56px)] overflow-hidden"
            data-phase={phase}
        >
            <PrestartRepairModal
                visible={repairState.visible}
                orphanPids={repairState.orphanPids}
                onSuccess={onRepairSuccess}
                onClose={() => {/* dismissed on failure — user must restart */}}
            />
            {/* systemBlue aura — only rendered when the tile is active or
                connecting. Same design vocabulary as the warm glow under
                an active HomeKit accessory. Idle shows no decoration. */}
            <div className="onebox-aura" aria-hidden />

            {/* Content */}
            <div className="relative h-full flex flex-col items-center px-5 pt-5 pb-5">
                <PowerToggle
                    isRunning={Boolean(isRunning)}
                    isLoading={isLoading}
                    onClick={() => toggleService(isEmpty)}
                />

                <div className="mt-4">
                    <StatusDisplay statusText={statusText} phase={phase} />
                </div>

                <div className="mt-5">
                    <ModeSwitcher
                        selectedMode={selectedMode}
                        onModeChange={handleModeChange}
                        indicatorStyle={indicatorStyle}
                        containerRef={modeButtonsRef}
                    />
                </div>

                <div className="mt-5 w-full flex-1 min-h-0">
                    <Body
                        isRunning={Boolean(isRunning)}
                        onUpdate={handleUpdate}
                    />
                </div>
            </div>
        </div>
    );
}
