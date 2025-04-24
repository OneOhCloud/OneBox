import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Globe, Reception4, Shield } from "react-bootstrap-icons";
import useSWR from "swr";
import { getSubscriptionConfig } from "../../action/db";
import { useSubscriptions } from "../../hooks/useDB";
import { Subscription } from "../../types/definition";
import { vpnServiceManager } from "../../utils/helper";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";

const formatDate = (date: number) => new Date(date).toLocaleDateString('zh-CN');

const NetworkStatus = ({ isOk, icon: Icon, tip }: { isOk: boolean; icon: typeof Globe; tip: string }) => (
    <motion.div
        className="tooltip"
        data-tip={`${tip}${isOk ? '正常' : '异常'}`}
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

const fetchNetworkStatus = async (url: string) => {
    try {
        return await invoke<boolean>('ping', { url: `https://www.${url}.com` });
    } catch {
        return false;
    }
};

export default function SettingsBody({ isRunning }: { isRunning: boolean }) {
    const [nodeList, setNodeList] = useState<string[]>([]);
    const [sub, setSub] = useState<Subscription>();
    const { data, isLoading } = useSubscriptions();
    const { data: baiduStatus } = useSWR(isRunning ? 'baidu' : null, () => fetchNetworkStatus('baidu'), { refreshInterval: 5000 });
    const { data: googleStatus } = useSWR(isRunning ? 'google' : null, () => fetchNetworkStatus('google'), { refreshInterval: 5000 });

    const handleUpdate = async (identifier: string, isUpdate: boolean) => {
        try {
            const config = await getSubscriptionConfig(identifier);
            setSub(data?.find(item => item.identifier === identifier));
            const selector = config.outbounds.find((item: any) => item.type === "selector");
            if (selector) setNodeList(selector.outbounds);
            if (isUpdate && isRunning) await vpnServiceManager.stop();
        } catch (error) {
            console.error('更新配置失败:', error);
        }
    };

    useEffect(() => { }, [isRunning, isLoading]);

    return (
        <div className='w-full'>
            <div>
                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px]">
                        <div>当前订阅</div>
                        {isRunning && (
                            <div className="flex gap-2 px-2 items-center">
                                <NetworkStatus isOk={baiduStatus ?? true} icon={Reception4} tip="网络" />
                                <NetworkStatus isOk={googleStatus ?? true} icon={Globe} tip="外网" />
                            </div>
                        )}
                    </div>
                    <SelectSub onUpdate={handleUpdate} data={data} isLoading={isLoading} />
                </div>
                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px]">节点选择</div>
                    <SelectNode disabled={!isRunning} nodeList={nodeList} />
                </div>
            </div>
            {sub && (
                <div className="w-full flex items-center justify-center mt-4 mb-2">
                    <Shield size={14} className="text-gray-400 mr-1" />
                    <span className="text-xs text-gray-400">当前订阅 </span>
                    <span className="text-xs text-blue-500 ml-1">有效至 {formatDate(sub.expire_time)}</span>
                </div>
            )}
        </div>
    );
}