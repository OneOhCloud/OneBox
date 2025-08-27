import { useEffect, useState } from "react";
import { Cpu } from "react-bootstrap-icons";
import { toast } from "sonner";
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


        if (!await vpnServiceManager.is_running()) {
            await setEnableTun(!toggle);
            setToggle(!toggle);
            return;

        } else {
            const promise = (async () => {
                const previous = toggle;
                await vpnServiceManager.stop();
                if (previous) {
                    // 关闭TUN模式，等待5秒...
                    await new Promise(resolve => setTimeout(resolve, 2000));

                }
                throw new Error("need_restart_vpn");

            })();

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
            icon={<Cpu className="text-[#5856D6]" size={22} />}
            title={t("tun_mode")}
            subTitle={t("tun_mode_desc")}
            isEnabled={toggle}
            onToggle={handleToggle}
        />
    );
}