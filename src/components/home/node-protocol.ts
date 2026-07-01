export type NodeProtocolMap = Record<string, string>;

type ProxyEntry = {
    type?: unknown;
};

type ProxiesResponse = {
    proxies?: Record<string, ProxyEntry | undefined>;
};

const NON_SERVER_PROXY_TYPES = new Set([
    "selector",
    "urltest",
    "fallback",
    "loadbalance",
    "relay",
    "direct",
    "reject",
    "block",
]);

export function formatNodeProtocol(type: unknown): string | undefined {
    if (typeof type !== "string") return undefined;

    const normalized = type.trim().toLowerCase();
    if (!normalized || NON_SERVER_PROXY_TYPES.has(normalized)) {
        return undefined;
    }

    return normalized;
}

export function buildNodeProtocolMap(
    nodeList: readonly string[],
    response: unknown,
): NodeProtocolMap {
    const proxies =
        typeof response === "object" && response !== null
            ? (response as ProxiesResponse).proxies
            : undefined;

    if (!proxies || typeof proxies !== "object") return {};

    return nodeList.reduce<NodeProtocolMap>((acc, nodeName) => {
        const protocol = formatNodeProtocol(proxies[nodeName]?.type);
        if (protocol) {
            acc[nodeName] = protocol;
        }
        return acc;
    }, {});
}
