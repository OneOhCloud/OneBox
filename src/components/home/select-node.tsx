import { useEffect, useMemo, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import useSWR from "swr";
import { getClashApiSecret } from "../../single/store";
import { t } from "../../utils/helper";
import {
    AppleSelectMenu,
    AppleSelectOption,
    AppleSelectPlaceholder,
} from "./apple-select-menu";
import NodeOption from "./node-option";

const baseUrl = "http://127.0.0.1:9191";
const proxiesUrl = `${baseUrl}/proxies/ExitGateway`;

type SelectNodeProps = {
    isRunning: boolean;
};

export default function SelectNode(props: SelectNodeProps) {
    const { isRunning } = props;
    const { data, isLoading, error, mutate } = useSWR(
        `swr-${baseUrl}/proxies/ExitGateway-${props.isRunning}`,
        async () => {
            if (!isRunning) {
                return { all: [], now: "" };
            }
            const url = `${baseUrl}/proxies/ExitGateway`;
            const response = await fetch(url, {
                method: "GET",
                // @ts-ignore
                timeout: 3,
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${await getClashApiSecret()}`,
                },
            });
            const res = await response.json();
            return res;
        },
        {
            revalidateOnFocus: true,
            refreshInterval: 1000,
        },
    );

    if (!isRunning) {
        return (
            <AppleSelectPlaceholder>{t("not_started")}</AppleSelectPlaceholder>
        );
    }

    if (error) {
        console.error(error);
    }
    if (isLoading || !data) {
        return (
            <AppleSelectPlaceholder tone="loading">
                <span className="inline-flex items-center gap-2">
                    <span className="inline-block size-3 rounded-full bg-blue-500/20 animate-pulse" />
                    <span
                        className="h-3 w-24 rounded-full animate-pulse"
                        style={{ background: 'var(--onebox-fill)' }}
                    />
                </span>
            </AppleSelectPlaceholder>
        );
    }

    return (
        <NodeMenu
            isRunning={isRunning}
            nodeList={data.all}
            currentNode={data.now}
            onUpdate={() => mutate()}
        />
    );
}

type NodeMenuProps = {
    currentNode: string;
    nodeList: string[];
    isRunning: boolean;
    onUpdate: () => void;
};

function NodeMenu(props: NodeMenuProps) {
    const { currentNode, nodeList, onUpdate, isRunning } = props;
    const [showDelay, setShowDelay] = useState(false);
    const [lastRunning, setLastRunning] = useState(false);

    useEffect(() => {
        const checkConnection = async () => {
            for (let i = 0; i < 10; i++) {
                const connected = await invoke<boolean>("ping_google");
                if (connected) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    setShowDelay(true);
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        };

        if (isRunning && !lastRunning) {
            setLastRunning(isRunning);
            checkConnection();
        } else {
            setShowDelay(false);
            setLastRunning(isRunning);
        }
    }, [isRunning, lastRunning]);

    const options = useMemo<AppleSelectOption<string>[]>(
        () => nodeList.map((name) => ({ value: name, key: name })),
        [nodeList],
    );

    const handleNodeChange = async (node: string) => {
        try {
            await fetch(proxiesUrl, {
                method: "PUT",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${await getClashApiSecret()}`,
                },
                body: JSON.stringify({ name: node }),
            });
            onUpdate();
        } catch (error) {
            console.error("Error changing node:", error);
        }
    };

    if (!nodeList || nodeList.length === 0) {
        return (
            <AppleSelectPlaceholder>{t("no_node")}</AppleSelectPlaceholder>
        );
    }

    return (
        <AppleSelectMenu<string>
            value={currentNode}
            options={options}
            onChange={handleNodeChange}
            menuMaxHeight={220}
            renderTrigger={() => (
                <NodeOption nodeName={currentNode} showDelay={showDelay} />
            )}
            renderOption={({ option, isSelected }) => (
                <div
                    className={isSelected ? "font-semibold text-blue-600" : ""}
                    style={
                        isSelected ? undefined : { color: 'var(--onebox-label)' }
                    }
                >
                    <NodeOption
                        nodeName={option.value}
                        showDelay={showDelay}
                    />
                </div>
            )}
        />
    );
}
