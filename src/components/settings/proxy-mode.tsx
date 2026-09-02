import { useEffect, useState } from "react";
import { Cpu, Modem } from "react-bootstrap-icons";
import { toast } from "sonner";
import { useEngineState } from "../../hooks/useEngineState";
import {
    getProxyPort,
    getProxyTransportMode,
    isBypassRouterEnabled,
    setProxyPort,
    setProxyTransportMode,
} from "../../single/store";
import {
    DEFAULT_PROXY_PORT,
    PROXY_PORT_CHANGED_EVENT,
    ProxyTransportMode,
} from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import { RadioOption, RadioOptionList } from "../common/radio-option-list";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "./common";

function normalizePort(value: string): number | null {
    const port = Number(value.trim());
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return null;
    }
    return port;
}

function modeLabel(mode: ProxyTransportMode): string {
    switch (mode) {
        case "tun":
            return t("tun_mode");
        case "system":
            return t("proxy_mode_system");
        case "manual":
            return t("proxy_mode_manual");
    }
}

function modeDescription(mode: ProxyTransportMode): string {
    switch (mode) {
        case "tun":
            return t("tun_mode_desc");
        case "system":
            return t("proxy_mode_system_desc");
        case "manual":
            return t("proxy_mode_manual_desc");
    }
}

/**
 * The three transport modes are mutually exclusive, so they are one radio
 * group rather than the boolean pair they used to be. The listening port
 * lives in the same sheet because it applies to all three, and both are
 * staged until Save so switching mode costs a single engine stop.
 */
export default function ProxyModeSetting() {
    const engineState = useEngineState();
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<ProxyTransportMode>("system");
    const [port, setPort] = useState(DEFAULT_PROXY_PORT);
    const [useBypassRouter, setUseBypassRouter] = useState(false);
    const [draftMode, setDraftMode] = useState<ProxyTransportMode>("system");
    const [draftPort, setDraftPort] = useState(DEFAULT_PROXY_PORT.toString());

    const loadState = async () => {
        const [savedMode, savedPort, bypassRouter] = await Promise.all([
            getProxyTransportMode(),
            getProxyPort(),
            isBypassRouterEnabled(),
        ]);
        setMode(savedMode);
        setPort(savedPort);
        setUseBypassRouter(bypassRouter);
        setDraftMode(savedMode);
        setDraftPort(savedPort.toString());
    };

    useEffect(() => {
        loadState();
    }, []);

    const parsedPort = normalizePort(draftPort);
    const portError = draftPort.trim() && parsedPort === null
        ? t("proxy_port_invalid")
        : undefined;

    const options: RadioOption<ProxyTransportMode>[] = (
        ["tun", "system", "manual"] as const
    ).map((key) => ({
        key,
        label: modeLabel(key),
        sublabel: modeDescription(key),
    }));

    const handleSave = async () => {
        if (parsedPort === null) {
            toast.error(t("proxy_port_invalid"));
            return;
        }

        setIsLoading(true);
        try {
            // The engine must be stopped before the mode is persisted: the Rust
            // stop path reads the mode it was started with to pick its cleanup
            // strategy (see vpnServiceManager.stop).
            const wasRunning = engineState.kind === "running";
            const persist = async () => {
                if (wasRunning) {
                    await vpnServiceManager.stop();
                }
                await setProxyTransportMode(draftMode);
                if (parsedPort !== port) {
                    await setProxyPort(parsedPort);
                    window.dispatchEvent(
                        new CustomEvent<number>(PROXY_PORT_CHANGED_EVENT, {
                            detail: parsedPort,
                        }),
                    );
                }
                setMode(draftMode);
                setPort(parsedPort);
            };

            if (wasRunning) {
                await toast.promise(persist(), {
                    loading: t("please_wait_releasing_resources"),
                    success: t("proxy_mode_saved_stop_vpn"),
                    error: t("proxy_mode_save_failed"),
                });
            } else {
                await persist();
                toast.success(t("proxy_mode_saved"));
            }
            setIsOpen(false);
        } catch (error) {
            console.error("Failed to save proxy mode:", error);
            toast.error(t("proxy_mode_save_failed"));
        } finally {
            setIsLoading(false);
        }
    };

    const icon = useBypassRouter
        ? <Modem className="text-[#5856D6]" size={22} />
        : <Cpu className="text-[#5856D6]" size={22} />;

    return (
        <>
            <SettingItem
                icon={icon}
                title={t("proxy_mode")}
                subTitle={`${t("proxy_port")} ${port}`}
                badge={modeLabel(mode)}
                onPress={() => {
                    setDraftMode(mode);
                    setDraftPort(port.toString());
                    setIsOpen(true);
                }}
            />
            <SettingsModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                title={t("proxy_mode")}
                confirmLabel={t("save")}
                onConfirm={handleSave}
                confirmDisabled={parsedPort === null}
                confirmLoading={isLoading}
            >
                <RadioOptionList
                    value={draftMode}
                    onChange={setDraftMode}
                    options={options}
                />
                <div
                    className="mt-4 pt-3"
                    style={{ borderTop: "0.5px solid var(--onebox-separator)" }}
                >
                    <div
                        className="text-[12px] mb-2"
                        style={{ color: "var(--onebox-label-secondary)" }}
                    >
                        {t("proxy_port")}
                    </div>
                    <IOSTextField
                        value={draftPort}
                        onChange={(value) => setDraftPort(value.replace(/[^\d]/g, ""))}
                        placeholder={DEFAULT_PROXY_PORT.toString()}
                        error={portError}
                        monospace
                        onSubmit={handleSave}
                    />
                </div>
            </SettingsModal>
        </>
    );
}
