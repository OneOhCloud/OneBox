import { useEffect, useState } from "react";
import { Cpu, Modem } from "react-bootstrap-icons";
import { toast } from "sonner";
import { getEnableTun, isBypassRouterEnabled, setEnableTun } from "../../single/store";
import { t, vpnServiceManager } from "../../utils/helper";
import { ToggleSetting } from "./common";


export default function ToggleTun() {
    const [toggle, setToggle] = useState(false);
    const [useBypassRouter, setUseBypassRouter] = useState(false);

    useEffect(() => {
        const loadTunState = async () => {
            try {
                const state: boolean | undefined = await getEnableTun();
                if (state !== undefined) {
                    setToggle(state);
                } else {
                    setToggle(false);
                }
                setUseBypassRouter(await isBypassRouterEnabled());
            } catch (error) {
                console.error("Failed to load tun state:", error);
            }
        };

        loadTunState();
    }, []);

    const icon = useBypassRouter ? <Modem className="text-[#5856D6]" size={22} /> : <Cpu className="text-[#5856D6]" size={22} />;


    const handleToggle = async () => {


        if (!await vpnServiceManager.is_running()) {
            await setEnableTun(!toggle);
            setToggle(!toggle);
            return;

        } else {

            const promise = new Promise<void>(async (resolve, reject) => {
                const previous = toggle;
                try {
                    await vpnServiceManager.stop();
                    if (previous) {
                        await new Promise(res => setTimeout(res, 2000));
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            toast.promise(promise, {
                // 请勿操作,正在释放资源中，
                loading: t("please_wait_releasing_resources"),
                success: async () => {
                    await setEnableTun(!toggle);
                    setToggle(!toggle);
                    // 释放成功
                    return t("release_success_stop_vpn");
                },
                error: (err) => {
                    setToggle(!toggle);
                    return t(err.message);
                }
            });
        }

    };

    return (
        <ToggleSetting
            icon={icon}
            title={t("tun_mode")}
            subTitle={t("tun_mode_desc") + (useBypassRouter ? " +" : "")
            }
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}