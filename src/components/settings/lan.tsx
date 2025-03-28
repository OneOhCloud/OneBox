import { useEffect, useState } from "react";
import { ToggleSetting } from "./common";
import { Router } from "react-bootstrap-icons";
import { store } from "../../single/store";


export default function ToggleLan() {
  const [toggle, setToggle] = useState(false);

  useEffect(() => {
    const loadTunState = async () => {
      try {
        const state: boolean | undefined = await store.get('tun');
        if (state !== undefined) {
          setToggle(state);
        } else {
          setToggle(false);
        }
      } catch (error) {
        console.error("Failed to load tun state:", error);
      }
    };
    loadTunState();
  }, []);

  const handleToggle = async () => {
    setToggle(!toggle);
    await store.set('tun', !toggle);
    await store.save();

  }

  return (
    <ToggleSetting
      icon={<Router className="text-[#5856D6]" size={22} />}
      title="允许局域网连接"
      subTitle="127.0.0.1:6789"
      isEnabled={toggle}
      onToggle={handleToggle}
    />
  )
}