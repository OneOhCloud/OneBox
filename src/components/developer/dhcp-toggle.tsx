import { useEffect, useState } from "react";
import { Ethernet } from "react-bootstrap-icons";
import { setStoreValue } from "../../single/store";
import { USE_DHCP_STORE_KEY } from "../../types/definition";
import { getUseDHCP, t, vpnServiceManager } from "../../utils/helper";
import { ToggleSetting } from "./common";


export default function ToggleDHCP() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadState = async () => {
            try {
                // 优先使用 helper 中封装的 getUseDHCP()，它会根据系统返回默认值并读取 store
                const state: boolean = await getUseDHCP();
                setToggle(Boolean(state));
            } catch (error) {
                console.warn("Error loading DHCP state, defaulting to false.");
            }
        };

        loadState();
    }, []);

    const handleToggle = async () => {
        const next = !toggle;
        setToggle(next);
        try {
            await setStoreValue(USE_DHCP_STORE_KEY, next);
            // 切换 DHCP 设置后需要同步并重载配置
            await vpnServiceManager.syncConfig({});
            await vpnServiceManager.reload(1000);
        } catch (error) {
            console.error("Error saving DHCP state:", error);
        }

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
