import { useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { fetch } from '@tauri-apps/plugin-http';
import useSWR from "swr";
import { getClashApiSecret } from "../../single/store";
import { t } from "../../utils/helper";
import NodeOption from "./node-option";

const baseUrl = "http://127.0.0.1:9191";
const proxiesUrl = `${baseUrl}/proxies/ExitGateway`;


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
        let res = await response.json();
        return res
    }, {
        revalidateOnFocus: true,
        refreshInterval: 1000,
    });




    if (!isRunning) {
        return <>
            <div className="select select-sm  select-ghost border-[0.8px] border-gray-200  opacity-50 cursor-not-allowed">
                {
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
    const dropdownRef = useRef<HTMLDivElement>(null);


    useEffect(() => {

        const checkConnection = async () => {
            for (let i = 0; i < 10; i++) {
                const connected = await invoke<boolean>('ping_google');
                if (connected) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    setShowDelay(true);
                    // 如果连接成功，退出循环
                    // en: If the connection is successful, exit the loop
                    break;

                }

                // 连接失败，等待一段时间后重试
                // en: Connection failed, wait for a while before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }


        if (isRunning && !lastRunning) {
            setLastRunning(isRunning);
            checkConnection();

        } else {
            setShowDelay(false);
            setLastRunning(isRunning);
        }


    }, [isRunning, lastRunning]);

    // 处理点击外部区域关闭下拉菜单
    // en: Handle clicking outside area to close dropdown menu
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);




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
                /* 
                    当前配置没有节点 
                    en: No nodes in the current configuration
                */
                t("no_node")
            }
        </div>
    }


    return (
        <div className="relative" ref={dropdownRef}>
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