import { useEffect, useState } from "react";
import { Ethernet } from "react-bootstrap-icons";
import { getUseDHCP, isBypassRouterEnabled, setUseDHCP } from "../../single/store";
import { t, vpnServiceManager } from "../../utils/helper";
import { ToggleSetting } from "./common";


export default function ToggleDHCP() {
    const [toggle, setToggle] = useState(false);
    const [loading, setLoading] = useState(false);
    const [useBypassRouter, setUseBypassRouter] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            if (loading) return;
            try {
                const state: boolean = await getUseDHCP();
                setToggle(Boolean(state));
                setUseBypassRouter(await isBypassRouterEnabled());

            } catch (error) {
                console.warn("Error loading DHCP state, defaulting to false.");
            }
        };
        loadState();
        const loadStateID = setInterval(loadState, 500);
        return () => clearTimeout(loadStateID);
    }, []);

    const handleToggle = async () => {
        setLoading(true);
        try {
            const next = !toggle;
            setToggle(next);
            setUseDHCP(next);

            if (!await vpnServiceManager.is_running()) return;

            // 切换 DHCP 设置后需要同步并重载配置
            await vpnServiceManager.syncConfig({});
            await vpnServiceManager.reload(1000);
        } catch (error) {
            console.error("Failed to toggle DHCP:", error);

        } finally {
            setLoading(false);
        }

    }

    if (useBypassRouter) {
        return <div></div>;
    }

    return (
        <ToggleSetting
            icon={<Ethernet className="text-[#5856D6]" size={22} />}
            title={t("use_dhcp")}
            subTitle={t("use_dhcp_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}
