import { type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { Modem } from "react-bootstrap-icons";
import { toast } from "sonner";
import { isBypassRouterEnabled, setBypassRouterEnabled, setEnableTun, setUseDHCP } from "../../single/store";
import { t, vpnServiceManager } from "../../utils/helper";
import { ToggleSetting } from "../settings/common";



export default function ToggleBypassRouter() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadTunState = async () => {
            try {
                const state: boolean | undefined = await isBypassRouterEnabled();
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
        // 切换旁路由模式时，同时切换 TUN 模式并禁用 DHCP
        // When toggling bypass router mode, also toggle TUN mode and disable DHCP

        await setBypassRouterEnabled(!toggle);
        await setEnableTun(!toggle);


        // off -> on
        if (!toggle) {
            // 启用旁路由模式时，禁用 DHCP
            // Disable DHCP when enabling bypass router mode
            await setUseDHCP(false);

        }

        setToggle(!toggle);


        if (!await vpnServiceManager.is_running()) return;

        toast.promise(
            vpnServiceManager.stop(),
            {
                loading: t("setting_bypass_router_up"),
                success: t("setting_bypass_router_success"),
                error: t("setting_bypass_router_failed"),
            }
        );




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