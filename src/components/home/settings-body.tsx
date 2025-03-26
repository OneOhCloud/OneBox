import { useState } from "react";
import { Shield } from "react-bootstrap-icons";
import { getSubscriptionConfig } from "../../action/db";
import { Subscription } from "../../types/definition";
import SelectNode from "./select-node";
import SelectSub from "./select-sub";


const fomatDate = (date: number) => {
    const d = new Date(date)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}



export default function SettingsBody() {
    // TODO: 如果后端程序没有运行则不允许进行操作

    // @ts-ignore
    const [currentNode, setCurrentNode] = useState<string>('')
    // 提取配置文件中的 tun 设置
    // @ts-ignore
    const [tunConfig, setTunConfig] = useState<string>('')
    // 提取配置文件中的 proxy 设置
    // @ts-ignore
    const [systemProxy, setSystemProxy] = useState<string>('')
    // 提取配置文件中的 node 列表
    const [nodeList, setNodeList] = useState<string[]>([])

    const [sub, setSub] = useState<Subscription>()

    const handleUpdate = async (item: Subscription) => {
        setSub(item)
        let config = await getSubscriptionConfig(item.identifier)
        console.log(config)
        let outbounds = config.outbounds
        // 找到第一个 type 为 "selector"的 outbounds
        let selector = outbounds.find((item: any) => item.type === "selector")
        console.log("selector", selector.outbounds)
        setNodeList(selector.outbounds)
        // 1.提取配置文件中的 tun 设置
        // 2.提取配置文件中的 proxy 设置
        // 3.提取配置文件中的 node 列表


        // 完成后根据各个选项合并到 store 中并通知后端更新, 后端根据状态选择重启或者不重启

    }
    // @ts-ignore
    const handleNodeChange = (node: string) => {
        // 通知后端更新当前节点
    }
    return (
        <div className='w-full '>
            <div >
                <fieldset className="fieldset w-full">
                    <legend className="fieldset-legend">当前订阅</legend>
                    <SelectSub onUpdate={handleUpdate}></SelectSub>
                </fieldset>

                <fieldset className="fieldset w-full">
                    <legend className="fieldset-legend">节点选择</legend>
                    <SelectNode nodeList={nodeList}></SelectNode>
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