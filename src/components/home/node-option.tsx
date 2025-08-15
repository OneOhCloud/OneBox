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
    TIMEOUT_DELAY: 5000
} as const;

const DelayTestUrl = "https://www.google.com/generate_204"

// 类型定义
type DelayStatus = '-' | number;

interface ProxyResponse {
    delay: DelayStatus;
}

interface NodeOptionProps {
    nodeName: string;
    showDelay: boolean;
}

// 样式常量
const STYLES = {
    container: 'flex justify-between items-center w-full',
    nodeName: 'truncate font-medium',
    delayContainer: 'ml-2 text-sm font-medium transition-all duration-300 ease flex items-center gap-1.5',
    delayDot: 'inline-block w-2 h-2 rounded-full transition-all duration-300 ease',
    loading: 'loading loading-dots loading-xs',
    startingContainer: 'select select-sm select-ghost border-[0.8px] border-gray-200'
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

    if (!showDelay) {
        return <span className={STYLES.loading} />;
    }

    return (
        <div className="ml-2 text-sm font-medium transition-all duration-300 ease">
            {displayText}
        </div>
    );
};

export default function NodeOption({ nodeName, showDelay }: NodeOptionProps) {
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
        <div className={STYLES.container}>
            <span className={STYLES.nodeName} title={displayName}>
                {displayName}
            </span>
            <DelayIndicator
                delay={delay}
                showDelay={showDelay}
                delayText={delayText}
            />
        </div>
    );
}
