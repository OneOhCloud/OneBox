import { type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { Modem } from "react-bootstrap-icons";
import { toast } from "sonner";
import { isBypassRouterEnabled, setBypassRouterEnabled, setProxyTransportMode, setUseDHCP } from "../../single/store";
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
        await setBypassRouterEnabled(!toggle);

        // off -> on
        if (!toggle) {
            // 旁路由是 TUN 的子模式，开启时把代理模式带到 TUN 并禁用 DHCP。
            // 关闭时不改代理模式：用户可能只是想回到纯 TUN。
            // Bypass router is a TUN sub-mode: enabling it implies TUN and
            // disables DHCP. Disabling it leaves the transport mode alone.
            await setProxyTransportMode("tun");
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