import { Power } from "lucide-react";
import { ToggleSetting } from "./common";

import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect, useState } from 'react';

export default function ToggleAutoStart() {
    const [isOn, setIsOn] = useState(false);

    useEffect(() => {
        const checkAutoStart = async () => {
            const isAutoStartEnabled = await isEnabled();
            setIsOn(isAutoStartEnabled);
        };
        checkAutoStart();
    }, []);

    useEffect(() => {
        const toggleAutoStart = async () => {
            if (isOn) {
                await enable();
            } else {
                await disable();
            }
        };
        toggleAutoStart();
    }, [isOn])

    return (
        <ToggleSetting
            icon={<Power className="text-[#FF9500]" size={22} />}
            title="开机启动"
            isEnabled={isOn}
            onToggle={() => setIsOn(!isOn)}
        />
    )
}