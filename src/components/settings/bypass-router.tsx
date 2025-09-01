import { type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { Modem } from "react-bootstrap-icons";
import { toast } from "sonner";
import { getEnableBypassRouter, setEnableBypassRouter, setEnableTun } from "../../single/store";
import { t, vpnServiceManager } from "../../utils/helper";
import { ToggleSetting } from "./common";



export default function ToggleBypassRouter() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadTunState = async () => {
            try {
                const state: boolean | undefined = await getEnableBypassRouter();
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
        await setEnableBypassRouter(!toggle);
        await setEnableTun(!toggle);
        setToggle(!toggle);
        if (await vpnServiceManager.is_running()) {
            toast.promise(
                vpnServiceManager.stop(),
                {
                    loading: t("setting_bypass_router_up"),
                    success: t("setting_bypass_router_success"),
                    error: t("setting_bypass_router_failed"),
                }
            );

        } else {
            if (!toggle) {
                toast.success(t("setting_bypass_router_success"));

            }
        }

    };

    if (type() !== "macos") {
        return null;
    }

    return (
        <ToggleSetting
            icon={<Modem className="text-[#5856D6]" size={22} />}
            title={t("bypass_router_mode")}
            subTitle={t("bypass_router_mode_subtitle")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}