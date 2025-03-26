import { ToggleSetting } from "./common";

import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect, useState } from 'react';
import { Power } from "react-bootstrap-icons";
import toast from 'react-hot-toast';

export default function ToggleAutoStart() {
    const [isOn, setIsOn] = useState(false);

    useEffect(() => {
        const checkAutoStart = async () => {
            try {
                const isAutoStartEnabled = await isEnabled();
                setIsOn(isAutoStartEnabled);
            } catch (error) {
                console.error("检查自动启动状态失败:", error);
                toast.error("无法获取自动启动状态");
            }
        };
        checkAutoStart();
    }, []);

    const handleToggle = async () => {
        // 保存当前状态用于可能的回滚
        const previousState = isOn;

        // 乐观更新 UI
        setIsOn(!isOn);

        try {
            if (!isOn) {
                await enable();
            } else {
                await disable();
            }
        } catch (error) {
            // 操作失败，回滚到之前的状态
            setIsOn(previousState);
            console.error("切换自动启动设置失败:", error);
            toast.error(`${!isOn ? "启用" : "禁用"} 开机启动失败`);
        } finally {
        }
    };

    return (
        <div>
            <ToggleSetting
                icon={<Power className="text-[#FF9500]" size={22} />}
                title="开机启动"
                isEnabled={isOn}
                onToggle={handleToggle}
            />
        </div>
    )
}