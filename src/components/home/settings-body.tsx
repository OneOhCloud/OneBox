import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Globe, Reception4, Shield } from "react-bootstrap-icons";
import useSWR from "swr";
import { useSubscriptions } from "../../hooks/useDB";
import { Subscription } from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";

const formatDate = (date: number) => new Date(date).toLocaleDateString('zh-CN');

const NetworkStatus = ({ isOk, icon: Icon, tip }: { isOk: boolean; icon: typeof Globe; tip: string }) => (
    <motion.div
        className="tooltip tooltip-left"
        data-tip={`${tip} ${isOk ? t("network_normal") : t("network_abnormal")}`}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, type: "spring", stiffness: 200 }}
        whileHover={{ scale: 1.1 }}
    >
        <motion.div
            animate={{
                rotateZ: isOk ? [0, 10, -10, 0] : 0,
            }}
            transition={{
                duration: 0.5,
                repeat: isOk ? Infinity : 0,
                repeatDelay: 2
            }}
        >
            <Icon className={`size-4 ${isOk ? 'text-gray-500' : 'text-red-500'} transition-colors duration-300`} />
        </motion.div>
    </motion.div>
);

const fetchNetworkStatus = async (mode: "google" | "apple") => {
    try {
        if (mode === "google") {
            return await invoke<boolean>('ping_google');
        } else {
            return await invoke<boolean>('ping_apple_captive');
        }
    } catch {
        return false;
    }
};

export default function SettingsBody({ isRunning }: { isRunning: boolean }) {
    const [sub, setSub] = useState<Subscription>();
    const { data, isLoading } = useSubscriptions();
    const { data: baiduStatus } = useSWR(isRunning ? 'baidu' : null, () => fetchNetworkStatus('apple'), { refreshInterval: 2000 });
    const { data: googleStatus } = useSWR(isRunning ? 'google' : null, () => fetchNetworkStatus('google'), { refreshInterval: 2000 });

    const handleUpdate = async (identifier: string, isUpdate: boolean) => {
        try {
            setSub(data?.find(item => item.identifier === identifier));
            if (isUpdate && isRunning) await vpnServiceManager.stop();
        } catch (error) {
            console.error(t("update_config_failed") + ":", error);
        }
    };

    useEffect(() => { }, [isRunning, isLoading]);

    return (
        <div className='w-full'>
            <div>
                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px]">
                        <div className="capitalize">
                            {
                                t("current_subscription")
                            }
                        </div>
                        {isRunning && (
                            <div className="flex gap-2 px-2 items-center">
                                <NetworkStatus isOk={baiduStatus ?? true} icon={Reception4} tip={
                                    t("normal_network")
                                } />
                                <NetworkStatus isOk={googleStatus ?? true} icon={Globe} tip={
                                    t("vpn_network")
                                } />
                            </div>
                        )}
                    </div>
                    <SelectSub onUpdate={handleUpdate} data={data} isLoading={isLoading} />
                </div>
                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px] capitalize">
                        {t("node_selection")}
                    </div>
                    <SelectNode disabled={!isRunning} />
                </div>
            </div>
            {sub && (
                <div className="w-full   mt-4 mb-2">
                    <div className="flex items-center justify-center">
                        <Shield size={14} className="text-gray-400 mr-1" />
                        <span className="text-xs text-gray-400 capitalize">
                            {t("current_subscription")}
                        </span>
                    </div>

                    <div className="flex items-center justify-center mt-1">
                        <span className="text-xs text-blue-500 ">
                            {t("expired_at") + " "}
                            {formatDate(sub.expire_time)}
                        </span>
                    </div>


                </div>
            )}
        </div>
    );
}