import { useEffect, useState } from "react";
import { Cpu } from "react-bootstrap-icons";
import { getEnableTun, setEnableTun } from "../../single/store";
import { t, vpnServiceManager } from "../../utils/helper";
import { ToggleSetting } from "./common";


export default function ToggleTun() {
    const [toggle, setToggle] = useState(false);

    useEffect(() => {
        const loadTunState = async () => {
            try {
                const state: boolean | undefined = await getEnableTun();
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
        await setEnableTun(!toggle);
        await vpnServiceManager.stop();
    }





    return (
        <ToggleSetting
            icon={<Cpu className="text-[#5856D6]" size={22} />}
            title={t("tun_mode")}
            subTitle={t("tun_mode_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}