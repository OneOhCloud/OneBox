import { useEffect, useState } from "react";
import { Ethernet } from "react-bootstrap-icons";
import { toast } from "sonner";
import { DEFAULT_PROXY_PORT, PROXY_PORT_CHANGED_EVENT } from "../../types/definition";
import { getEnableTun, getProxyPort, getSkipSystemProxy, setProxyPort, setSkipSystemProxy } from "../../single/store";
import { t, vpnServiceManager } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import { SettingsModal } from "../common/settings-modal";
import { SettingItem } from "./common";

function normalizePort(value: string): number | null {
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return port;
}

export default function ProxyPortSetting() {
  const [isOpen, setIsOpen] = useState(false);
  const [port, setPort] = useState(DEFAULT_PROXY_PORT.toString());
  const [currentPort, setCurrentPort] = useState(DEFAULT_PROXY_PORT);
  const [isLoading, setIsLoading] = useState(false);
  const [skipSystemProxy, setSkipSystemProxyState] = useState(false);
  const [tunEnabled, setTunEnabled] = useState(false);

  const loadState = async () => {
    const [savedPort, skipProxy, tunOn] = await Promise.all([
      getProxyPort(),
      getSkipSystemProxy(),
      getEnableTun(),
    ]);
    setCurrentPort(savedPort);
    setPort(savedPort.toString());
    setSkipSystemProxyState(skipProxy);
    setTunEnabled(tunOn);
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (isOpen) loadState();
  }, [isOpen]);

  const handleToggleSkipProxy = async () => {
    const next = !skipSystemProxy;
    setSkipSystemProxyState(next);
    try {
      await setSkipSystemProxy(next);
    } catch (error) {
      setSkipSystemProxyState(!next);
      console.error("Error saving system proxy toggle state:", error);
    }
  };

  const parsedPort = normalizePort(port);
  const error = port.trim() && parsedPort === null
    ? t("proxy_port_invalid", "Port must be between 1 and 65535")
    : undefined;

  const handleSave = async () => {
    if (parsedPort === null) {
      toast.error(t("proxy_port_invalid", "Port must be between 1 and 65535"));
      return;
    }

    setIsLoading(true);
    try {
      const applySavedPort = () => {
        setCurrentPort(parsedPort);
        window.dispatchEvent(new CustomEvent<number>(PROXY_PORT_CHANGED_EVENT, { detail: parsedPort }));
      };

      if (await vpnServiceManager.is_running()) {
        await toast.promise(
          (async () => {
            await vpnServiceManager.stop();
            await setProxyPort(parsedPort);
            applySavedPort();
          })(),
          {
            loading: t("please_wait_releasing_resources"),
            success: t("proxy_port_saved_stop_vpn", "Proxy port saved, VPN stopped"),
            error: t("proxy_port_save_failed", "Failed to save proxy port"),
          },
        );
      } else {
        await setProxyPort(parsedPort);
        applySavedPort();
        toast.success(t("proxy_port_saved", "Proxy port saved"));
      }
      setIsOpen(false);
    } catch {
      toast.error(t("proxy_port_save_failed", "Failed to save proxy port"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <SettingItem
        icon={<Ethernet className="text-[#FF9500]" size={22} />}
        title={t("proxy_port", "Proxy port")}
        subTitle={t("proxy_port_desc", "HTTP/SOCKS mixed inbound")}
        badge={currentPort}
        onPress={() => setIsOpen(true)}
      />
      <SettingsModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t("proxy_port", "Proxy port")}
        subtitle={t("proxy_port_desc", "HTTP/SOCKS mixed inbound")}
        confirmLabel={t("save")}
        onConfirm={handleSave}
        confirmDisabled={parsedPort === null}
        confirmLoading={isLoading}
      >
        <IOSTextField
          value={port}
          onChange={(value) => setPort(value.replace(/[^\d]/g, ""))}
          placeholder={DEFAULT_PROXY_PORT.toString()}
          error={error}
          monospace
          autoFocus
          onSubmit={handleSave}
        />
        {!tunEnabled && (
          <label
            className="mt-4 pt-3 flex items-center gap-3 cursor-pointer"
            style={{ borderTop: "0.5px solid var(--onebox-separator)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[14px]" style={{ color: "var(--onebox-label)" }}>
                {t("set_system_proxy")}
              </div>
              <div
                className="text-[12px] mt-0.5 leading-snug"
                style={{ color: "var(--onebox-label-secondary)" }}
              >
                {t("set_system_proxy_desc")}
              </div>
            </div>
            <input
              type="checkbox"
              className="onebox-toggle"
              checked={!skipSystemProxy}
              onChange={handleToggleSkipProxy}
            />
          </label>
        )}
      </SettingsModal>
    </>
  );
}
