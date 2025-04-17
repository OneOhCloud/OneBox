import { useState } from "react";
import { Shield } from "react-bootstrap-icons";
import { getSubscriptionConfig } from "../../action/db";
import { Subscription } from "../../types/definition";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";

import { vpnServiceManager } from "../../utils/helper";
import { useSubscriptions } from "../../hooks/useDB";

const formatDate = (date: number) => {
    return new Date(date).toLocaleDateString('zh-CN');
}

export type SettingsBodyProps = {
    isRunning: boolean;
}

export default function SettingsBody({ isRunning }: SettingsBodyProps) {
    const [nodeList, setNodeList] = useState<string[]>([]);
    const [sub, setSub] = useState<Subscription>();
    const { data, isLoading } = useSubscriptions()




    const handleUpdate = async (identifier: string, isUpdate: boolean) => {
        try {
            const config = await getSubscriptionConfig(identifier);
            setSub(data?.find(item => item.identifier === identifier));
            const selector = config.outbounds.find((item: any) => item.type === "selector");
            if (selector) setNodeList(selector.outbounds);
            if (isUpdate && isRunning) {
                await vpnServiceManager.stop();
            }
        } catch (error) {
            console.error('更新配置失败:', error);
        }
    };



    return (
        <div className='w-full'>
            <div>
                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px]">当前订阅</div>
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
    )
}