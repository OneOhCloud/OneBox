import { useEffect, useState } from "react";
import { Ethernet } from "react-bootstrap-icons";
import { toast } from "sonner";
import { DEFAULT_PROXY_PORT, PROXY_PORT_CHANGED_EVENT } from "../../types/definition";
import { getProxyPort, setProxyPort } from "../../single/store";
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

  const loadPort = async () => {
    const savedPort = await getProxyPort();
    setCurrentPort(savedPort);
    setPort(savedPort.toString());
  };

  useEffect(() => {
    loadPort();
  }, []);

  useEffect(() => {
    if (isOpen) loadPort();
  }, [isOpen]);

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
      </SettingsModal>
    </>
  );
}
