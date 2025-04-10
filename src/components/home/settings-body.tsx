import { useState, useEffect } from "react";
import { Shield } from "react-bootstrap-icons";
import { getSubscriptionConfig } from "../../action/db";
import { Subscription } from "../../types/definition";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";
import { create, BaseDirectory } from '@tauri-apps/plugin-fs';
import * as path from '@tauri-apps/api/path';
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import setMixedConfig from "../../config/sing-box";

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
    const [currentNode, setCurrentNode] = useState<string>('');
    const [tunConfig, setTunConfig] = useState<string>('');
    const [systemProxy, setSystemProxy] = useState<string>('');
    const [nodeList, setNodeList] = useState<string[]>([]);
    const [sub, setSub] = useState<Subscription>();


    const handleUpdate = async (item: Subscription) => {
        try {
            let config = await getSubscriptionConfig(item.identifier);
 
            const appConfigPath = await path.appConfigDir();
            const filePath = await path.join(appConfigPath, 'config.json');
            console.log("配置文件路径:", filePath);
            
            
            setSub(item);

            let outbounds = config.outbounds;
            let nameList = outbounds.find((item: any) => item.type === "selector");
            if (nameList) {
                setNodeList(nameList.outbounds);
            }

            await setMixedConfig(item.identifier);

            //  启动

            
            
        } catch (error) {
            console.error('更新配置失败:', error);
        }
    };

    const handleNodeChange = (node: string) => {
        setCurrentNode(node);
        // 通知后端更新当前节点 - 实现选择节点功能
    };

    return (
        <div className='w-full '>
            <div >
                <fieldset className="fieldset w-full">
                    <legend className="fieldset-legend">当前订阅</legend>
                    <SelectSub onUpdate={handleUpdate}></SelectSub>
                </fieldset>

                <fieldset className="fieldset w-full">
                    <legend className="fieldset-legend">节点选择</legend>
                    <SelectNode disabled={!isRunning} nodeList={nodeList} ></SelectNode>
                </fieldset>
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