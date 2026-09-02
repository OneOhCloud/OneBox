import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Cpu, Modem, Router } from "react-bootstrap-icons";
import { toast } from "sonner";
import { useEngineState } from "../../hooks/useEngineState";
import {
    getAllowLan,
    getProxyPort,
    getProxyTransportMode,
    isBypassRouterEnabled,
    setAllowLan,
    setProxyPort,
    setProxyTransportMode,
} from "../../single/store";
import { DEFAULT_PROXY_PORT, ProxyTransportMode } from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import { RadioOption, RadioOptionList } from "../common/radio-option-list";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem, ToggleSetting } from "./common";

const NO_LAN_ADDRESS = "127.0.0.1";

function normalizePort(value: string): number | null {
    const port = Number(value.trim());
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return null;
    }
    return port;
}

async function getLanIP(): Promise<string> {
    try {
        return await invoke<string>("get_lan_ip");
    } catch (error) {
        console.error("Failed to get LAN IP:", error);
        return NO_LAN_ADDRESS;
    }
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
 * Everything that decides how traffic reaches OneBox: the three mutually
 * exclusive transport modes, the port they listen on, and who may reach it.
 *
 * All three are staged until Save. What Save then does depends on what moved —
 * mode and port need the engine stopped, LAN access only needs a reload — so
 * flipping LAN alone never costs a reconnect.
 */
export default function ProxyModeSetting() {
    const engineState = useEngineState();
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<ProxyTransportMode>("system");
    const [port, setPort] = useState(DEFAULT_PROXY_PORT);
    const [allowLan, setAllowLanState] = useState(false);
    const [lanIP, setLanIP] = useState(NO_LAN_ADDRESS);
    const [useBypassRouter, setUseBypassRouter] = useState(false);
    const [draftMode, setDraftMode] = useState<ProxyTransportMode>("system");
    const [draftPort, setDraftPort] = useState(DEFAULT_PROXY_PORT.toString());
    const [draftLan, setDraftLan] = useState(false);

    const loadState = async () => {
        const [savedMode, savedPort, savedLan, bypassRouter, ip] = await Promise.all([
            getProxyTransportMode(),
            getProxyPort(),
            getAllowLan(),
            isBypassRouterEnabled(),
            getLanIP(),
        ]);
        setMode(savedMode);
        setPort(savedPort);
        setAllowLanState(savedLan);
        setUseBypassRouter(bypassRouter);
        setLanIP(ip);
        setDraftMode(savedMode);
        setDraftPort(savedPort.toString());
        setDraftLan(savedLan);
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

    const handleToggleLan = async () => {
        if (!draftLan && lanIP === NO_LAN_ADDRESS) {
            await message(t("cannot_open_lan_connection"), {
                title: t("error"),
                kind: "error",
            });
            return;
        }
        setDraftLan(!draftLan);
    };

    const handleSave = async () => {
        if (parsedPort === null) {
            toast.error(t("proxy_port_invalid"));
            return;
        }

        const modeChanged = draftMode !== mode;
        const portChanged = parsedPort !== port;
        const lanChanged = draftLan !== allowLan;
        if (!modeChanged && !portChanged && !lanChanged) {
            setIsOpen(false);
            return;
        }

        const isRunning = engineState.kind === "running";
        // Mode and port are baked into the running process; LAN access only
        // changes which address the inbound binds to, which a reload picks up.
        const needsStop = isRunning && (modeChanged || portChanged);
        const needsReload = isRunning && !needsStop;

        setIsLoading(true);
        try {
            const persist = async () => {
                // The engine must stop before the mode is persisted: the Rust
                // stop path reads the mode it was started with to pick its
                // cleanup strategy (see vpnServiceManager.stop).
                if (needsStop) {
                    await vpnServiceManager.stop();
                }
                if (modeChanged) await setProxyTransportMode(draftMode);
                if (portChanged) await setProxyPort(parsedPort);
                if (lanChanged) await setAllowLan(draftLan);
                setMode(draftMode);
                setPort(parsedPort);
                setAllowLanState(draftLan);
                if (needsReload) {
                    await vpnServiceManager.syncConfig({});
                    await vpnServiceManager.reload(1000);
                }
            };

            if (needsStop) {
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
            console.error("Failed to save proxy settings:", error);
            toast.error(t("proxy_mode_save_failed"));
        } finally {
            setIsLoading(false);
        }
    };

    const icon = useBypassRouter
        ? <Modem className="text-[#5856D6]" size={22} />
        : <Cpu className="text-[#5856D6]" size={22} />;

    const sectionLabel = "text-[12px] mb-2";
    const sectionLabelStyle = { color: "var(--onebox-label-secondary)" };

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
                    setDraftLan(allowLan);
                    loadState();
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
                <div className={sectionLabel} style={sectionLabelStyle}>
                    {t("mode")}
                </div>
                <RadioOptionList
                    value={draftMode}
                    onChange={setDraftMode}
                    options={options}
                />
                <div
                    className="mt-4 pt-3"
                    style={{ borderTop: "0.5px solid var(--onebox-separator)" }}
                >
                    <div className={sectionLabel} style={sectionLabelStyle}>
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
                <div
                    className="mt-4 pt-3"
                    style={{ borderTop: "0.5px solid var(--onebox-separator)" }}
                >
                    <div className="onebox-grouped-list">
                        <ToggleSetting
                            icon={<Router className="text-[#5856D6]" size={22} />}
                            title={t("allow_lan_connection")}
                            subTitle={`${lanIP}:${parsedPort ?? port}`}
                            isEnabled={draftLan}
                            onToggle={handleToggleLan}
                        />
                    </div>
                </div>
            </SettingsModal>
        </>
    );
}
