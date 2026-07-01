import { fetch } from '@tauri-apps/plugin-http';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from "swr";
import { getClashApiSecret } from '../../single/store';
import { t } from '../../utils/helper';

// 常量定义
const API_CONFIG = {
    BASE_URL: 'http://127.0.0.1:9191',
    TIMEOUT: 3000,
    REFRESH_INTERVAL: 5000,
    TIMEOUT_DELAY: 2000
} as const;

const DelayTestUrl = "https://www.google.com/generate_204"

// 类型定义
type DelayStatus = '-' | number;

interface ProxyResponse {
    delay: DelayStatus;
}

interface NodeOptionProps {
    nodeName: string;
    protocol?: string;
    showProtocol: boolean;
    showDelay: boolean;
}

// 样式常量
const STYLES = {
    container: 'flex justify-between items-center w-full',
    protocolContainer: 'grid grid-cols-[minmax(0,1fr)_auto_minmax(3.5rem,auto)] items-center gap-2 w-full',
    nodeName: 'truncate font-medium flex-1 min-w-0 text-sm',
    protocolNodeName: 'truncate font-medium min-w-0 text-sm',
    protocol: 'rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-4',
    startingContainer: 'onebox-select'
} as const;

// 自定义 Hook：管理代理延迟数据
const useProxyDelay = (nodeName: string) => {
    const fetcher = useCallback(async (url: string): Promise<ProxyResponse> => {
        if (!nodeName) {
            return { delay: '-' };
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    "Authorization": `Bearer ${await getClashApiSecret()}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.warn(`Failed to fetch proxy delay for ${nodeName}:`, error);
            return { delay: '-' };
        }
    }, [nodeName]);

    const swrKey = nodeName ? `${API_CONFIG.BASE_URL}/proxies/${encodeURIComponent(nodeName)}/delay?url=${encodeURIComponent(DelayTestUrl)}&timeout=5000` : null;

    const { data, error, isLoading } = useSWR<ProxyResponse>(
        swrKey,
        fetcher,
        {
            refreshInterval: API_CONFIG.REFRESH_INTERVAL,
            revalidateOnFocus: false,
            dedupingInterval: 1000
        }
    );

    const delay: DelayStatus = data?.delay ?? '-';

    return {
        delay,
        isError: !!error,
        isLoading
    };
};

// 延迟指示器组件
interface DelayIndicatorProps {
    delay: DelayStatus;
    showDelay: boolean;
    delayText: string;
}

const DelayIndicator = ({ delay, showDelay, delayText }: DelayIndicatorProps) => {
    const displayText = delay === '-' ? delayText : `${delay}ms`;

    return (
        <div className="h-5 flex items-center justify-end min-w-[3.5rem]">
            {showDelay ? (
                <div className="text-sm font-medium transition-all duration-300 ease">
                    {displayText}
                </div>
            ) : (
                <span className="onebox-spinner onebox-spinner-dots onebox-spinner-sm">
                    <span />
                    <span />
                    <span />
                </span>
            )}
        </div>
    );
};

export default function NodeOption({ nodeName, protocol, showProtocol, showDelay }: NodeOptionProps) {
    const [delayText, setDelayText] = useState<string>('-');
    const { delay } = useProxyDelay(nodeName);

    // 处理超时显示
    useEffect(() => {
        if (!showDelay || delay !== '-') {
            return;
        }

        const timer = setTimeout(() => {
            setDelayText(t("timeout"));
        }, API_CONFIG.TIMEOUT_DELAY);

        return () => clearTimeout(timer);
    }, [showDelay, delay]);

    // 重置延迟文本
    useEffect(() => {
        if (delay !== '-') {
            setDelayText('-');
        }
    }, [delay]);

    // 计算显示的节点名称
    const displayName = useMemo(() => {
        return nodeName === 'auto' ? t("auto") : nodeName;
    }, [nodeName]);

    // 处理节点名称为空的情况
    if (!nodeName) {
        return (
            <div className={STYLES.startingContainer}>
                {t('starting')}
            </div>
        );
    }

    return (
        <div className={showProtocol ? STYLES.protocolContainer : STYLES.container}>
            <span
                className={showProtocol ? STYLES.protocolNodeName : STYLES.nodeName}
                title={displayName}
            >
                {displayName}
            </span>
            {showProtocol && (
                <span
                    className={STYLES.protocol}
                    style={{
                        visibility: protocol ? "visible" : "hidden",
                        color: 'var(--onebox-blue)',
                        background: 'rgba(0, 122, 255, 0.10)',
                    }}
                    title={protocol}
                >
                    {protocol ?? "proxy"}
                </span>
            )}
            <DelayIndicator
                delay={delay}
                showDelay={showDelay}
                delayText={delayText}
            />
        </div>
    );
}
