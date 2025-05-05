import { useEffect, useState } from "react";
import { Router } from "react-bootstrap-icons";
import { getAllowLan } from "../../single/store";
import { ToggleSetting } from "./common";

import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";


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
  const [lanIP, setLanIP] = useState<string | null>(null);

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
  }, []);

  const handleToggle = async () => {
    if (lanIP === "127.0.0.1") {
      await message('无法开启局域网连接', { title: '错误', kind: 'error' });
      return;
    } else {
    }
  }

  return (
    <ToggleSetting
      icon={<Router className="text-[#5856D6]" size={22} />}
      title="允许局域网连接"
      subTitle={`${lanIP}:6789`}
      isEnabled={toggle}
      onToggle={handleToggle}
    />
  )
}