import { useEffect, useState } from "react";

import { fetch } from '@tauri-apps/plugin-http';
import useSWR from "swr";
import { t } from "../../utils/helper";
import NodeOption from "./node-option";

const baseUrl = "http://localhost:9191";

type SelectNodeProps = {
    nodeList: string[]
    disabled: boolean;
}

export default function SelectNode(props: SelectNodeProps) {
    const { nodeList, disabled } = props;
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (!disabled) {
            setTimeout(() => {
                setShow(true);
            }, 300);

        } else {
            setShow(false);
        }
    }, [disabled]);

    if (disabled) {
        return <>
            <div className="select select-sm  select-ghost border-1 border-zinc-200  opacity-50 cursor-not-allowed">
                {
                    /* 未启动 */
                    t("not_started")
                }

            </div>
        </>
    }

    if (!show) {
        return <div className="select select-sm  select-ghost border-1 border-zinc-200 ">
            {
                /* 更新中... */
                t("updating")
            }
        </div>
    }




    return <SelecItem nodeList={nodeList} />

}

type SelecItemProps = {
    nodeList: string[]


}

export function SelecItem(props: SelecItemProps) {
    const { nodeList } = props;
    const [isOpen, setIsOpen] = useState(false);

    const proxiesUrl = `${baseUrl}/proxies/${encodeURIComponent('流量出口')}`;

    const { data, mutate, isLoading, error } = useSWR(proxiesUrl, async (url) => {
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



    if (error) {
        console.error(error);
    }

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
        } catch (error) {
            console.error("Error changing node:", error);
        } finally {
            mutate();
            setIsOpen(false);

        }

    };

    if (nodeList.length === 0) {
        return <div className="select select-sm  select-ghost border-1 border-zinc-200 ">
            {
                /* 当前配置没有节点 */
                t("no_node")
            }
        </div>
    }

    const isLoadingState = isLoading

    return (
        <div className="relative">
            <div
                className={`select select-sm  select-ghost border-1 border-zinc-200  cursor-pointer `}
                onClick={() => !isLoadingState && setIsOpen(!isOpen)}
            >
                {isLoadingState ? (
                    <div className="flex justify-between items-center w-full">
                        <div className="h-4 w-24 bg-base-300 animate-pulse rounded"></div>
                        <div className="h-4 w-12 bg-base-300 animate-pulse rounded"></div>
                    </div>
                ) : (
                    <NodeOption nodeName={data} />
                )}
            </div>
            {isOpen && !isLoadingState && data && (
                <div className="absolute bottom-full left-0 w-full mb-1 bg-base-100 rounded-lg shadow-lg z-50 max-h-50 overflow-y-auto">
                    {nodeList.map((item, index) => (
                        <div
                            key={index}
                            className="px-4 py-2 hover:bg-base-200 cursor-pointer"
                            onClick={() => handleNodeChange(item)}
                        >
                            <NodeOption nodeName={item} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}