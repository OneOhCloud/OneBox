import { useEffect, useMemo, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import useSWR from "swr";
import { getShowNodeProtocol } from "../../single/store";
import { clashApiFetch } from "../../utils/clash-api";
import { t } from "../../utils/helper";
import {
    AppleSelectMenu,
    AppleSelectOption,
    AppleSelectPlaceholder,
} from "./apple-select-menu";
import { buildNodeProtocolMap, type NodeProtocolMap } from "./node-protocol";
import NodeOption from "./node-option";

type SelectorResponse = {
    all?: string[];
    now?: string;
};

type NodeSelectorData = {
    all: string[];
    now: string;
    nodeProtocols: NodeProtocolMap;
    showProtocol: boolean;
};

type SelectNodeProps = {
    isRunning: boolean;
};

export default function SelectNode(props: SelectNodeProps) {
    const { isRunning } = props;
    const { data, isLoading, error, mutate } = useSWR(
        `swr-clash-proxies-ExitGateway-${props.isRunning}`,
        async () => {
            if (!isRunning) {
                return { all: [], now: "", nodeProtocols: {}, showProtocol: false };
            }
            const showProtocol = await getShowNodeProtocol();
            const [selectorResponse, allProxiesResponse] = await Promise.all([
                clashApiFetch("/proxies/ExitGateway"),
                showProtocol
                    ? clashApiFetch("/proxies")
                        .then((response) => response.json())
                        .catch((error) => {
                            console.warn("Failed to fetch proxy protocol metadata:", error);
                            return undefined;
                        })
                    : Promise.resolve(undefined),
            ]);
            const selector = (await selectorResponse.json()) as SelectorResponse;
            const nodeList = Array.isArray(selector.all) ? selector.all : [];
            return {
                all: nodeList,
                now: selector.now ?? "",
                nodeProtocols: showProtocol
                    ? buildNodeProtocolMap(nodeList, allProxiesResponse)
                    : {},
                showProtocol,
            } satisfies NodeSelectorData;
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
                <span className="min-h-5 inline-flex items-center gap-2">
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
            nodeProtocols={data.nodeProtocols}
            showProtocol={data.showProtocol}
            onUpdate={() => mutate()}
        />
    );
}

type NodeMenuProps = {
    currentNode: string;
    nodeList: string[];
    nodeProtocols: NodeProtocolMap;
    showProtocol: boolean;
    isRunning: boolean;
    onUpdate: () => void;
};

function NodeMenu(props: NodeMenuProps) {
    const { currentNode, nodeList, nodeProtocols, showProtocol, onUpdate, isRunning } = props;
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
        () =>
            nodeList.map((name) => ({
                value: name,
                key: name,
                raw: nodeProtocols[name],
            })),
        [nodeList, nodeProtocols],
    );

    const handleNodeChange = async (node: string) => {
        try {
            await clashApiFetch("/proxies/ExitGateway", {
                method: "PUT",
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
                <NodeOption
                    nodeName={currentNode}
                    protocol={nodeProtocols[currentNode]}
                    showProtocol={showProtocol}
                    showDelay={showDelay}
                />
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
                        protocol={
                            typeof option.raw === "string"
                                ? option.raw
                                : undefined
                        }
                        showProtocol={showProtocol}
                        showDelay={showDelay}
                    />
                </div>
            )}
        />
    );
}
