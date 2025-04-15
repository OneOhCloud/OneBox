import { useEffect, useState } from "react";

import { fetch } from '@tauri-apps/plugin-http';
import useSWR from "swr";
import NodeOption from "./node-option";

const baseUrl = "http://localhost:9191";

type SelectNodeProps = {
    disabled: boolean;
    nodeList: string[]
}

export default function SelectNode(props: SelectNodeProps) {
    const { disabled, nodeList } = props;
    const [isOpen, setIsOpen] = useState(false);

    const proxiesUrl = `${baseUrl}/proxies/${encodeURIComponent('流量出口')}`;

    const { data, mutate, isLoading } = useSWR(proxiesUrl, async (url) => {
        if (disabled) {
            return "未启动";
        }
        const response = await fetch(decodeURIComponent(url), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        let res = await response.json();
        return res.now;
    });

    useEffect(() => {
        setTimeout(() => {
            mutate();
        }, 2000);
    }, [disabled]);

    const handleNodeChange = async (node: string) => {


        try {
            await fetch(proxiesUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ 'name': node }),
            });
        }catch (error) {
            console.error("Error changing node:", error);
        } finally {
            mutate();
            setIsOpen(false);

        }






    };

    if (nodeList.length === 0) {
        return <div className="select select-sm select-neutral">
            当前配置没有节点
        </div>
    }

    const isLoadingState = isLoading || (!disabled && data == "未启动");

    return (
        <div className="relative">
            <div
                className={`select select-sm select-neutral cursor-pointer ${disabled ? 'opacity-50' : ''}`}
                onClick={() => !disabled && !isLoadingState && setIsOpen(!isOpen)}
            >
                {isLoadingState ? (
                    <div className="flex justify-between items-center w-full">
                        <div className="h-4 w-24 bg-base-300 animate-pulse rounded"></div>
                        <div className="h-4 w-12 bg-base-300 animate-pulse rounded"></div>
                    </div>
                ) : (
                    <NodeOption nodeName={data} disabled={disabled} />
                )}
            </div>
            {isOpen && !disabled && !isLoadingState && data && (
                <div className="absolute bottom-full left-0 w-full mb-1 bg-base-100 rounded-lg shadow-lg z-50 max-h-50 overflow-y-auto">
                    {nodeList.map((item, index) => (
                        <div
                            key={index}
                            className="px-4 py-2 hover:bg-base-200 cursor-pointer"
                            onClick={() => handleNodeChange(item)}
                        >
                            <NodeOption nodeName={item} disabled={disabled} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}