import { useEffect, useState } from "react";
import { Router } from "react-bootstrap-icons";
import { getAllowLan, getProxyPort, setAllowLan } from "../../single/store";
import { ToggleSetting } from "./common";

import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { DEFAULT_PROXY_PORT, PROXY_PORT_CHANGED_EVENT } from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";


async function getLanIP(): Promise<string> {
  try {
    const lanIP = await invoke<string>("get_lan_ip");
    return lanIP;
  } catch (error) {
    console.error("Failed to get LAN IP:", error);
    return "127.0.0.1";
  }
}


export default function ToggleLan() {
  const [toggle, setToggle] = useState(false);
  const [lanIP, setLanIP] = useState<string>("127.0.0.1");
  const [proxyPort, setProxyPort] = useState(DEFAULT_PROXY_PORT);

  useEffect(() => {
    const loadTunState = async () => {
      try {
        const state: boolean = await getAllowLan();
        if (state !== undefined) {
          setToggle(state);
        } else {
          setToggle(false);
        }
      } catch (error) {
        console.error("Failed to load tun state:", error);
      }
    };

    const fetchLanIP = async () => {
      const ip = await getLanIP();

      setLanIP(ip);

    };
    fetchLanIP();
    loadTunState();
    getProxyPort().then(setProxyPort).catch(() => setProxyPort(DEFAULT_PROXY_PORT));

    const handleProxyPortChanged = (event: Event) => {
      const nextPort = (event as CustomEvent<number>).detail;
      if (Number.isInteger(nextPort)) {
        setProxyPort(nextPort);
      }
    };
    window.addEventListener(PROXY_PORT_CHANGED_EVENT, handleProxyPortChanged);
    return () => window.removeEventListener(PROXY_PORT_CHANGED_EVENT, handleProxyPortChanged);
  }, []);

  const handleToggle = async () => {
    if (!lanIP || lanIP === "127.0.0.1") {
      await message(t(
        "cannot_open_lan_connection"
      ), {
        title: t("error"),
        kind: "error",
      });
      return;
    } else {
      await setAllowLan(!toggle);
      setToggle(!toggle);
      await vpnServiceManager.syncConfig({});
      await vpnServiceManager.reload(1000);
    }
  }

  return (
    <ToggleSetting
      icon={<Router className="text-[#5856D6] " size={22} />}
      title={t("allow_lan_connection")}
      subTitle={`${lanIP}:${proxyPort}`}
      isEnabled={toggle}
      onToggle={handleToggle}
    />
  )
}
