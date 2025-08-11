import { useEffect, useState } from "react";
import { Shield } from "react-bootstrap-icons";
import { useSubscriptions } from "../../hooks/useDB";
import { Subscription } from "../../types/definition";
import { t, vpnServiceManager } from "../../utils/helper";
import { AppleNetworkStatus, GoogleNetworkStatus } from "./network-check";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";

const formatDate = (date: number) => new Date(date).toLocaleDateString('zh-CN');




export default function VPNBody({ isRunning }: { isRunning: boolean }) {
    const [sub, setSub] = useState<Subscription>();
    const { data, isLoading } = useSubscriptions();
    const [showNetworkStatus, setShowNetworkStatus] = useState(false);


    const handleUpdate = async (identifier: string, isUpdate: boolean) => {
        try {
            setSub(data?.find(item => item.identifier === identifier));
            if (isUpdate && isRunning) await vpnServiceManager.stop();
        } catch (error) {
            console.error(t("update_config_failed") + ":", error);
        }
    };

    useEffect(() => {
        let timer: any;
        // 如果正在运行，则延迟1秒显示网络状态，否则不显示
        if (isRunning) {
            timer = setTimeout(() => setShowNetworkStatus(true), 2000);
        } else {
            setShowNetworkStatus(false);
        }
        return () => {
            timer && clearTimeout(timer);
        };

    }, [isRunning, isLoading]);

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

                        <div className="flex gap-2 px-2 items-center">
                            {showNetworkStatus && (
                                <>
                                    <AppleNetworkStatus isRunning={isRunning} />
                                    <GoogleNetworkStatus isRunning={isRunning} />
                                </>
                            )}
                        </div>


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