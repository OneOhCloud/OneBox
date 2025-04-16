import { useState } from "react";
import { Shield } from "react-bootstrap-icons";
import { getSubscriptionConfig } from "../../action/db";
import { Subscription } from "../../types/definition";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";
import setMixedConfig from "../../config/mixed-config";

const fomatDate = (date: number) => {
    const d = new Date(date)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export type SettingsBodyProps = {
    isRunning: boolean;

}



export default function SettingsBody(props: SettingsBodyProps) {

    const { isRunning } = props;
    // 将状态和监听逻辑移到组件内部

    const [nodeList, setNodeList] = useState<string[]>([]);
    const [sub, setSub] = useState<Subscription>();


    const handleUpdate = async (item: Subscription) => {
        try {
            let config = await getSubscriptionConfig(item.identifier);
            setSub(item);
            let outbounds = config.outbounds;
            let nameList = outbounds.find((item: any) => item.type === "selector");
            if (nameList) {
                setNodeList(nameList.outbounds);
            }
            await setMixedConfig(item.identifier);
            
            
        } catch (error) {
            console.error('更新配置失败:', error);
        }
    };



    return (
        <div className='w-full '>
            <div >
                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px]">当前订阅</div>
                    <SelectSub onUpdate={handleUpdate}></SelectSub>
                </div>

                <div className="fieldset w-full">
                    <div className="fieldset-legend min-w-[270px]">节点选择</div>
                    <SelectNode disabled={!isRunning} nodeList={nodeList} ></SelectNode>
                </div>
            </div>
            {
                sub && (
                    <div className="w-full flex items-center justify-center mt-4 mb-2">
                        <Shield size={14} className="text-gray-400 mr-1" />
                        <span className="text-xs text-gray-400">当前订阅 </span>
                        <span className="text-xs text-blue-500 ml-1">有效至 {fomatDate(sub.expire_time)}</span>
                    </div>
                )
            }
        </div>
    )
}