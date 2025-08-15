import { useEffect, useState } from "react";

import { fetch } from '@tauri-apps/plugin-http';
import { type } from "@tauri-apps/plugin-os";
import useSWR from "swr";
import { getClashApiSecret } from "../../single/store";
import { t } from "../../utils/helper";
import NodeOption from "./node-option";

const osType = type();
const baseUrl = "http://127.0.0.1:9191";
const proxiesUrl = `${baseUrl}/proxies/ExitGateway`;
const sleepTime = osType === 'windows' ? 10000 : 5000;


type SelectNodeProps = {
    isRunning: boolean;
}

export default function SelectNode(props: SelectNodeProps) {

    const { isRunning } = props;
    const { data, isLoading, error, mutate } = useSWR(`swr-${baseUrl}/proxies/ExitGateway-${props.isRunning}`, async () => {
        if (!isRunning) {
            return {
                all: [],
                now: "",
            }
        }
        console.log("Fetching proxy delay...");
        const url = `${baseUrl}/proxies/ExitGateway`;
        const response = await fetch(url, {
            method: 'GET',
            // @ts-ignore
            timeout: 3,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${await getClashApiSecret()}`,
            },
        });
        console.log(`Bearer ${await getClashApiSecret()}`)

        let res = await response.json();
        console.log("Fetched proxy delay:", res);
        return res
    });




    if (!isRunning) {
        return <>
            <div className="select select-sm  select-ghost border-[0.8px] border-gray-200  opacity-50 cursor-not-allowed">
                {
                    /* 未启动 */
                    t("not_started")
                }

            </div>
        </>
    }

    if (error) {
        console.error(error);
    }
    if (isLoading || !data) {
        return <div className="select select-sm  select-ghost border-[0.8px] border-gray-200 ">
            <div className="h-4 w-24 bg-base-300 animate-pulse rounded"></div>
        </div>
    }

    return <SelecItem isRunning={isRunning} nodeList={data.all} currentNode={data.now} onUpdate={() => {
        mutate()
    }} />

}

type SelecItemProps = {
    currentNode: string;
    nodeList: string[]
    isRunning: boolean;
    onUpdate: () => void;
}

export function SelecItem(props: SelecItemProps) {

    const { currentNode, nodeList, onUpdate, isRunning } = props;
    const [isOpen, setIsOpen] = useState(false);
    const [showDelay, setShowDelay] = useState(false);
    const [lastRunning, setLastRunning] = useState(false);


    useEffect(() => {
        if (isRunning && !lastRunning) {
            setLastRunning(isRunning);
            setTimeout(() => {
                setShowDelay(true);
            }, sleepTime);
        } else {
            setShowDelay(false);
            setLastRunning(isRunning);
        }
    }, [isRunning, lastRunning]);





    const handleNodeChange = async (node: string) => {
        try {
            await fetch(proxiesUrl, {
                method: 'PUT',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    "Authorization": `Bearer ${await getClashApiSecret()}`,
                },
                body: JSON.stringify({ 'name': node }),
            });
            onUpdate();
        } catch (error) {
            console.error("Error changing node:", error);
        } finally {
            setIsOpen(false);

        }

    };

    if (!nodeList || nodeList.length === 0) {
        return <div className="select select-sm  select-ghost border-[0.8px] border-gray-200 ">
            {
                /* 当前配置没有节点 */
                t("no_node")
            }
        </div>
    }


    return (
        <div className="relative">
            <div
                className={`select select-sm  select-ghost border-[0.8px] border-gray-200  cursor-pointer `}
                onClick={() => setIsOpen(!isOpen)}
            >
                <NodeOption nodeName={currentNode} showDelay={showDelay} />
            </div>


            {isOpen && currentNode && (
                <div className="absolute bottom-full left-0 w-full mb-1 bg-base-100 rounded-lg shadow-lg z-50 max-h-50 overflow-y-auto">
                    {nodeList.map((item, index) => (
                        <div
                            key={index}
                            className="px-4 py-2 hover:bg-base-200 cursor-pointer"
                            onClick={() => handleNodeChange(item)}
                        >
                            <NodeOption nodeName={item} showDelay={showDelay} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}