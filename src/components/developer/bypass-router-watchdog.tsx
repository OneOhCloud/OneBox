import { type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { ClockHistory } from "react-bootstrap-icons";
import { getStoreValue, isBypassRouterEnabled, setStoreValue } from "../../single/store";
import {
    BYPASS_ROUTER_WATCHDOG_INTERVAL_STORE_KEY,
    BypassRouterWatchdogInterval,
    DEFAULT_BYPASS_ROUTER_WATCHDOG_INTERVAL,
} from "../../types/definition";
import { t } from "../../utils/helper";
import {
    RadioOption,
    RadioOptionList,
} from "../common/radio-option-list";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "./common";

const WATCHDOG_INTERVALS: BypassRouterWatchdogInterval[] = [
    "4",
    "12",
    "24",
    "disabled",
];

function normalizeInterval(value: unknown): BypassRouterWatchdogInterval {
    if (
        typeof value === "string" &&
        WATCHDOG_INTERVALS.includes(value as BypassRouterWatchdogInterval)
    ) {
        return value as BypassRouterWatchdogInterval;
    }
    return DEFAULT_BYPASS_ROUTER_WATCHDOG_INTERVAL;
}

function intervalLabel(interval: BypassRouterWatchdogInterval): string {
    if (interval === "disabled") {
        return t("bypass_router_watchdog_disabled");
    }
    return t(`bypass_router_watchdog_${interval}h`);
}

export default function BypassRouterWatchdogSetting() {
    const [isBypassEnabled, setIsBypassEnabled] = useState(false);
    const [interval, setIntervalValue] = useState<BypassRouterWatchdogInterval>(
        DEFAULT_BYPASS_ROUTER_WATCHDOG_INTERVAL,
    );
    const [selectedInterval, setSelectedInterval] =
        useState<BypassRouterWatchdogInterval>(
            DEFAULT_BYPASS_ROUTER_WATCHDOG_INTERVAL,
        );
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadState = async () => {
            try {
                const [bypassEnabled, storedInterval] = await Promise.all([
                    isBypassRouterEnabled(),
                    getStoreValue(
                        BYPASS_ROUTER_WATCHDOG_INTERVAL_STORE_KEY,
                        DEFAULT_BYPASS_ROUTER_WATCHDOG_INTERVAL,
                    ),
                ]);
                if (cancelled) return;

                const normalizedInterval = normalizeInterval(storedInterval);
                setIsBypassEnabled(bypassEnabled);
                setIntervalValue(normalizedInterval);
                if (!modalOpen) {
                    setSelectedInterval(normalizedInterval);
                }
            } catch (error) {
                console.warn("Error loading watchdog interval state.", error);
            }
        };

        loadState();
        const loadStateId = window.setInterval(loadState, 500);
        return () => {
            cancelled = true;
            window.clearInterval(loadStateId);
        };
    }, [modalOpen]);

    const handleSave = async () => {
        try {
            await setStoreValue(
                BYPASS_ROUTER_WATCHDOG_INTERVAL_STORE_KEY,
                selectedInterval,
            );
            setIntervalValue(selectedInterval);
            setModalOpen(false);
        } catch (error) {
            console.error("Failed to save watchdog interval:", error);
        }
    };

    if (type() !== "macos" || !isBypassEnabled) {
        return null;
    }

    const options: RadioOption<BypassRouterWatchdogInterval>[] =
        WATCHDOG_INTERVALS.map((value) => ({
            key: value,
            label: intervalLabel(value),
        }));

    return (
        <>
            <SettingItem
                icon={<ClockHistory className="text-[#5856D6]" size={22} />}
                title={t("bypass_router_watchdog")}
                subTitle={t("bypass_router_watchdog_desc")}
                badge={<span>{intervalLabel(interval)}</span>}
                onPress={() => {
                    setSelectedInterval(interval);
                    setModalOpen(true);
                }}
            />

            <SettingsModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={t("bypass_router_watchdog")}
                confirmLabel={t("confirm")}
                onConfirm={handleSave}
            >
                <RadioOptionList
                    value={selectedInterval}
                    onChange={setSelectedInterval}
                    options={options}
                />
            </SettingsModal>
        </>
    );
}
